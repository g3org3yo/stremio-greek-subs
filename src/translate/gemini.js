import { buildPrompt } from './prompt.js';

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Μοντέλα που ΔΕΝ κάνουν για μετάφραση κειμένου. Η λίστα /models του Gemini περιέχει
// τα πάντα (εικόνα, βίντεο, μουσική, embeddings, ρομποτική) και αρκετά μοντέλα που
// εμφανίζονται στη λίστα αλλά δεν σερβίρονται — γι' αυτό η επιλογή επαληθεύεται.
const NOT_TEXT = /embedding|image|video|vision|tts|aqa|lyria|robotics|computer-use|deep-research|antigravity|transcribe|nano-banana/i;
// Τα «-latest» είναι ψευδώνυμα που αλλάζουν μοντέλο από κάτω, άρα δεν αποσύρονται.
// Το lite πρώτο: για υπότιτλους αρκεί και είναι τάξεις μεγέθους ταχύτερο (μετρημένο
// ~0,7 δευτ. έναντι ~15 δευτ. ανά παρτίδα), κάτι που μετρά σε ταινία 20+ παρτίδων.
const ALIASES = ['gemini-flash-lite-latest', 'gemini-flash-latest'];
// Πόσο περιμένουμε δοκιμαστικό αίτημα (μικρό: μόνο για να δούμε ποιο μοντέλο ζει)
const CHECK_TIMEOUT_MS = 25000;

export function createGeminiEngine({
  apiKey,
  model,
  baseUrl = DEFAULT_BASE,
  timeoutMs = 90000,
  fetchImpl = fetch,
} = {}) {
  const endpoint = `${baseUrl.replace(/\/$/, '')}/models`;
  // Το όνομα του μοντέλου δεν είναι σταθερά: η Google αποσύρει μοντέλα (το
  // gemini-2.5-flash γύρισε «no longer available to new users») και βάζει άλλα σε
  // αναμονή λόγω φόρτου (503). Κρατάμε ποιο δούλεψε και ποια απέτυχαν.
  let current = model || null;
  const rejected = new Set();

  function version(name) {
    const m = /gemini-(\d+(?:\.\d+)?)/.exec(name);
    return m ? Number(m[1]) : 0;
  }

  // Σειρά προτίμησης: ψευδώνυμα, μετά τα νεότερα flash (πριν τα lite, χωρίς προτίμηση
  // σε preview, μετά τα pro), και τέλος ό,τι άλλο είναι μοντέλο κειμένου.
  function orderModels(available) {
    const rank = (n) => (n.includes('lite') ? 1 : 0) + (/pro/.test(n) ? 2 : 0) + (/preview/.test(n) ? 4 : 0);
    const versioned = available
      .filter((n) => !NOT_TEXT.test(n) && !ALIASES.includes(n))
      .sort((a, b) => version(b) - version(a) || rank(a) - rank(b));
    return [...ALIASES.filter((n) => available.includes(n)), ...versioned];
  }

  async function listModels() {
    const res = await fetchImpl(endpoint, {
      headers: { 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Gemini: δεν διαβάστηκε η λίστα μοντέλων (${res.status})`);
    const data = await res.json();
    return (data?.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m) => String(m.name ?? '').replace(/^models\//, ''))
      .filter(Boolean);
  }

  function post(chosen, body, ms) {
    return fetchImpl(`${endpoint}/${chosen}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body,
      // ΧΩΡΙΣ χρονικό όριο ένα «κολλημένο» αίτημα παγώνει όλη την ουρά μετάφρασης και
      // το τοπικό fallback δεν παίρνει ποτέ σειρά. Μετρημένο: το gemini-flash-latest
      // δεν απάντησε σε 20 δευτ., ενώ το flash-lite-latest απάντησε σε 0,7.
      signal: AbortSignal.timeout(ms),
    });
  }

  const bodyFor = (prompt) =>
    JSON.stringify({
      systemInstruction: { parts: [{ text: prompt.system }] },
      contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    });

  const quotaError = (status, text) =>
    Object.assign(new Error(`Gemini όριο/άδεια (${status}): ${text.slice(0, 200)}`), { quotaExhausted: true });

  // Δοκιμαστικό αίτημα μίας γραμμής: η λίστα λέει ποιο μοντέλο ΥΠΑΡΧΕΙ, όχι ποιο
  // ΣΕΡΒΙΡΕΤΑΙ. Το gemini-3.8-flash ήταν στη λίστα και γύριζε 503· το 2.5-flash ήταν
  // στη λίστα και ήταν αποσυρμένο. Ρωτάμε λοιπόν με πραγματικό αίτημα πριν δεσμευτούμε.
  async function verify(chosen) {
    const probe = buildPrompt({ items: [{ id: 1, text: 'Hello.' }], targetLangName: 'Ελληνικά' });
    const res = await post(chosen, bodyFor(probe), CHECK_TIMEOUT_MS);
    if (!res.ok) {
      await res.text().catch(() => '');
      return false;
    }
    const data = await res.json().catch(() => null);
    return Boolean(data?.candidates?.[0]?.content?.parts?.length);
  }

  async function resolveModel() {
    if (current) return current;
    const problems = [];
    let available = [];
    try {
      available = await listModels();
    } catch (err) {
      problems.push(err.message);
    }
    for (const candidate of orderModels(available).filter((n) => !rejected.has(n))) {
      try {
        if (await verify(candidate)) {
          current = candidate;
          return current;
        }
        problems.push(`${candidate}: δεν απάντησε έγκυρα`);
      } catch (err) {
        problems.push(`${candidate}: ${err.name === 'TimeoutError' ? 'δεν απάντησε εγκαίρως' : err.message}`);
      }
      rejected.add(candidate);
    }
    throw new Error(`Gemini: κανένα διαθέσιμο μοντέλο (${problems.slice(0, 4).join(' | ')})`);
  }

  return {
    name: 'gemini',

    async isAvailable() {
      if (!apiKey) return false;
      try {
        await resolveModel();
        return true;
      } catch {
        return false;
      }
    },

    async translateBatch({ items, targetLangName, context, glossary }) {
      const body = bodyFor(buildPrompt({ items, targetLangName, context, glossary }));
      let lastError = null;
      let empty = 0;

      // Φραγμένες απόπειρες: κάθε αποτυχία αποκλείει το μοντέλο, άρα η σειρά μικραίνει
      // και δεν υπάρχει περίπτωση ατέρμονος βρόχου.
      for (let attempt = 0; attempt < 4; attempt++) {
        const chosen = await resolveModel();
        let res;
        try {
          res = await post(chosen, body, timeoutMs);
        } catch (err) {
          lastError = err;
          rejected.add(chosen);
          current = null;
          continue;
        }
        if (res.status === 429 || res.status === 403) {
          throw quotaError(res.status, await res.text().catch(() => ''));
        }
        if (!res.ok) {
          lastError = new Error(`Gemini σφάλμα ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
          rejected.add(chosen);
          current = null;
          continue;
        }
        const data = await res.json();
        const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
        if (text !== '') return text;
        // Κενή απάντηση σημαίνει συνήθως ότι το περιεχόμενο μπλοκαρίστηκε για
        // «ασφάλεια». Το μοντέλο ΔΕΝ αποκλείεται (δουλεύει, απλώς αρνήθηκε αυτό το
        // κείμενο), αλλά δεν επιμένουμε: μετά τη δεύτερη κενή απάντηση γυρίζουμε κενό
        // αντί να πετάξουμε, ώστε η υπόλοιπη ταινία να προχωρήσει και ό,τι δεν
        // μεταφράστηκε να μείνει στο πρωτότυπο — όχι να χαθεί όλη η δουλειά.
        empty += 1;
        if (empty >= 2) return '';
        lastError = new Error('Gemini: κενή απάντηση');
      }

      throw new Error(`Gemini: καμία επιτυχημένη απόπειρα (${lastError?.message ?? 'άγνωστο'})`);
    },
  };
}
