import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import AdmZip from 'adm-zip';
import { createSubdlProvider, toSubdlLang } from '../src/providers/subdl.js';
import { createProviders } from '../src/providers/index.js';

const fixture = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));

function zipBuffer(name, content) {
  const zip = new AdmZip();
  zip.addFile(name, Buffer.from(content, 'utf8'));
  return zip.toBuffer();
}

function provider(handler, extra = {}) {
  return createSubdlProvider({ apiKey: 'k', minMatchScore: 0.8, fetchImpl: handler, ...extra });
}

const SRT = '1\n00:00:01,000 --> 00:00:02,000\nHello\n';

test('toSubdlLang: το SubDL θέλει ISO 639-1', () => {
  assert.equal(toSubdlLang('ell'), 'el');
  assert.equal(toSubdlLang('eng'), 'en');
  assert.equal(toSubdlLang('el'), 'el');
  assert.equal(toSubdlLang('fa'), 'fa');
});

test('search: χρησιμοποιεί files/search όταν υπάρχει filename και φιλτράρει κάτω από minMatchScore', async () => {
  let captured;
  const p = provider(async (url, opts) => {
    captured = { url, headers: opts.headers };
    return { ok: true, status: 200, headers: new Map(), json: async () => fixture('subdl-files-search.json'), text: async () => '' };
  });
  const out = await p.search({
    imdbId: 'tt15239678',
    type: 'movie',
    filename: 'Dune.Part.Two.2024.2160p.WEB-DL-GROUP.mkv',
    languages: ['en'],
  });
  assert.match(captured.url, /^https:\/\/api\.subdl\.com\/api\/v2\/files\/search\?/);
  assert.match(captured.url, /filename=Dune/);
  assert.match(captured.url, /languages=en/);
  assert.equal(captured.headers.authorization, 'Bearer k');
  assert.equal(out.length, 1, 'το 0.41 κόβεται, το 0.94 περνά');
  assert.equal(out[0].id, 'aaa');
  assert.equal(out[0].releaseName, 'Dune.Part.Two.2024.2160p.WEB-DL-GROUP');
  assert.equal(out[0].language, 'en');
  assert.equal(out[0].score, 0.94);
});

test('search: ταξινομεί κατά match_score, όχι κατά σειρά απάντησης', async () => {
  const shuffled = fixture('subdl-files-search.json');
  shuffled.subtitles.reverse();
  const p = provider(async () => ({ ok: true, status: 200, json: async () => shuffled, text: async () => '' }));
  const out = await p.search({ filename: 'x.mkv', type: 'movie', languages: ['en'] });
  assert.equal(out[0].id, 'aaa');
});

test('search: κρατά το nId και το url λήψης του αποτελέσματος', async () => {
  const p = provider(async () => ({ ok: true, status: 200, json: async () => fixture('subdl-files-search.json'), text: async () => '' }));
  const out = await p.search({ filename: 'x.mkv', type: 'movie', languages: ['en'] });
  assert.equal(out[0].id, 'aaa');
  assert.equal(out[0].directUrl, null, 'η v2 μορφή έχει nId· δεν χρειάζεται dl.subdl.com');
});

test('search: δέχεται τη legacy μορφή με σκέτο url και ξέρει από πού να κατεβάσει', async () => {
  const p = provider(async () => ({ ok: true, status: 200, json: async () => fixture('subdl-files-search-urlonly.json'), text: async () => '' }));
  const out = await p.search({ filename: 'x.mkv', type: 'movie', languages: ['en'] });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, '3197651', 'το nId βγαίνει από το url');
  assert.equal(out[0].directUrl, 'https://dl.subdl.com/subtitle/3197651-3213944.zip');
});

test('search: χωρίς filename πέφτει σε subtitles/search με imdb_id', async () => {
  let captured;
  const p = provider(async (url) => {
    captured = url;
    return { ok: true, status: 200, json: async () => fixture('subdl-subtitles-search.json'), text: async () => '' };
  });
  const out = await p.search({ imdbId: 'tt0903747', type: 'series', season: '5', episode: '14', languages: ['en'] });
  assert.match(captured, /\/api\/v2\/subtitles\/search\?/);
  assert.match(captured, /imdb_id=tt0903747/);
  assert.match(captured, /season=5/);
  assert.match(captured, /episode=14/);
  assert.equal(out.length, 1);
  assert.equal(out[0].releaseName, 'Breaking.Bad.S05E14.1080p.BluRay.x264-DEMAND');
});

test('search: χωρίς match_score δεν φιλτράρουμε με minMatchScore', async () => {
  const p = provider(async () => ({ ok: true, status: 200, json: async () => fixture('subdl-subtitles-search.json'), text: async () => '' }));
  const out = await p.search({ imdbId: 'tt0903747', type: 'series', season: '5', episode: '14', languages: ['en'] });
  assert.equal(out.length, 1);
  assert.equal(out[0].score, null);
});

test('search: ζητά ελληνικούς με κωδικό el (ISO 639-1)', async () => {
  let captured;
  const p = provider(async (url) => {
    captured = url;
    return { ok: true, status: 200, json: async () => ({ status: true, subtitles: [] }), text: async () => '' };
  });
  await p.search({ imdbId: 'tt15239678', type: 'movie', languages: ['el'] });
  assert.match(captured, /languages=el/);
});

test('search: πολλές γλώσσες ενώνονται με κόμμα', async () => {
  let captured;
  const p = provider(async (url) => {
    captured = url;
    return { ok: true, status: 200, json: async () => ({ status: true, subtitles: [] }), text: async () => '' };
  });
  await p.search({ imdbId: 'tt1', type: 'movie', languages: ['el', 'en'] });
  assert.match(captured, /languages=el%2Cen/);
});

test('search: αγνοεί γραμμές χωρίς ταυτότητα και χωρίς release_name', async () => {
  const data = {
    status: true,
    subtitles: [
      { release_name: 'Καλή', lang: 'english', match_score: 0.9, url: '/subtitle/good-1.zip' },
      { lang: 'english', match_score: 0.9, url: '/subtitle/noname-1.zip' },
      { release_name: 'Χωρίς ταυτότητα', lang: 'english', match_score: 0.9 },
    ],
  };
  const p = provider(async () => ({ ok: true, status: 200, json: async () => data, text: async () => '' }));
  const out = await p.search({ imdbId: 'tt1', type: 'movie', languages: ['en'], filename: undefined });
  assert.equal(out.length, 1);
  assert.equal(out[0].releaseName, 'Καλή');
});

test('search: 429 -> σφάλμα με quotaExhausted', async () => {
  const p = provider(async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: { code: 'quota_exceeded', message: 'Daily request quota exceeded.' } }),
    text: async () => 'quota_exceeded',
  }));
  await assert.rejects(
    () => p.search({ imdbId: 'tt1', type: 'movie', languages: ['en'] }),
    (err) => err.quotaExhausted === true && /quota_exceeded/.test(err.message),
  );
});

test('search: 200 με σώμα σφάλματος quota_exceeded -> επίσης εξάντληση', async () => {
  const p = provider(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ error: { code: 'quota_exceeded', message: 'Daily request quota exceeded.' } }),
    text: async () => '',
  }));
  await assert.rejects(
    () => p.search({ imdbId: 'tt1', type: 'movie', languages: ['en'] }),
    (err) => err.quotaExhausted === true,
  );
});

test('search: 401 -> καθαρό σφάλμα κλειδιού, χωρίς quotaExhausted', async () => {
  const p = provider(async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: { code: 'unauthorized', message: 'Invalid API key.' } }),
    text: async () => 'unauthorized',
  }));
  await assert.rejects(
    () => p.search({ imdbId: 'tt1', type: 'movie', languages: ['en'] }),
    (err) => err.quotaExhausted !== true && /401/.test(err.message),
  );
});

test('download: αποσυμπιέζει zip και διαλέγει το αρχείο με τη σωστή επέκταση', async () => {
  let captured;
  const p = provider(async (url) => {
    captured = url;
    return { ok: true, status: 200, arrayBuffer: async () => zipBuffer('sub.srt', SRT), text: async () => '' };
  });
  const { buffer, filename } = await p.download({ id: 'aaa' });
  assert.equal(captured, 'https://api.subdl.com/api/v2/subtitles/aaa/download?format=zip');
  assert.equal(filename, 'sub.srt');
  assert.match(buffer.toString('utf8'), /Hello/);
});

test('download: διαλέγει το μεγαλύτερο αρχείο όταν το zip έχει πολλά', async () => {
  const zip = new AdmZip();
  zip.addFile('readme.txt', Buffer.from('x'));
  zip.addFile('small.srt', Buffer.from('1\n00:00:01,000 --> 00:00:02,000\na\n'));
  zip.addFile('full.srt', Buffer.from(`${SRT}\n2\n00:00:03,000 --> 00:00:04,000\nMore\n`));
  const p = provider(async () => ({ ok: true, status: 200, arrayBuffer: async () => zip.toBuffer(), text: async () => '' }));
  const { buffer, filename } = await p.download({ id: 'aaa' });
  assert.equal(filename, 'full.srt');
  assert.match(buffer.toString('utf8'), /More/);
});

test('download: αγνοεί μη-υποτιτλικά αρχεία μέσα στο zip', async () => {
  const zip = new AdmZip();
  zip.addFile('info.nfo', Buffer.from('n'.repeat(500)));
  zip.addFile('sub.srt', Buffer.from(SRT));
  const p = provider(async () => ({ ok: true, status: 200, arrayBuffer: async () => zip.toBuffer(), text: async () => '' }));
  assert.equal((await p.download({ id: 'aaa' })).filename, 'sub.srt');
});

test('download: δέχεται και σκέτο srt χωρίς zip', async () => {
  const p = provider(async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from(SRT, 'utf8'), text: async () => '' }));
  const { buffer, filename } = await p.download({ id: 'aaa' });
  assert.equal(filename, 'aaa.srt');
  assert.match(buffer.toString('utf8'), /Hello/);
});

test('download: χρησιμοποιεί το directUrl όταν το αποτέλεσμα δεν έχει nId', async () => {
  let captured;
  const p = provider(async (url) => {
    captured = url;
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(SRT, 'utf8'), text: async () => '' };
  });
  await p.download({ id: '3197651', directUrl: 'https://dl.subdl.com/subtitle/3197651-3213944.zip' });
  assert.equal(captured, 'https://dl.subdl.com/subtitle/3197651-3213944.zip');
});

test('download: rar -> καθαρό ελληνικό μήνυμα, όχι σκουπίδια', async () => {
  const rar = Buffer.concat([Buffer.from('Rar!\u001a\u0007\u0000', 'latin1'), Buffer.alloc(32)]);
  const p = provider(async () => ({ ok: true, status: 200, arrayBuffer: async () => rar, text: async () => '' }));
  await assert.rejects(() => p.download({ id: 'aaa' }), /rar/);
});

test('download: 404 -> σφάλμα με τον κωδικό', async () => {
  const p = provider(async () => ({
    ok: false,
    status: 404,
    json: async () => ({ error: { code: 'not_found', message: 'Subtitle not found.' } }),
    text: async () => 'not_found',
  }));
  await assert.rejects(() => p.download({ id: 'aaa' }), /404/);
});

test('quota: διαβάζει το /api/v2/me', async () => {
  let captured;
  const p = provider(async (url, opts) => {
    captured = { url, headers: opts.headers };
    return { ok: true, status: 200, json: async () => fixture('subdl-me.json'), text: async () => '' };
  });
  const q = await p.quota();
  assert.equal(captured.url, 'https://api.subdl.com/api/v2/me');
  assert.equal(captured.headers.authorization, 'Bearer k');
  assert.equal(q.downloads.remaining, 47);
  assert.equal(q.searches.limit, 2000);
  assert.equal(q.plan.name, 'Free');
});

test('provider: isConfigured ψευδές χωρίς κλειδί', () => {
  assert.equal(createSubdlProvider({ apiKey: '', fetchImpl: fetch }).isConfigured(), false);
  assert.equal(provider(async () => ({})).isConfigured(), true);
});

test('createProviders: αγνοεί providers χωρίς κλειδί και σέβεται τη σειρά', () => {
  const none = createProviders({ subdlApiKey: '', providerOrder: ['subdl', 'opensubtitles'] }, fetch);
  assert.equal(none.length, 0);
  const withKey = createProviders({ subdlApiKey: 'k', providerOrder: ['subdl', 'opensubtitles'] }, fetch);
  assert.deepEqual(withKey.map((p) => p.name), ['subdl']);
});
