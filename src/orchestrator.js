import { createHash } from 'node:crypto';
import { cacheKey, safeKey } from './cache.js';
import { makeBatches, applyTranslations } from './subtitle/batch.js';
import { decodeSubtitle } from './subtitle/encoding.js';
import { parseSrt } from './subtitle/parse.js';
import { serializeSrt } from './subtitle/serialize.js';
import { createChain } from './translate/chain.js';

const EMPTY_GLOSSARY = { version: 0, keep: [], map: {}, hash: 'empty' };

// Το Stremio δίνει `tt0903747:5:14` για επεισόδιο και `tt15239678` για ταινία.
export function parseStremioId(id) {
  const parts = String(id ?? '').split(':');
  return { imdbId: parts[0] || null, season: parts[1] ?? null, episode: parts[2] ?? null };
}

// Η ταυτότητα του «έργου» που βλέπει ο χρήστης. Πάνω της κρέμονται ο υπότιτλος,
// η αγγλική πηγή και το job, ώστε το ίδιο επεισόδιο να μη μεταφράζεται δεύτερη φορά.
export function videoKey({ imdbId, season, episode }) {
  return createHash('sha1')
    .update(`${imdbId ?? ''}|${season ?? ''}|${episode ?? ''}`)
    .digest('hex')
    .slice(0, 12);
}

function placeholderSrt() {
  // Ένα cue που καλύπτει όλη τη διάρκεια: ό,τι κι αν παίξει ο χρήστης, βλέπει την
  // εξήγηση αντί για κενή οθόνη. Σερβίρεται με no-store, δεν μένει σε cache player.
  return serializeSrt([
    {
      id: 1,
      start: '00:00:00,000',
      end: '09:59:59,000',
      text: 'Η μετάφραση είναι σε εξέλιξη.\nΚλείσε και ξανάνοιξε το μενού υποτίτλων σε λίγο.',
    },
  ]);
}

export function createOrchestrator({
  config,
  providers = [],
  engines = [],
  cache,
  jobs,
  glossary = EMPTY_GLOSSARY,
  baseUrl = 'http://127.0.0.1:7000',
  log = () => {},
}) {
  const targetLang = config.targetLang ?? 'el';
  const targetLangName = config.targetLangName ?? 'Ελληνικά';
  const sourceLangs = config.sourceLangs ?? ['en'];
  const batchSize = config.batchSize ?? 70;
  const chain = createChain({ engines, targetLangName, glossary, log });

  // Ο πρώτος provider που δίνει αποτελέσματα κερδίζει· μια αποτυχία δεν σταματά
  // την αναζήτηση, γιατί ο επόμενος μπορεί να έχει το ίδιο έργο.
  async function findCandidates({ imdbId, type, season, episode, filename, languages }) {
    const problems = [];
    for (const provider of providers) {
      try {
        const found = await provider.search({ imdbId, type, season, episode, filename, languages });
        if (found && found.length > 0) return { candidates: found, problems };
        problems.push(`${provider.name}: κανένα αποτέλεσμα`);
      } catch (err) {
        log(`[orchestrator] ο ${provider.name} απέτυχε: ${err.message}`);
        problems.push(`${provider.name}: ${err.message}`);
      }
    }
    return { candidates: [], problems };
  }

  async function downloadCandidate(candidate) {
    // Ένα αποτέλεσμα χωρίς ετικέτα provider δεν πρέπει να χαλάσει όλη τη λίστα:
    // όταν υπάρχει μόνο ένας provider, αυτός είναι προφανώς ο ιδιοκτήτης.
    const owner =
      providers.find((p) => p.name === candidate.provider) ?? (providers.length === 1 ? providers[0] : null);
    if (!owner) throw new Error(`Δεν βρέθηκε provider για το αποτέλεσμα (${candidate.provider})`);
    const { buffer, filename } = await owner.download(candidate);
    return { ...decodeSubtitle(buffer), filename };
  }

  function entryFor(key, meta) {
    const ai = meta?.kind === 'ai-translation';
    return {
      id: key,
      url: `${baseUrl}/s/${key}`,
      // Το Stremio θέλει ISO 639-1 («el») στο lang: με τριψήφιο κωδικό ο player δεν
      // αναγνωρίζει τη γλώσσα και δεν την επιλέγει αυτόματα.
      lang: targetLang,
      label: ai
        ? 'Ελληνικοί (αυτόματη μετάφραση)'
        : `Ελληνικοί${meta?.releaseName ? ` — ${meta.releaseName}` : ''}`,
    };
  }

  function progressFor(vk) {
    const id = safeKey('prog', vk);
    return {
      id,
      url: `${baseUrl}/s/${id}`,
      lang: targetLang,
      label: 'Ελληνικοί — μετάφραση σε εξέλιξη (ξανάνοιξε το μενού σε λίγο)',
    };
  }

  // Ξεκινά μετάφραση ή, αν υπάρχει ήδη έτοιμη για την ίδια πηγή, την υιοθετεί.
  // Το κλειδί της μετάφρασης κρέμεται από το ΠΕΡΙΕΧΟΜΕΝΟ της πηγής και την έκδοση
  // του glossary: ίδιο αγγλικό αρχείο = ίδια μετάφραση, όποια ταινία κι αν το έφερε.
  async function translateOrAdopt({ vk, elKey, enKey, text, meta, context }) {
    const sourceHash = createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 16);
    const trKey = cacheKey({ sourceHash, targetLang, glossaryVersion: glossary.hash });

    const existing = cache.getSrt(trKey);
    if (existing) {
      log(`[orchestrator] βρέθηκε έτοιμη μετάφραση για την πηγή (${trKey})`);
      cache.put(elKey, existing, { ...meta, kind: 'ai-translation', sourceKey: trKey });
      return entryFor(elKey, { kind: 'ai-translation' });
    }

    if (!cache.getSrt(enKey)) {
      cache.put(enKey, text, { ...meta, kind: 'source', sourceHash });
    }

    jobs.enqueue(vk, async ({ onProgress }) => {
      const cues = parseSrt(text);
      const batches = makeBatches(cues, batchSize);
      if (batches.length === 0) throw new Error('Ο υπότιτλος-πηγή δεν περιέχει κείμενο για μετάφραση');

      const byId = new Map();
      for (let i = 0; i < batches.length; i += 1) {
        onProgress(i + 1, batches.length);
        const map = await chain.translateBatch(batches[i].items, context);
        for (const [id, value] of map) byId.set(id, value);
      }

      // Ό,τι δεν απάντησε το μοντέλο μένει στο πρωτότυπο: αγγλικό cue είναι πολύ
      // καλύτερο από κενό διάστημα χωρίς υπότιτλο.
      const out = serializeSrt(applyTranslations(cues, byId));
      const record = {
        ...meta,
        kind: 'ai-translation',
        sourceKey: trKey,
        sourceHash,
        translatedCues: byId.size,
        totalCues: cues.length,
        engine: chain.status().exhausted.length > 0 ? 'fallback' : 'preferred',
      };
      cache.put(trKey, out, record);
      cache.put(elKey, out, record);
      log(`[orchestrator] μεταφράστηκαν ${byId.size}/${cues.length} cues`);
      return { translated: byId.size, total: cues.length };
    });

    return progressFor(vk);
  }

  async function list({ type, id, filename }) {
    try {
      const { imdbId, season, episode } = parseStremioId(id);
      const vk = videoKey({ imdbId, season, episode });
      const elKey = safeKey('el', vk);
      const enKey = safeKey('en', vk);

      // 1. Έτοιμος ελληνικός υπότιτλος (πραγματικός ή μεταφρασμένος): ακαριαία.
      const ready = cache.getSrt(elKey);
      if (ready) return [entryFor(elKey, cache.meta(elKey))];

      const context = { type, season, episode, imdbId };
      // 2. Έχουμε ήδη την αγγλική πηγή. ΔΕΝ ξαναχτυπάμε τον provider ούτε
      //    ξανακατεβάζουμε: το δεύτερο άνοιγμα του μενού είναι δωρεάν.
      const cachedSource = cache.getSrt(enKey);
      if (cachedSource) {
        return [await translateOrAdopt({ vk, elKey, enKey, text: cachedSource, meta: cache.meta(enKey) ?? {}, context })];
      }

      const query = { imdbId, type, season, episode, filename };

      // 3. Υπάρχει πραγματικός ελληνικός; Τότε δεν μεταφράζουμε καθόλου.
      const greek = await findCandidates({ ...query, languages: [targetLang] });
      if (greek.candidates.length > 0) {
        const candidate = greek.candidates[0];
        const { text } = await downloadCandidate(candidate);
        cache.put(elKey, text, {
          kind: 'provider',
          provider: candidate.provider,
          releaseName: candidate.releaseName,
          language: targetLang,
          season,
          episode,
          imdbId,
        });
        log(`[orchestrator] πραγματικοί ελληνικοί από ${candidate.provider}: ${candidate.releaseName}`);
        return [entryFor(elKey, { kind: 'provider', releaseName: candidate.releaseName })];
      }

      // 4. Αλλιώς: κατεβάζουμε αγγλικό και τον μεταφράζουμε μία φορά.
      const source = await findCandidates({ ...query, languages: sourceLangs });
      if (source.candidates.length === 0) {
        log(`[orchestrator] κανένας υπότιτλος για ${imdbId} ${season ?? ''} ${episode ?? ''}`.trim());
        return [];
      }

      const candidate = source.candidates[0];
      const { text } = await downloadCandidate(candidate);
      const meta = {
        provider: candidate.provider,
        releaseName: candidate.releaseName,
        language: candidate.language ?? sourceLangs[0],
        season,
        episode,
        imdbId,
      };
      return [await translateOrAdopt({ vk, elKey, enKey, text, meta, context })];
    } catch (err) {
      // Ποτέ σφάλμα προς το Stremio: μια κενή λίστα είναι «δεν βρήκα υπότιτλο»,
      // ένα σφάλμα είναι «το addon χάλασε».
      log(`[orchestrator] αποτυχία στη λίστα: ${err.message}`);
      return [];
    }
  }

  return {
    list,

    async getSubtitle(fileId) {
      const key = String(fileId ?? '');
      // Ένας δείκτης προόδου δεν είναι υπότιτλος, ό,τι κι αν έγινε στο μεταξύ.
      if (key.startsWith('prog-')) return placeholderSrt();
      return cache.getSrt(key);
    },

    isPending(fileId) {
      const key = String(fileId ?? '');
      if (!key.startsWith('prog-')) return false;
      const job = jobs.get(key.slice('prog-'.length));
      return Boolean(job && (job.state === 'queued' || job.state === 'running'));
    },

    status() {
      return { translation: chain.status(), cache: cache.stats(), jobs: jobs.list() };
    },
  };
}
