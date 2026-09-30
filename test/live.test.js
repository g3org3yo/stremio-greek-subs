import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { createGeminiEngine } from '../src/translate/gemini.js';
import { createSubdlProvider } from '../src/providers/subdl.js';
import { createProviders } from '../src/providers/index.js';
import { createApp } from '../src/index.js';

// Δοκιμές που βγαίνουν στο δίκτυο: θέλουν πραγματικά κλειδιά και καίνε όριο πηγής.
//   LIVE=1 npm test            -> μόνο τα φτηνά (όριο, μετάφραση δύο γραμμών, αναζήτηση)
//   LIVE=1 LIVE_E2E=1 npm test -> και οι δύο ολόκληρες ροές (κατεβάζει + μεταφράζει)
// Είναι σκόπιμα ξεχωριστές: οι κανονικές δοκιμές δεν αγγίζουν καθόλου δίκτυο.
const live = process.env.LIVE === '1' ? false : 'χρειάζεται LIVE=1';
const e2e = process.env.LIVE_E2E === '1' ? false : 'χρειάζεται LIVE_E2E=1';

// Το addon σε απομονωμένο φάκελο αλλά ΜΕ τα πραγματικά κλειδιά: το .env του project
// δεν βρίσκεται εκεί, οπότε τα περνάμε ως μεταβλητές περιβάλλοντος.
function isolatedApp(root) {
  const real = loadConfig({ env: process.env });
  return createApp({
    root,
    env: {
      ...process.env,
      SUBDL_API_KEY: real.subdlApiKey,
      GEMINI_API_KEY: real.geminiApiKey,
      GEMINI_BASE_URL: real.geminiBaseUrl,
      CACHE_DIR: join(root, 'cache'),
      TARGET_LANG: 'el',
      SOURCE_LANGS: 'en',
    },
  });
}

async function waitForJob(app, ms = 10 * 60 * 1000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const job = app.orchestrator.status().jobs.at(-1);
    if (job && (job.state === 'done' || job.state === 'failed')) return job;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('η μετάφραση δεν τελείωσε μέσα στο χρονικό όριο');
}

const greek = (text) => /[\u0370-\u03ff]{3,}/.test(text);

test('LIVE: το SubDL κλειδί δίνει όριο', { skip: live }, async () => {
  const config = loadConfig({ env: process.env });
  const quota = await createSubdlProvider({ apiKey: config.subdlApiKey }).quota();
  assert.equal(quota.plan.name, 'Free');
  console.log(`      SubDL: ${quota.searches.remaining}/${quota.searches.limit} αναζητήσεις, ${quota.downloads.remaining}/${quota.downloads.limit} λήψεις`);
});

test('LIVE: το Gemini μεταφράζει πραγματικά στα ελληνικά', { skip: live }, async () => {
  const config = loadConfig({ env: process.env });
  const engine = createGeminiEngine({
    apiKey: config.geminiApiKey,
    model: config.geminiModel,
    baseUrl: config.geminiBaseUrl,
    timeoutMs: config.geminiTimeoutMs,
  });
  const items = [
    { id: 1, text: 'Where did you park the car, my friend?' },
    { id: 2, text: 'I need you to stay here and wait for me.' },
  ];
  const out = JSON.parse(await engine.translateBatch({ items, targetLangName: 'Ελληνικά', context: 'διάλογος ταινίας' }));
  assert.equal(out.length, items.length);
  for (const row of out) assert.match(row.text, /[\u0370-\u03ff]/, `πρέπει να είναι ελληνικό: ${row.text}`);
  console.log(`      Gemini: ${JSON.stringify(out)}`);
});

test('LIVE: υπάρχουν πραγματικοί ελληνικοί υπότιτλοι στην πηγή', { skip: live }, async () => {
  const config = loadConfig({ env: process.env });
  const providers = createProviders(config);
  assert.ok(providers.length > 0, 'χρειάζεται SUBDL_API_KEY');
  const found = await providers[0].search({ imdbId: 'tt15239678', type: 'movie', languages: ['el', 'en'] });
  const el = found.filter((c) => c.language === 'el');
  console.log(`      ${found.length} αποτέλεσματα, ${el.length} ελληνικά: ${el.slice(0, 3).map((c) => c.releaseName.slice(0, 40)).join(' | ')}`);
  assert.ok(found.every((c) => ['en', 'el'].includes(c.language)), 'καμία άλλη γλώσσα δεν πρέπει να περνά');
  assert.ok(el.length > 0, 'το SubDL έχει ελληνικούς για το tt15239678');
});

// Πλήρης ροή 1: υπάρχουν πραγματικοί ελληνικοί -> κατεβαίνουν όπως είναι, ΧΩΡΙΣ μετάφραση.
test('LIVE Ε2Ε: ταινία με πραγματικούς ελληνικούς -> σερβίρεται ο πραγματικός', { skip: e2e }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'live-el-'));
  const app = isolatedApp(root);
  try {
    const list = await app.orchestrator.list({ type: 'movie', id: 'tt15239678' });
    assert.equal(list.length, 1);
    const id = list[0].id;
    assert.match(id, /^el-/, 'δεν χρειάζεται μετάφραση: υπάρχει ελληνικός');
    assert.ok(!id.startsWith('prog-'), 'δεν πρέπει να μπει σε ουρά μετάφρασης');
    const srt = await app.orchestrator.getSubtitle(id);
    assert.ok(greek(srt), 'το SRT περιέχει ελληνικά');
    assert.equal(app.orchestrator.status().jobs.length, 0, 'καμία μετάφραση δεν ξεκίνησε');
    const cues = srt.split(/\r?\n\r?\n/).filter((b) => b.includes('-->')).length;
    console.log(`      πραγματικός ελληνικός: ${cues} cues, ${srt.length} χαρακτήρες`);
    console.log(`      ${srt.split(/\r?\n/).slice(2, 5).join(' · ')}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Πλήρης ροή 2: ΔΕΝ υπάρχουν ελληνικοί -> αγγλική πηγή -> μετάφραση -> ελληνικός SRT.
test('LIVE Ε2Ε: επεισόδιο χωρίς ελληνικούς -> μεταφράζεται μία φορά και μετά είναι έτοιμος', { skip: e2e }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'live-tr-'));
  const app = isolatedApp(root);
  // Το Office S3E1: το SubDL έχει 10 αγγλικούς και κανέναν ελληνικό (ελέγχθηκε ζωντανά).
  const id = process.env.LIVE_TRANSLATE_TITLE ?? 'tt0386676:3:1';
  try {
    const list = await app.orchestrator.list({ type: 'series', id });
    assert.equal(list.length, 1, 'υπάρχει αγγλική πηγή για μετάφραση');
    assert.match(list[0].id, /^prog-/, 'χωρίς ελληνικούς, μπαίνει σε ουρά μετάφρασης');
    console.log(`      ${list[0].label}`);

    const job = await waitForJob(app);
    assert.equal(job.state, 'done', `η μετάφραση απέτυχε: ${job.message}`);
    console.log(`      μετάφραση: ${job.result.translated}/${job.result.total} cues με ${app.orchestrator.status().translation.engines?.join?.(', ') ?? ''}`);

    const again = await app.orchestrator.list({ type: 'series', id });
    const readyId = again[0].id;
    assert.match(readyId, /^el-/, 'μετά τη μετάφραση ο υπότιτλος είναι έτοιμος με σταθερό id');
    const srt = await app.orchestrator.getSubtitle(readyId);
    assert.ok(greek(srt), 'το SRT περιέχει ελληνικό κείμενο');
    const cues = srt.split(/\r?\n\r?\n/).filter((b) => b.includes('-->')).length;
    console.log(`      ελληνικός SRT: ${cues} cues, ${srt.length} χαρακτήρες`);
    console.log(`      ${srt.split(/\r?\n/).slice(2, 6).join(' · ')}`);

    // Το δεύτερο άνοιγμα του μενού δεν ξεκινά νέα μετάφραση: ακαριαίο και δωρεάν.
    const jobsBefore = app.orchestrator.status().jobs.length;
    const third = await app.orchestrator.list({ type: 'series', id });
    assert.equal(third[0].id, readyId);
    assert.equal(app.orchestrator.status().jobs.length, jobsBefore, 'καμία νέα μετάφραση στο δεύτερο άνοιγμα');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
