import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCache } from '../src/cache.js';
import { createJobQueue } from '../src/jobs.js';
import { createOrchestrator, parseStremioId, videoKey } from '../src/orchestrator.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const EN_SRT = '1\n00:00:01,000 --> 00:00:02,000\nLine 1\n\n2\n00:00:03,000 --> 00:00:04,000\nLine 2\n';

const config = {
  targetLang: 'el',
  targetLangName: 'Ελληνικά',
  sourceLangs: ['en'],
  batchSize: 70,
  minMatchScore: 0.8,
};

// Το ψεύτικο μοντέλο μεταφράζει ΜΟΝΟ το πρώτο cue: έτσι ελέγχεται και η κάλυψη
// όταν το μοντέλο παραλείψει γραμμή (το δεύτερο cue μένει στο πρωτότυπο).
function fakeEngine(reply = '[{"id":1,"text":"Γεια"}]') {
  const calls = [];
  return {
    calls,
    name: 'gemini',
    isAvailable: async () => true,
    translateBatch: async ({ items }) => {
      calls.push(items.map((i) => i.id));
      return reply;
    },
  };
}

function harness({ greek = [], english = [{ id: 'en1', provider: 'subdl', releaseName: 'Release.EN', language: 'en', score: 0.95 }], engine, outputDir } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'grorch-'));
  // Ο πραγματικός config έχει πάντα outputDir, οπότε οι δοκιμές το έχουν επίσης —
  // εκτός από όποια δοκιμάζει ρητά τη συμπεριφορά χωρίς φάκελο output (outputDir: null).
  const outDir = outputDir === undefined ? join(dir, 'output') : outputDir;
  const calls = { search: [], download: [], searchArgs: [] };
  const provider = {
    name: 'subdl',
    isConfigured: () => true,
    async search({ languages, ...rest }) {
      calls.search.push(languages.join(','));
      calls.searchArgs.push({ languages, ...rest });
      const wanted = languages.includes('el');
      return wanted ? greek : english;
    },
    async download(candidate) {
      calls.download.push(candidate.id);
      return { buffer: Buffer.from(EN_SRT, 'utf8'), filename: `${candidate.id}.srt` };
    },
  };
  const eng = engine ?? fakeEngine();
  const cache = createCache(dir);
  const jobs = createJobQueue({ log: () => {} });
  const logs = [];
  const orchestrator = createOrchestrator({
    config: { ...config, ...(outDir ? { outputDir: outDir } : {}) },
    providers: [provider],
    engines: [eng],
    cache,
    jobs,
    log: (m) => logs.push(m),
  });
  return {
    orchestrator,
    cache,
    jobs,
    eng,
    calls,
    logs,
    dir,
    outDir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const MOVIE = { type: 'movie', imdbId: 'tt15239678', id: 'tt15239678', filename: 'Dune.2024.2160p.mkv' };

test('parseStremioId: ταινία, σειρά, σειρά με επεισόδιο', () => {
  assert.deepEqual(parseStremioId('tt15239678'), { imdbId: 'tt15239678', season: null, episode: null });
  assert.deepEqual(parseStremioId('tt0903747:5:14'), { imdbId: 'tt0903747', season: '5', episode: '14' });
  assert.deepEqual(parseStremioId('tt0903747:5'), { imdbId: 'tt0903747', season: '5', episode: null });
});

test('videoKey: ίδιο επεισόδιο -> ίδιο κλειδί, άλλο επεισόδιο -> άλλο', () => {
  const a = videoKey({ imdbId: 'tt0903747', season: '5', episode: '14' });
  const b = videoKey({ imdbId: 'tt0903747', season: '5', episode: '14' });
  const c = videoKey({ imdbId: 'tt0903747', season: '5', episode: '15' });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('προτιμά πραγματικούς ελληνικούς: καμία μετάφραση, κανένα job', async () => {
  const h = harness({
    greek: [{ id: 'el1', provider: 'subdl', releaseName: 'Greek.Sub', language: 'el', score: 0.92 }],
  });
  const out = await h.orchestrator.list(MOVIE);
  assert.equal(out.length, 1);
  assert.match(out[0].id, /^el-/);
  assert.equal(out[0].lang, 'el');
  assert.doesNotMatch(out[0].label, /μετάφραση/i, 'δεν διαφημίζει μετάφραση όταν ο υπότιτλος είναι πραγματικός');
  assert.equal(h.eng.calls.length, 0, 'δεν μεταφράζει όταν υπάρχει ελληνικός');
  assert.equal(h.jobs.list().length, 0, 'δεν μπαίνει τίποτα στην ουρά');
  assert.deepEqual(h.calls.search, ['el'], 'σταματά στην πρώτη πηγή που βρήκε ελληνικά');
  assert.equal(h.cache.list().length, 1, 'ο ελληνικός υπότιτλος αποθηκεύεται');
  h.cleanup();
});

test('χωρίς ελληνικούς: μεταφράζει τον αγγλικό και δίνει δείκτη προόδου', async () => {
  const h = harness();
  const out = await h.orchestrator.list(MOVIE);
  assert.equal(out.length, 1);
  assert.match(out[0].id, /^prog-/);
  assert.match(out[0].label, /εξέλιξη/i);
  await wait(60);
  assert.equal(h.jobs.list().length, 1);
  assert.equal(h.jobs.list()[0].state, 'done');
  h.cleanup();
});

test('όταν η μετάφραση τελειώσει: η επόμενη φορά δίνει έτοιμο υπότιτλο, με κάλυψη όσων cues έλειπαν', async () => {
  const h = harness();
  const before = await h.orchestrator.list(MOVIE);
  await wait(60);
  const out = await h.orchestrator.list(MOVIE);
  assert.equal(out.length, 1);
  assert.match(out[0].id, /^el-/);
  assert.equal(out[0].id, before[0].id.replace('prog-', 'el-'), 'ο έτοιμος υπότιτλος έχει σταθερό id για το έργο');
  assert.match(out[0].label, /μετάφραση/i, 'δηλώνει ότι είναι αυτόματη μετάφραση, όχι ανθρώπινη');

  const srt = await h.orchestrator.getSubtitle(out[0].id);
  assert.match(srt, /Γεια/, 'η μετάφραση');
  assert.match(srt, /Line 2/, 'το cue που το μοντέλο παράλειψε πέφτει στο πρωτότυπο');
  assert.ok(srt.startsWith('\uFEFF'), 'UTF-8 BOM για τους players');
  h.cleanup();
});

test('δεύτερη φορά: καμία νέα αναζήτηση, κανένα νέο κατέβασμα, ένα job', async () => {
  const h = harness();
  await h.orchestrator.list(MOVIE);
  await wait(60);
  const searches = h.calls.search.length;
  const downloads = h.calls.download.length;
  const jobs = h.jobs.list().length;
  await h.orchestrator.list(MOVIE);
  await h.orchestrator.list(MOVIE);
  assert.equal(h.calls.search.length, searches, 'το δεύτερο άνοιγμα δεν χτυπά ξανά τον provider');
  assert.equal(h.calls.download.length, downloads, 'δεν ξανακατεβάζει την πηγή');
  assert.equal(h.jobs.list().length, jobs);
  assert.equal(h.eng.calls.length, 1, 'η μετάφραση έγινε μία φορά');
  h.cleanup();
});

test('ενώ η μετάφραση τρέχει: πολλά ανοίγματα -> ένα job, όχι πολλαπλές μεταφράσεις', async () => {
  const h = harness();
  await h.orchestrator.list(MOVIE);
  await h.orchestrator.list(MOVIE);
  await h.orchestrator.list(MOVIE);
  await wait(80);
  assert.equal(h.jobs.list().length, 1);
  assert.equal(h.eng.calls.length, 1);
  h.cleanup();
});

test('δείκτης προόδου: σερβίρει ενημέρωση, όχι υπότιτλο με λάθος κείμενο', async () => {
  const h = harness();
  const out = await h.orchestrator.list(MOVIE);
  const srt = await h.orchestrator.getSubtitle(out[0].id);
  assert.match(srt, /εξέλιξη/i);
  assert.ok(h.orchestrator.isPending(out[0].id));
  h.cleanup();
});

test('χωρίς πηγές: κενή λίστα, όχι εξαίρεση', async () => {
  const h = harness({ greek: [], english: [] });
  const out = await h.orchestrator.list(MOVIE);
  assert.deepEqual(out, []);
  await wait(40);
  assert.equal(h.jobs.list().length, 0);
  h.cleanup();
});

test('μία μετάφραση ανά πηγή: το ίδιο αγγλικό αρχείο σε άλλη ταινία δεν ξαναμεταφράζεται', async () => {
  const h = harness();
  await h.orchestrator.list(MOVIE);
  await wait(60);
  assert.equal(h.eng.calls.length, 1);

  // Άλλη ταινία, ίδιο ακριβώς αγγλικό αρχείο ως πηγή.
  const other = { type: 'movie', imdbId: 'tt0000001', id: 'tt0000001', filename: 'Other.2020.mkv' };
  const out = await h.orchestrator.list(other);
  assert.match(out[0].id, /^el-/, 'βρίσκει έτοιμη μετάφραση χωρίς να ξανατρέξει μοντέλο');
  assert.equal(h.eng.calls.length, 1);
  h.cleanup();
});

test('σειρά: περνά σεζόν/επεισόδιο και τον τύπο στην πηγή, και σε κάθε επόμενη αναζήτηση', async () => {
  const h = harness();
  await h.orchestrator.list({ type: 'series', imdbId: 'tt0903747', id: 'tt0903747:5:14', filename: 'BB.S05E14.mkv' });
  await wait(60);
  assert.equal(h.jobs.list().length, 1);
  for (const args of h.calls.searchArgs) {
    assert.equal(args.type, 'series');
    assert.equal(args.imdbId, 'tt0903747');
    assert.equal(args.season, '5');
    assert.equal(args.episode, '14');
  }
  h.cleanup();
});

test('αποτυχία μετάφρασης: το job το αναφέρει και δεν ρίχνει τη διεργασία', async () => {
  const engine = {
    name: 'gemini',
    isAvailable: async () => true,
    translateBatch: async () => {
      throw new Error('όριο εξαντλήθηκε');
    },
  };
  const h = harness({ engine });
  await h.orchestrator.list(MOVIE);
  await wait(60);
  const job = h.jobs.list()[0];
  assert.equal(job.state, 'failed');
  assert.match(job.message, /όριο/);
  h.cleanup();
});

test('ο δείκτης προόδου σβήνει όταν ο υπότιτλος είναι έτοιμος', async () => {
  const h = harness();
  const first = await h.orchestrator.list(MOVIE);
  await wait(60);
  assert.equal(h.orchestrator.isPending(first[0].id), false);
  h.cleanup();
});

test('getSubtitle: άγνωστο id -> null', async () => {
  const h = harness();
  assert.equal(await h.orchestrator.getSubtitle('el-άγνωστο'), null);
  h.cleanup();
});

test('βλάβη του provider δεν αφήνει τον χρήστη χωρίς τίποτα', async () => {
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
  const dir = mkdtempSync(join(tmpdir(), 'grorch-broken-'));
  const logs = [];
  const o = createOrchestrator({
    config,
    providers: [broken],
    engines: [fakeEngine()],
    cache: createCache(dir),
    jobs: createJobQueue({ log: () => {} }),
    log: (m) => logs.push(m),
  });
  assert.deepEqual(await o.list(MOVIE), []);
  assert.ok(logs.some((l) => /δίκτυο κάτω/.test(l)), 'το σφάλμα καταγράφεται για διάγνωση');
  rmSync(dir, { recursive: true, force: true });
});

// --- Φάκελος output: έτοιμα αρχεία για upload, με όνομα από το βίντεο ---

const YTS_MOVIE = {
  type: 'movie',
  imdbId: 'tt15239678',
  id: 'tt15239678',
  filename: 'Teenage.Sex.And.Death.At.Camp.Miasma.2026.1080p.WEBRip.x264.AAC-[YTS.GG - YTS.BZ].mp4',
};
const YTS_NAME = 'Teenage.Sex.And.Death.At.Camp.Miasma.2026.1080p.WEBRip.x264.AAC-[YTS.GG - YTS.BZ]-Greek.srt';

test('ο μεταφρασμένος υπότιτλος βγαίνει στο output/ με το όνομα του βίντεο', async () => {
  const h = harness();
  await h.orchestrator.list(YTS_MOVIE);
  await wait(80);
  assert.ok(existsSync(join(h.outDir, YTS_NAME)), `περίμενε το ${YTS_NAME} στο output/`);

  const elKey = `el-${videoKey({ imdbId: 'tt15239678' })}`;
  const written = readFileSync(join(h.outDir, YTS_NAME), 'utf8');
  assert.equal(written, await h.orchestrator.getSubtitle(elKey), 'το αρχείο είναι ακριβώς ό,τι σερβίρει το Stremio');
  assert.match(written, /Γεια/);
  assert.equal(h.cache.meta(elKey).outputFile, YTS_NAME, 'το κλειδί θυμάται ποιο αρχείο βγήκε');
  h.cleanup();
});

test('πραγματικοί ελληνικοί: και αυτοί βγαίνουν στο output/, χωρίς μετάφραση', async () => {
  const h = harness({
    greek: [{ id: 'el1', provider: 'subdl', releaseName: 'Greek.Sub', language: 'el', score: 0.92 }],
  });
  await h.orchestrator.list(MOVIE);
  assert.ok(existsSync(join(h.outDir, 'Dune.2024.2160p-Greek.srt')));
  assert.equal(h.eng.calls.length, 0);
  h.cleanup();
});

test('άλλο release, ίδιος υπότιτλος: δεύτερο αρχείο με το νέο όνομα, καμία νέα μετάφραση', async () => {
  const h = harness();
  await h.orchestrator.list(MOVIE);
  await wait(80);
  const other = { ...MOVIE, filename: 'Dune.Part.Two.2024.1080p.WEBRip.x264-YTS.mp4' };
  await h.orchestrator.list(other);

  assert.ok(existsSync(join(h.outDir, 'Dune.2024.2160p-Greek.srt')), 'το πρώτο αρχείο μένει');
  assert.ok(existsSync(join(h.outDir, 'Dune.Part.Two.2024.1080p.WEBRip.x264-YTS-Greek.srt')), 'και το νέο όνομα');
  assert.equal(h.eng.calls.length, 1, 'η μετάφραση έγινε μία φορά');
  h.cleanup();
});

test('χωρίς όνομα αρχείου από τον player: εφεδρεία το όνομα του release', async () => {
  const h = harness();
  await h.orchestrator.list({ type: 'movie', imdbId: 'tt55555', id: 'tt55555' });
  await wait(80);
  assert.ok(existsSync(join(h.outDir, 'Release.EN-Greek.srt')));
  h.cleanup();
});

test('το ξανάνοιγμα του μενού δεν ξαναγράφει το αρχείο που έχει ήδη ανεβεί', async () => {
  const h = harness();
  await h.orchestrator.list(MOVIE);
  await wait(80);
  const path = join(h.outDir, 'Dune.2024.2160p-Greek.srt');
  const before = statSync(path).mtime.toISOString();

  await h.orchestrator.list(MOVIE);
  await h.orchestrator.list(MOVIE);
  assert.equal(statSync(path).mtime.toISOString(), before, 'ίδιο περιεχόμενο = καμία εγγραφή');
  assert.equal(h.eng.calls.length, 1);
  h.cleanup();
});

test('χωρίς ρυθμισμένο output: όλα δουλεύουν, απλώς δεν γράφεται αρχείο', async () => {
  const h = harness({ outputDir: null });
  const out = await h.orchestrator.list(MOVIE);
  assert.match(out[0].id, /^prog-/);
  await wait(80);
  const elKey = `el-${videoKey({ imdbId: 'tt15239678' })}`;
  assert.ok(await h.orchestrator.getSubtitle(elKey), 'ο υπότιτλος σερβίρεται κανονικά');
  assert.equal(h.cache.meta(elKey).outputFile, undefined);
  h.cleanup();
});
