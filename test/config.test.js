import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig, parseEnvFile } from '../src/config.js';


test('parseEnvFile: σχόλια, κενές γραμμές, εισαγωγικά και export', () => {
  const env = parseEnvFile(
    ['# σχόλιο', '', 'A=1', 'export B=δύο', 'C="με κενό"', "D='μονά'", 'E=a=b', '  F  =  σπασίματα  '].join('\n'),
  );
  assert.deepEqual(env, { A: '1', B: 'δύο', C: 'με κενό', D: 'μονά', E: 'a=b', F: 'σπασίματα' });
});

test('parseEnvFile: γραμμές χωρίς = και σκέτα κλειδιά αγνοούνται', () => {
  assert.deepEqual(parseEnvFile('σκουπίδι\n=χωρίς κλειδί\nOK=1'), { OK: '1' });
});

test('parseEnvFile: αντέχει null/undefined', () => {
  assert.deepEqual(parseEnvFile(null), {});
});

test('loadConfig: το περιβάλλον υπερισχύει του αρχείου', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  writeFileSync(join(dir, '.env'), 'SUBDL_API_KEY=από-αρχείο\nADDON_PORT=9000\n', 'utf8');
  const cfg = loadConfig({ root: dir, env: { SUBDL_API_KEY: 'από-περιβάλλον' } });
  assert.equal(cfg.subdlApiKey, 'από-περιβάλλον');
  assert.equal(cfg.port, 9000, 'ό,τι δεν δίνεται στο περιβάλλον έρχεται από το αρχείο');
  assert.equal(cfg.baseUrl, 'http://127.0.0.1:9000');
  rmSync(dir, { recursive: true, force: true });
});

test('loadConfig: χωρίς αρχείο .env δουλεύει με τις προεπιλογές', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg2-'));
  const cfg = loadConfig({ root: dir, env: {} });
  assert.equal(cfg.port, 7000);
  assert.equal(cfg.baseUrl, 'http://127.0.0.1:7000');
  assert.equal(cfg.targetLang, 'el');
  assert.equal(cfg.targetLangName, 'Ελληνικά');
  assert.deepEqual(cfg.sourceLangs, ['en']);
  assert.deepEqual(cfg.providerOrder, ['subdl']);
  assert.equal(cfg.batchSize, 70);
  assert.equal(cfg.minMatchScore, 0.8);
  assert.equal(cfg.cacheDir, join(dir, '.cache'));
  rmSync(dir, { recursive: true, force: true });
});

test('loadConfig: λίστες χωρισμένες με κόμμα και άκυρος αριθμός', () => {
  const cfg = loadConfig({
    env: { SOURCE_LANGS: 'en, fr ,de', PROVIDER_ORDER: 'subdl, opensubtitles', ADDON_PORT: 'θόρυβος', TRANSLATE_BATCH_SIZE: '' },
  });
  assert.deepEqual(cfg.sourceLangs, ['en', 'fr', 'de']);
  assert.deepEqual(cfg.providerOrder, ['subdl', 'opensubtitles']);
  assert.equal(cfg.port, 7000, 'άκυρη θύρα -> προεπιλογή, όχι NaN');
  assert.equal(cfg.batchSize, 70, 'κενή τιμή -> προεπιλογή');
});

test('loadConfig: δέχεται και τα ονόματα του .env.example (PORT, BATCH_SIZE, GOOGLE_API_KEY)', () => {
  const cfg = loadConfig({
    root: 'C:/project',
    env: {
      PORT: '7010',
      BIND_HOST: '0.0.0.0',
      GOOGLE_API_KEY: 'κλειδί-google',
      BATCH_SIZE: '40',
      MIN_MATCH_SCORE: '0.9',
      CACHE_DIR: './cache',
      GLOSSARY_FILE: './glossary.json',
    },
    envFile: 'C:/project/δεν-υπάρχει',
  });
  assert.equal(cfg.port, 7010);
  assert.equal(cfg.host, '0.0.0.0');
  assert.equal(cfg.baseUrl, 'http://127.0.0.1:7010', 'ακόμη κι όταν ακούει σε όλες τις διεπαφές, ο browser βλέπει τη loopback');
  assert.equal(cfg.geminiApiKey, 'κλειδί-google');
  assert.equal(cfg.batchSize, 40);
  assert.equal(cfg.minMatchScore, 0.9);
  assert.equal(cfg.cacheDir, resolve('C:/project', 'cache'), 'τα σχετικά μονοπάτια λύνονται ως προς το root');
  assert.equal(cfg.glossaryPath, resolve('C:/project', 'glossary.json'));
  assert.equal(cfg.logFile, resolve('C:/project', 'cache', 'addon.log'));
});

test('loadConfig: το GEMINI_API_KEY υπερισχύει του GOOGLE_API_KEY', () => {
  const cfg = loadConfig({ env: { GEMINI_API_KEY: 'νέο', GOOGLE_API_KEY: 'παλιό' } });
  assert.equal(cfg.geminiApiKey, 'νέο');
});

test('loadConfig: σειρά μηχανών από ENGINE_ORDER, με προεπιλογή gemini,lmstudio', () => {
  assert.deepEqual(loadConfig({ env: {} }).engineOrder, ['gemini', 'lmstudio']);
  assert.deepEqual(loadConfig({ env: { ENGINE_ORDER: 'lmstudio' } }).engineOrder, ['lmstudio']);
  assert.deepEqual(loadConfig({ env: { ENGINE_ORDER: 'lmstudio, gemini' } }).engineOrder, ['lmstudio', 'gemini']);
});

test('loadConfig: το GEMINI_BASE_URL είναι ρύθμιση, όχι σταθερά', () => {
  assert.equal(loadConfig({ env: {} }).geminiBaseUrl, 'https://generativelanguage.googleapis.com/v1beta');
  assert.equal(
    loadConfig({ env: { GEMINI_BASE_URL: 'https://proxy.δικό.μου/v1beta' } }).geminiBaseUrl,
    'https://proxy.δικό.μου/v1beta',
  );
});

test('loadConfig: δέχεται ρητό ADDON_BASE_URL (για μελλοντικό HTTPS μέσω tunnel)', () => {
  const cfg = loadConfig({ env: { ADDON_BASE_URL: 'https://subs.example.com' } });
  assert.equal(cfg.baseUrl, 'https://subs.example.com');
  assert.equal(cfg.baseUrlExplicit, true, 'ρητή διεύθυνση -> ο server δεν την αντικαθιστά με το Host');
});

test('loadConfig: χωρίς ADDON_BASE_URL, η διεύθυνση προκύπτει από τη θύρα', () => {
  // Με ρητό envFile που δεν υπάρχει, ώστε το τεστ να μετρά τις προεπιλογές και όχι
  // το .env του project που μπορεί να έχει δικές του τιμές.
  const cfg = loadConfig({ env: { ADDON_PORT: '7100' }, envFile: join(tmpdir(), 'δεν-υπάρχει.env') });
  assert.equal(cfg.baseUrl, 'http://127.0.0.1:7100');
  assert.equal(cfg.baseUrlExplicit, false);
});
