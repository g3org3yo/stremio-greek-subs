import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAddonServer } from '../src/server.js';
import { createCache, isSafeKey } from '../src/cache.js';
import { createJobQueue } from '../src/jobs.js';
import { createOrchestrator } from '../src/orchestrator.js';

const EN_SRT = '1\n00:00:01,000 --> 00:00:02,000\nLine 1\n\n2\n00:00:03,000 --> 00:00:04,000\nLine 2\n';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const config = {
  baseUrl: 'http://127.0.0.1:7000',
  targetLang: 'el',
  targetLangName: 'Ελληνικά',
  sourceLangs: ['en'],
  batchSize: 70,
  providerOrder: ['subdl'],
  subdlApiKey: 'μυστικό-κλειδί-που-δεν-πρέπει-να-διαρρεύσει',
  geminiApiKey: '',
  lmstudioBaseUrl: 'http://127.0.0.1:1234/v1',
};

async function withServer(fn, { english } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'srv-'));
  const logFile = join(dir, 'addon.log');
  const calls = { searchArgs: [] };
  const provider = {
    name: 'subdl',
    isConfigured: () => true,
    async search(args) {
      calls.searchArgs.push(args);
      if (args.languages.includes('el')) return [];
      return english ?? [{ id: 'en1', provider: 'subdl', releaseName: 'Release.EN', language: 'en', score: 0.9 }];
    },
    async download() {
      return { buffer: Buffer.from(EN_SRT, 'utf8'), filename: 'en.srt' };
    },
  };
  const engine = {
    name: 'gemini',
    isAvailable: async () => true,
    translateBatch: async () => '[{"id":1,"text":"Γεια"}]',
  };
  const cache = createCache(dir);
  const jobs = createJobQueue({ log: () => {} });
  const orchestrator = createOrchestrator({ config, providers: [provider], engines: [engine], cache, jobs, log: () => {} });
  const server = createAddonServer({ config, orchestrator, cache, jobs, logFile, log: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn({ base, cache, jobs, calls, logFile, dir });
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
}

const get = (base, path) => fetch(`${base}${path}`);

// Το fetch/URL κανονικοποιεί τα `..` ΠΡΙΝ φύγει το αίτημα, οπότε δεν μπορεί να
// ελέγξει τι κάνει ο server με ένα ακατέργαστο μονοπάτι. Εδώ στέλνουμε ό,τι θέλουμε.
function rawGet(base, rawPath) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request({ hostname, port, path: rawPath, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        body += c;
      });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('manifest: δηλώνει subtitles για ταινίες και σειρές με ids tt', async () => {
  await withServer(async ({ base }) => {
    const res = await get(base, '/manifest.json');
    assert.equal(res.status, 200);
    const m = await res.json();
    assert.deepEqual(m.resources, ['subtitles']);
    assert.deepEqual(m.types, ['movie', 'series']);
    assert.deepEqual(m.idPrefixes, ['tt']);
    assert.ok(m.version && m.name);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });
});

test('subtitles: πρώτη φορά δίνει δείκτη προόδου με απόλυτο url', async () => {
  await withServer(async ({ base }) => {
    const res = await get(base, '/subtitles/movie/tt15239678.json');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const { subtitles } = await res.json();
    assert.equal(subtitles.length, 1);
    assert.match(subtitles[0].id, /^prog-/);
    assert.equal(subtitles[0].url, `${base}/s/${subtitles[0].id}`);
    assert.equal(subtitles[0].lang, 'el');
  });
});

test('subtitles: μετά τη μετάφραση δίνει έτοιμο υπότιτλο που σερβίρεται σωστά', async () => {
  await withServer(async ({ base }) => {
    await get(base, '/subtitles/movie/tt15239678.json');
    await wait(80);
    const { subtitles } = await (await get(base, '/subtitles/movie/tt15239678.json')).json();
    assert.equal(subtitles.length, 1);
    assert.match(subtitles[0].id, /^el-/);

    const srt = await fetch(subtitles[0].url);
    assert.equal(srt.status, 200);
    assert.match(srt.headers.get('content-type'), /application\/x-subrip/);
    assert.match(srt.headers.get('cache-control'), /max-age/);
    // Ελέγχουμε τα BYTES: ο decoder του fetch αφαιρεί το BOM, αλλά ο player που
    // κατεβάζει το αρχείο το βλέπει — κι αυτό είναι που μετράει.
    const bytes = Buffer.from(await srt.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM');
    const body = bytes.toString('utf8');
    assert.match(body, /Γεια/);
    assert.match(body, /Line 2/, 'ό,τι δεν μεταφράστηκε μένει στο πρωτότυπο');
  });
});

test('subtitles: περνά το filename του release στην αναζήτηση', async () => {
  await withServer(async ({ base, calls }) => {
    await get(base, '/subtitles/movie/tt15239678/filename=Dune%20Part%20Two%202024.mkv.json');
    assert.equal(calls.searchArgs[0].filename, 'Dune Part Two 2024.mkv');
  });
});

test('subtitles: σειρά με σεζόν/επεισόδιο στο id', async () => {
  await withServer(async ({ base, calls }) => {
    const res = await get(base, '/subtitles/series/tt0903747%3A5%3A14.json');
    assert.equal(res.status, 200);
    assert.equal(calls.searchArgs[0].season, '5');
    assert.equal(calls.searchArgs[0].episode, '14');
  });
});

test('subtitles: αν η πηγή σκάσει, απαντά κενή λίστα και όχι σφάλμα', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'srv-broken-'));
  const broken = {
    name: 'subdl',
    isConfigured: () => true,
    search: async () => {
      throw new Error('δίκτυο κάτω');
    },
    download: async () => {
      throw new Error('δίκτυο κάτω');
    },
  };
  const cache = createCache(dir);
  const jobs = createJobQueue({ log: () => {} });
  const orchestrator = createOrchestrator({
    config,
    providers: [broken],
    engines: [],
    cache,
    jobs,
    log: () => {},
  });
  const server = createAddonServer({ config, orchestrator, cache, jobs, log: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await get(base, '/subtitles/movie/tt1.json');
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).subtitles, []);
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

test('/s/: άγνωστο αρχείο -> 404', async () => {
  await withServer(async ({ base }) => {
    assert.equal((await get(base, '/s/el-δεν-υπάρχει')).status, 404);
  });
});

test('/s/: απόπειρα διαδρομής έξω από τον φάκελο cache -> 404, χωρίς διαρροή', async () => {
  await withServer(async ({ base, dir }) => {
    // Λατινικό όνομα: το node:http αρνείται μη-κωδικοποιημένους μη-ASCII χαρακτήρες
    // στο μονοπάτι, και θέλουμε ακατέργαστο μονοπάτι χωρίς κανονικοποίηση.
    writeFileSync(join(dir, '..', 'outside.srt'), 'ΜΥΣΤΙΚΟ-ΠΕΡΙΕΧΟΜΕΝΟ', 'utf8');
    const attacks = [
      '/s/../outside',
      '/s/../../package.json',
      '/s/..%2F..%2Foutside',
      '/s/%2e%2e/%2e%2e/package.json',
      '/s/....//../secret',
      '/s/a%00b',
      '/s/C:\\Windows\\win.ini',
      '/s/%2e%2e%5c%2e%2e%5cwindows%5cwin.ini',
      '/s/%2Fetc%2Fpasswd',
    ];
    for (const attack of attacks) {
      const res = await rawGet(base, attack);
      assert.equal(res.status, 404, `δεν πρέπει να σερβιριστεί: ${attack}`);
      assert.equal(res.body.includes('ΜΥΣΤΙΚΟ-ΠΕΡΙΕΧΟΜΕΝΟ'), false, `διαρροή μέσω: ${attack}`);
    }

    // Τα σκέτα `/s/..` και `/s/.` τα κανονικοποιεί ο Node πριν φτάσουν στον κώδικα
    // (γίνονται `/`), οπότε δεν είναι θέμα εγκυρότητας κλειδιού αλλά ιδιωτικότητας:
    // αρκεί να μη διαρρέει περιεχόμενο αρχείου.
    for (const normalized of ['/s/..', '/s/.', '/s/x/..']) {
      const res = await rawGet(base, normalized);
      assert.equal(res.body.includes('ΜΥΣΤΙΚΟ-ΠΕΡΙΕΧΟΜΕΝΟ'), false, `διαρροή μέσω: ${normalized}`);
    }
    rmSync(join(dir, '..', 'outside.srt'), { force: true });
  });
});

test('subtitles: τα urls ακολουθούν το Host του αιτήματος, όχι σταθερή θύρα', async () => {
  await withServer(async ({ base }) => {
    const { subtitles } = await (await get(base, '/subtitles/movie/tt15239678.json')).json();
    assert.ok(
      subtitles[0].url.startsWith(base),
      `το url πρέπει να δείχνει στον server που απάντησε: ${subtitles[0].url} vs ${base}`,
    );
  });
});

test('isSafeKey: δέχεται τα κλειδιά μας και κόβει διαδρομές', () => {
  assert.equal(isSafeKey('el-a79e500da14b'), true);
  assert.equal(isSafeKey('prog-a79e500da14b'), true);
  assert.equal(isSafeKey('..'), false);
  assert.equal(isSafeKey('../x'), false);
  assert.equal(isSafeKey('a/b'), false);
  assert.equal(isSafeKey('C:\\Windows\\win.ini'), false);
  assert.equal(isSafeKey(''), false);
  assert.equal(isSafeKey('a'.repeat(65)), false);
});

test('/health και /admin: έλεγχος χωρίς διαρροή κλειδιών', async () => {
  await withServer(async ({ base }) => {
    assert.deepEqual(await (await get(base, '/health')).json(), { ok: true });

    const adminRes = await get(base, '/admin');
    assert.equal(adminRes.status, 200);
    assert.equal(adminRes.headers.get('access-control-allow-origin'), null, 'ο πίνακας ελέγχου δεν μοιράζεται με ιστοσελίδες');
    assert.equal((await get(base, '/')).headers.get('access-control-allow-origin'), null);
    assert.equal((await get(base, '/manifest.json')).headers.get('access-control-allow-origin'), '*', 'ο player το χρειάζεται');
    const raw = await adminRes.text();
    assert.equal(raw.includes(config.subdlApiKey), false, 'τα κλειδιά δεν βγαίνουν ποτέ από το /admin');
    const admin = JSON.parse(raw);
    assert.equal(admin.config.subdlKeyPresent, true);
    assert.equal(admin.config.geminiKeyPresent, false);
    assert.deepEqual(admin.config.providerOrder, ['subdl']);
    assert.ok(Array.isArray(admin.jobs));
    assert.ok(Array.isArray(admin.recent));
    assert.ok(Array.isArray(admin.logTail));
  });
});

test('/: σελίδα με οδηγίες εγκατάστασης', async () => {
  await withServer(async ({ base }) => {
    const html = await (await get(base, '/')).text();
    assert.match(html, /stremio:\/\/127\.0\.0\.1:\d+\/manifest\.json/);
    assert.match(html, /Ελληνικοί/);
  });
});

test('/: άγνωστη διαδρομή -> 404', async () => {
  await withServer(async ({ base }) => {
    assert.equal((await get(base, '/κάτι-άλλο')).status, 404);
  });
});
