import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSubdlProvider } from '../src/providers/subdl.js';

// Αυτές οι δοκιμές κωδικοποιούν το συμβόλαιο του SubDL v2 ΟΠΩΣ απαντά στ' αλήθεια
// (ελέγχθηκε με curl στο πραγματικό API). Δεν είναι εικασίες από τεκμηρίωση:
// τα σώματα των απαντήσεων είναι αντιγραμμένα από πραγματικές κλήσεις, γιατί εκεί
// κρύβονται οι παγίδες — status:false με HTTP 200, HTML σε λάθος κλειδί, ids μέσα
// στα unpack_files, και url λήψης που κουβαλά το κλειδί στο query.
function provider(handler, extra = {}) {
  return createSubdlProvider({ apiKey: 'k', minMatchScore: 0.8, fetchImpl: handler, ...extra });
}

const reply = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

// Πραγματική απάντηση όταν το filename δεν αναγνωρίζεται. Προσοχή: HTTP 200.
const NOT_FOUND_BODY = {
  status: false,
  error: "can't find movie or tv",
  results: [],
  subtitles: [],
  match: null,
  alternates: [],
};

test('«δεν βρήκα ταινία» (status:false με HTTP 200) -> κενή λίστα, ΟΧΙ σφάλμα', async () => {
  const p = provider(async () => reply(NOT_FOUND_BODY));
  const out = await p.search({ imdbId: 'tt0000001', type: 'movie', filename: 'άγνωστο.αρχείο.mkv', languages: ['en'] });
  assert.deepEqual(out, []);
});

test('«δεν βρήκα» χωρίς imdb_id σταματά εκεί (δεν γίνεται δεύτερη κλήση)', async () => {
  const asked = [];
  const p = provider(async (url) => {
    asked.push(url);
    return reply(NOT_FOUND_BODY);
  });
  const out = await p.search({ filename: 'x.mkv', type: 'movie', languages: ['en'] });
  assert.deepEqual(out, []);
  assert.equal(asked.length, 1);
});

test('«Invalid request parameters» ΠΑΡΑΜΕΝΕΙ σφάλμα (δικό μας λάθος, όχι άδειο αποτέλεσμα)', async () => {
  const p = provider(async () => reply({ status: false, error: 'Invalid request parameters' }));
  await assert.rejects(
    () => p.search({ imdbId: 'tt0903747', type: 'series', season: '5', episode: '14', languages: ['en'] }),
    /Invalid request parameters/,
  );
});

test('quota_exceeded με HTTP 200 -> σφάλμα με quotaExhausted', async () => {
  const p = provider(async () => reply({ status: false, error: { code: 'quota_exceeded', message: 'όριο' } }));
  await assert.rejects(
    () => p.search({ imdbId: 'tt1', type: 'movie', languages: ['en'] }),
    (err) => {
      assert.equal(err.quotaExhausted, true);
      return true;
    },
  );
});

test('λάθος κλειδί: HTML 403 -> καθαρό μήνυμα και authFailed', async () => {
  const p = provider(async () => reply('<!DOCTYPE html><html><head><title>403</title>', 403));
  await assert.rejects(
    () => p.search({ imdbId: 'tt1', type: 'movie', languages: ['en'] }),
    (err) => {
      assert.match(err.message, /κλειδί/, 'λέει τι συμβαίνει αντί να χύνει HTML');
      assert.equal(err.authFailed, true);
      assert.equal(err.quotaExhausted, undefined);
      return true;
    },
  );
});

// Πραγματική γραμμή από /api/v2/subtitles/search?imdb_id=tt15239678 (σμίκρυνση)
const LIVE_ROW = {
  release_name: 'Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX_merged',
  name: 'Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX_merged.zip',
  lang: 'English',
  language: 'EN',
  url: '/subtitle/3570225-8489216.zip?api_key=subdl_DOKIMASTIKO',
  season: 0,
  episode: null,
  unpack_files: [
    {
      file_n_id: 'S1LYq6u7YX',
      name: 'Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX_merged.srt',
      release_name: 'Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX_merged',
      url: '/subtitle/CtLEIhUc0F/S1LYq6u7YX?api_key=subdl_DOKIMASTIKO',
    },
  ],
};

test('πραγματική γραμμή: κατεβάζει το ΑΚΡΙΒΕΣ αρχείο από τον σύνδεσμο των unpack_files', async () => {
  const p = provider(async () => reply({ status: true, results: [{}], subtitles: [LIVE_ROW] }));
  const out = await p.search({ imdbId: 'tt15239678', type: 'movie', languages: ['en'] });
  assert.equal(out.length, 1);
  assert.equal(out[0].language, 'en');
  assert.equal(out[0].releaseName, 'Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX_merged');
  // Επαληθευμένο στο πραγματικό API: αυτός ο σύνδεσμος γυρίζει 200 με το ίδιο το .srt.
  // Ο provider δεν δίνει n_id, οπότε ο σύνδεσμος είναι η αξιόπιστη διαδρομή λήψης.
  assert.equal(
    out[0].directUrl,
    'https://api.subdl.com/subtitle/CtLEIhUc0F/S1LYq6u7YX?api_key=subdl_DOKIMASTIKO',
    'προτιμάται το αρχείο μέσα στο πακέτο, όχι ολόκληρο το zip',
  );

  const asked = [];
  const p2 = provider(async (url) => {
    asked.push(url);
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nHi\n')) };
  });
  await p2.download(out[0]);
  assert.equal(asked[0], out[0].directUrl);
});

test('γραμμή χωρίς unpack_files: πέφτει στον σύνδεσμο του πακέτου', async () => {
  const zipped = { ...LIVE_ROW, unpack_files: [] };
  const p = provider(async () => reply({ status: true, subtitles: [zipped] }));
  const out = await p.search({ imdbId: 'tt15239678', type: 'movie', languages: ['en'] });
  assert.equal(out[0].directUrl, 'https://api.subdl.com/subtitle/3570225-8489216.zip?api_key=subdl_DOKIMASTIKO');
});

test('γραμμή χωρίς nId: το url λήψης κρατά το κλειδί και τον σωστό host', async () => {
  const legacy = { release_name: 'Παλιά.Έκδοση', lang: 'Greek', language: 'EL', url: '/subtitle/123-456.zip?api_key=subdl_DOKIMASTIKO' };
  const p = provider(async () => reply({ status: true, subtitles: [legacy] }));
  const out = await p.search({ imdbId: 'tt1', type: 'movie', languages: ['el'] });
  assert.equal(out.length, 1);
  assert.equal(out[0].language, 'el');
  assert.match(out[0].directUrl, /^https:\/\/api\.subdl\.com\/subtitle\/123-456\.zip\?api_key=/, 'ίδιος host, το κλειδί διατηρείται');

  // Και η λήψη όντως χτυπά αυτό το url — όχι κάποιο άλλο.
  const asked = [];
  const p2 = provider(async (url) => {
    asked.push(url);
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nΓεια\n')) };
  });
  const res = await p2.download(out[0]);
  assert.equal(asked[0], out[0].directUrl);
  assert.match(res.buffer.toString('utf8'), /Γεια/);
});

test('όταν το files/search δεν βρει τίποτα, πέφτει σε αναζήτηση με imdb_id', async () => {
  const asked = [];
  const p = provider(async (url) => {
    asked.push(url);
    if (url.includes('/files/search')) return reply(NOT_FOUND_BODY);
    return reply({ status: true, subtitles: [LIVE_ROW] });
  });
  const out = await p.search({
    imdbId: 'tt15239678',
    type: 'movie',
    filename: 'η-δικη-μου-αντιγραφη.mkv',
    languages: ['en'],
  });
  assert.equal(asked.length, 2, 'πρώτα με filename, μετά με imdb_id');
  assert.match(asked[0], /files\/search/);
  assert.match(asked[1], /subtitles\/search/);
  assert.match(asked[1], /imdb_id=tt15239678/);
  assert.equal(out.length, 1, 'ο χρήστης παίρνει υπότιτλο παρόλο που το όνομα δεν αναγνωρίστηκε');
});

test('σε σειρές το type στέλνεται όπως το θέλει το SubDL (tv, όχι series)', async () => {
  let url = '';
  const p = provider(async (u) => {
    url = u;
    return reply({ status: true, subtitles: [LIVE_ROW] });
  });
  await p.search({ imdbId: 'tt0903747', type: 'series', season: '5', episode: '14', languages: ['en'] });
  assert.match(url, /type=tv/);
  assert.match(url, /season=5/);
  assert.match(url, /episode=14/);
  assert.match(url, /unpack=1/, 'χωρίς unpack δεν υπάρχουν ids αρχείων');
});
