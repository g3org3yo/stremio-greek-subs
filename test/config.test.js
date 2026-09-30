import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('loadConfig: δέχεται ρητό ADDON_BASE_URL (για μελλοντικό HTTPS μέσω tunnel)', () => {
  const cfg = loadConfig({ env: { ADDON_BASE_URL: 'https://subs.example.com' } });
  assert.equal(cfg.baseUrl, 'https://subs.example.com');
  assert.equal(cfg.baseUrlExplicit, true, 'ρητή διεύθυνση -> ο server δεν την αντικαθιστά με το Host');
});

test('loadConfig: χωρίς ADDON_BASE_URL, η διεύθυνση προκύπτει από τη θύρα', () => {
  const cfg = loadConfig({ env: { ADDON_PORT: '7100' } });
  assert.equal(cfg.baseUrl, 'http://127.0.0.1:7100');
  assert.equal(cfg.baseUrlExplicit, false);
});
