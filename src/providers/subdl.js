import AdmZip from 'adm-zip';

const BASE = 'https://api.subdl.com';
const DL_BASE = 'https://dl.subdl.com';
const SUBTITLE_EXT = /\.(srt|ass|ssa|vtt|sub)$/i;
const RAR_MAGIC = 'Rar!';

// Το SubDL δουλεύει με ISO 639-1 ("el"), ενώ το Stremio μας δίνει/περιμένει ISO
// 639-2 ("ell"). Η μετατροπή γίνεται στα σύνορα, εδώ — πουθενά αλλού.
export function toSubdlLang(code) {
  const map = { ell: 'el', gre: 'el', eng: 'en' };
  return map[String(code ?? '').toLowerCase()] ?? String(code ?? '').toLowerCase();
}

// Τα αποτελέσματα δίνουν τη γλώσσα με το όνομά της ("english"), όχι με κωδικό.
function pickLang(lang) {
  const value = String(lang ?? '').toLowerCase();
  if (value.startsWith('greek') || value === 'el') return 'el';
  if (value.startsWith('english') || value === 'en') return 'en';
  return value.slice(0, 2) || 'xx';
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
  if (/^https?:\/\//i.test(url)) return url;
  return `${DL_BASE}${url.startsWith('/') ? '' : '/'}${url}`;
}

function mapRow(row) {
  if (!row || typeof row !== 'object') return null;
  const releaseName = row.release_name ?? row.name ?? null;
  // Το directUrl εξαρτάται από το αν η γραμμή δίνει ΡΗΤΑ ταυτότητα: αν δίνει nId,
  // κατεβάζουμε από τη σύγχρονη διαδρομή· αν δίνει μόνο url, από το dl.subdl.com.
  const explicitId = row.n_id ?? row.file_n_id ?? row.id ?? null;
  const urlId = parseNidFromUrl(row.url);
  const id = explicitId != null ? String(explicitId) : urlId ? String(urlId) : null;
  const directUrl = explicitId == null ? absoluteDownloadUrl(row.url) : null;
  if (!releaseName || (!id && !directUrl)) return null;
  return {
    provider: 'subdl',
    id,
    directUrl,
    language: pickLang(row.lang ?? row.language),
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
    const code = body?.error?.code;
    const message = body?.error?.message ?? (typeof body === 'string' ? body.slice(0, 200) : '');
    const quota = status === 429 || status === 402 || code === 'quota_exceeded';
    const detail = code ? `${code}: ${message}` : message;
    const err = new Error(`SubDL${status ? ` (${status})` : ''}${detail ? ` — ${detail}` : ''}`);
    if (quota) err.quotaExhausted = true;
    return err;
  }

  async function get(path, params) {
    const query = params && Object.keys(params).length > 0 ? `?${new URLSearchParams(params)}` : '';
    const res = await fetchImpl(`${BASE}${path}${query}`, { headers });
    const body = await readBody(res);
    if (!res.ok) throw toError(res.status, body);
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
        return (data?.subtitles ?? [])
          .map(mapRow)
          .filter(Boolean)
          // Φιλτράρουμε τη γλώσσα και στον client, όχι μόνο στο αίτημα: αν το API
          // επιστρέψει άλλη γλώσσα, θα σερβίραμε λάθος track με ελληνικό label.
          .filter((c) => wanted.has(c.language))
          // Όπου το SubDL δίνει match_score, το κάτω όριο κόβει λάθος release:
          // υπότιτλοι από άλλη έκδοση είναι χειρότεροι από καθόλου υπότιτλοι.
          .filter((c) => c.score == null || c.score >= minMatchScore)
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
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
