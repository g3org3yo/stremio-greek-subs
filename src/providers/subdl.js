import AdmZip from 'adm-zip';

const BASE = 'https://api.subdl.com';
const DL_BASE = 'https://dl.subdl.com';
const SUBTITLE_EXT = /\.(srt|ass|ssa|vtt|sub)$/i;
const RAR_MAGIC = 'Rar!';

// Το SubDL δουλεύει με ISO 639-1 ("el", "en") αλλά δίνει και ονόματα γλώσσας
// ("Greek"). Το Stremio ζητάει/δίνει κι αυτό ISO 639-1. Η μετατροπή γίνεται στα
// σύνορα, εδώ — πουθενά αλλού.
export function toSubdlLang(code) {
  const map = { ell: 'el', gre: 'el', eng: 'en' };
  return map[String(code ?? '').toLowerCase()] ?? String(code ?? '').toLowerCase();
}

// Τα αποτελέσματα δίνουν τη γλώσσα και με το όνομά της ("English") και με σύντομο
// κωδικό ("EN"). Ο κωδικός είναι πιο αξιόπιστος· το όνομα είναι εφεδρεία γιατί
// κάποιες γλώσσες (π.χ. "Brazilian Portuguese") δεν δίνουν σωστό δίγραμμα.
function pickLang(row) {
  const short = String(row?.language ?? '').trim().toLowerCase();
  if (/^[a-z]{2}$/.test(short)) return short;
  const name = String(row?.lang ?? row?.language ?? '').toLowerCase();
  if (name.startsWith('greek')) return 'el';
  if (name.startsWith('english')) return 'en';
  return name.slice(0, 2) || 'xx';
}

// Η v2 ροή δίνει nId και κατεβάζουμε από το /api/v2/subtitles/{nId}/download.
// Κάποιες απαντήσεις (και όλη η παλιά v1) δίνουν μόνο ένα σχετικό url της μορφής
// /subtitle/<nid>-<fileid>.zip, που σερβίρεται από το dl.subdl.com. Κρατάμε και
// τα δύο: το nId για τη σύγχρονη διαδρομή, το απόλυτο url για τη legacy.
function parseNidFromUrl(url) {
  if (typeof url !== 'string' || url === '') return null;
  const segments = url.replace(/^https?:\/\/[^/]+/, '').split('/').filter(Boolean);
  const tail = segments[segments.length - 1];
  if (!tail) return null;
  const withoutExt = tail.replace(/\.[a-z0-9]+$/i, '');
  // Σύμβαση v1: <nid>-<fileid>
  return withoutExt.split('-')[0] || null;
}

function absoluteDownloadUrl(url) {
  if (typeof url !== 'string' || url === '') return null;
  // Οι απαντήσεις δίνουν το url ΠΑΝΩ στο api.subdl.com με το κλειδί μέσα στο query
  // (?api_key=...). Αν το στείλουμε σε άλλο host, το κλειδί είτε χάνεται είτε
  // απορρίπτεται — γι' αυτό λύνουμε πάντα ως προς το BASE.
  try {
    return new URL(url, BASE).toString();
  } catch {
    return null;
  }
}

function mapRow(row) {
  if (!row || typeof row !== 'object') return null;
  // Με unpack=1 τα πραγματικά αρχεία μέσα στο zip δίνονται στα unpack_files.
  const unpack = Array.isArray(row.unpack_files) && row.unpack_files.length > 0 ? row.unpack_files[0] : null;
  const releaseName = row.release_name ?? unpack?.release_name ?? row.name ?? null;
  // Ο provider ΔΕΝ δίνει πεδίο n_id: δίνει έτοιμους συνδέσμους. Ο σύνδεσμος του
  // συγκεκριμένου αρχείου μέσα στο πακέτο είναι ο ακριβής (επαληθευμένο: 200 και το
  // ίδιο το .srt), γι' αυτό προτιμάται — ο σύνδεσμος του πακέτου είναι η εφεδρεία,
  // και το id μένει μόνο για όποια γραμμή δεν δίνει καθόλου σύνδεσμο.
  const directUrl = absoluteDownloadUrl(unpack?.url) ?? absoluteDownloadUrl(row.url);
  const explicitId = row.n_id ?? row.file_n_id ?? unpack?.file_n_id ?? row.id ?? null;
  const fromUrl = parseNidFromUrl(row.url);
  const id = explicitId != null ? String(explicitId) : fromUrl != null ? String(fromUrl) : null;
  if (!releaseName || (!directUrl && !id)) return null;
  return {
    provider: 'subdl',
    id,
    directUrl,
    language: pickLang(row),
    releaseName,
    score: typeof row.match_score === 'number' ? row.match_score : null,
    downloads: typeof row.downloads === 'number' ? row.downloads : 0,
  };
}

export function createSubdlProvider({ apiKey, fetchImpl = fetch, minMatchScore = 0.8, subsPerPage = 30 }) {
  const headers = { authorization: `Bearer ${apiKey}`, accept: 'application/json' };

  async function readBody(res) {
    try {
      return await res.json();
    } catch {
      try {
        return await res.text();
      } catch {
        return null;
      }
    }
  }

  // Ένα σημείο για όλα τα σφάλματα: το SubDL δηλώνει την εξάντληση ορίου και με
  // HTTP status (429/402) και με σώμα {error:{code:"quota_exceeded"}} που μπορεί
  // να έρθει με status 200. Και τα δύο σημαίνουν «μην ξαναδοκιμάσεις σήμερα».
  function toError(status, body) {
    const errorField = body && typeof body === 'object' ? body.error : null;
    const code = errorField && typeof errorField === 'object' ? errorField.code : null;
    const message =
      (typeof errorField === 'string' ? errorField : errorField?.message) ??
      (typeof body === 'string' ? body.slice(0, 200) : '');
    const quota =
      status === 429 || status === 402 || code === 'quota_exceeded' || /quota|limit (reached|exceeded)/i.test(message);
    // Με άκυρο κλειδί το Cloudflare απαντά σελίδα HTML: ένα σφάλμα 403 γεμάτο HTML
    // δεν λέει τίποτα σε όποιον το διαβάζει, οπότε το μεταφράζουμε σε οδηγία.
    const html = /^\s*<(?:!doctype|html)/i.test(typeof body === 'string' ? body : '');
    const detail = html
      ? 'ο διακομιστής απάντησε σελίδα HTML — συνήθως σημαίνει άκυρο ή λάθος κλειδί'
      : code
        ? `${code}: ${message}`
        : message;
    const err = new Error(`SubDL${status ? ` (${status})` : ''}${detail ? ` — ${detail}` : ''}`);
    if (quota) err.quotaExhausted = true;
    if (html || status === 401 || status === 403) err.authFailed = true;
    return err;
  }

  const NOT_FOUND = /can'?t find|not found|no (?:results|subtitles)|nothing found/i;

  // «Δεν βρήκα ταινία» ΔΕΝ είναι σφάλμα: το SubDL το στέλνει με HTTP 200 και
  // status:false. Αν το πετάγαμε ως εξαίρεση, κάθε άγνωστη ταινία θα έμοιαζε με
  // βλάβη της πηγής. Ένα δομημένο σφάλμα (π.χ. quota_exceeded) ή «Invalid request
  // parameters» παραμένει σφάλμα — αυτά δεν είναι «δεν υπάρχει».
  function isEmptyResult(body) {
    if (!body || typeof body !== 'object') return false;
    if (body.subtitles?.length > 0 || body.results?.length > 0) return false;
    const code = body.error && typeof body.error === 'object' ? body.error.code : null;
    if (code) return false;
    const message = typeof body.error === 'string' ? body.error : (body.error?.message ?? '');
    return body.status === false && (message === '' || NOT_FOUND.test(message));
  }

  async function get(path, params) {
    const query = params && Object.keys(params).length > 0 ? `?${new URLSearchParams(params)}` : '';
    const res = await fetchImpl(`${BASE}${path}${query}`, { headers });
    const body = await readBody(res);
    if (!res.ok) throw toError(res.status, body);
    if (isEmptyResult(body)) return { ...body, subtitles: [] };
    if (body && typeof body === 'object' && body.error) throw toError(null, body);
    return body;
  }

  return {
    name: 'subdl',

    isConfigured() {
      return Boolean(apiKey);
    },

    async search({ imdbId, type, season, episode, filename, languages = ['en'] }) {
      const langParam = languages.map(toSubdlLang).join(',');
      const wanted = new Set(languages.map(toSubdlLang));

      // Υπάρχει release filename; το files/search είναι ο ακριβής τρόπος
      // ταιριάσματος: επιστρέφει match_score ανά υπότιτλο και στενεύει μόνο του
      // σεζόν/επεισόδιο για σειρές. Χωρίς filename πάμε σε αναζήτηση με imdb_id.
      if (filename) {
        const data = await get('/api/v2/files/search', {
          filename,
          languages: langParam,
          subs_per_page: String(subsPerPage),
        });
        const byFile = (data?.subtitles ?? [])
          .map(mapRow)
          .filter(Boolean)
          // Φιλτράρουμε τη γλώσσα και στον client, όχι μόνο στο αίτημα: αν το API
          // επιστρέψει άλλη γλώσσα, θα σερβίραμε λάθος track με ελληνικό label.
          .filter((c) => wanted.has(c.language))
          // Όπου το SubDL δίνει match_score, το κάτω όριο κόβει λάθος release:
          // υπότιτλοι από άλλη έκδοση είναι χειρότεροι από καθόλου υπότιτλοι.
          .filter((c) => c.score == null || c.score >= minMatchScore)
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        // Το files/search θέλει σχεδόν ακριβές όνομα release και απαντά
        // «can't find movie or tv» όταν δεν το αναγνωρίσει (π.χ. αρχείο που
        // κατέβασε ο χρήστης με δικό του όνομα). Τότε — και μόνο τότε — πέφτουμε
        // στην αναζήτηση με imdb_id, που είναι πάντα γνωστό στο Stremio.
        if (byFile.length > 0 || !imdbId) return byFile;
      }

      const params = { languages: langParam, unpack: '1' };
      if (imdbId) params.imdb_id = imdbId;
      else if (filename) params.file_name = filename;
      else params.film_name = '';
      if (type === 'series') params.type = 'tv';
      else if (type) params.type = 'movie';
      if (season != null && season !== '') params.season = String(season);
      if (episode != null && episode !== '') params.episode = String(episode);

      const data = await get('/api/v2/subtitles/search', params);
      return (data?.subtitles ?? [])
        .map(mapRow)
        .filter(Boolean)
        .filter((c) => wanted.has(c.language))
        .sort((a, b) => b.downloads - a.downloads);
    },

    async download(candidate) {
      const url = candidate.directUrl ?? `${BASE}/api/v2/subtitles/${encodeURIComponent(candidate.id)}/download?format=zip`;
      const res = await fetchImpl(url, { headers });
      if (!res.ok) throw toError(res.status, await readBody(res));

      const raw = Buffer.from(await res.arrayBuffer());
      if (raw.length >= 4 && raw[0] === 0x50 && raw[1] === 0x4b) {
        const entries = new AdmZip(raw)
          .getEntries()
          .filter((e) => !e.isDirectory && SUBTITLE_EXT.test(e.entryName));
        if (entries.length === 0) throw new Error('Το αρχείο δεν περιέχει υπότιτλο');
        // Σε πακέτα το μεγαλύτερο αρχείο είναι το πλήρες· τα άλλα είναι δείγματα.
        entries.sort((a, b) => b.header.size - a.header.size);
        return { buffer: entries[0].getData(), filename: entries[0].entryName };
      }
      if (raw.length >= 4 && raw.subarray(0, 4).toString('latin1') === RAR_MAGIC) {
        throw new Error('Ο υπότιτλος είναι συμπιεσμένος σε μορφή rar — διάλεξε άλλο release');
      }
      return { buffer: raw, filename: `${candidate.id}.srt` };
    },

    async quota() {
      const data = await get('/api/v2/me', {});
      return {
        searches: data?.usage?.search ?? null,
        downloads: data?.usage?.downloads ?? null,
        plan: data?.plan ?? null,
      };
    },
  };
}
