import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, start } from '../src/index.js';

function app(env = {}) {
  const root = mkdtempSync(join(tmpdir(), 'app-'));
  return { ...createApp({ root, env }), root };
}

test('createApp: χωρίς κλειδιά δεν υπάρχει πηγή, αλλά η εφαρμογή φτιάχνεται', () => {
  const a = app({});
  assert.deepEqual(a.providers, []);
  assert.equal(a.engines.length, 2, 'οι μηχανές υπάρχουν και κρίνονται τη στιγμή της χρήσης');
  assert.equal(a.config.targetLang, 'el');
  assert.equal(a.glossary.hash, 'empty', 'χωρίς glossary.json δουλεύει με κενό όρο');
  a.server.close();
  rmSync(a.root, { recursive: true, force: true });
});

test('createApp: με κλειδί SubDL η πηγή μπαίνει στη λίστα', () => {
  const a = app({ SUBDL_API_KEY: 'δοκιμαστικό' });
  assert.deepEqual(a.providers.map((p) => p.name), ['subdl']);
  a.server.close();
  rmSync(a.root, { recursive: true, force: true });
});

test('start: σηκώνεται, απαντά στο manifest και προειδοποιεί για ό,τι λείπει', async () => {
  const logs = [];
  const root = mkdtempSync(join(tmpdir(), 'app-start-'));
  const realConsole = console.log;
  console.log = (line) => logs.push(line);
  let a;
  try {
    a = await start({ root, env: {}, port: 0 });
  } finally {
    console.log = realConsole;
  }

  assert.match(a.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const manifest = await fetch(`${a.origin}/manifest.json`);
  assert.equal(manifest.status, 200);
  assert.deepEqual((await manifest.json()).resources, ['subtitles']);

  assert.ok(logs.some((l) => /ο server ακούει/.test(l)));
  assert.ok(logs.some((l) => /SUBDL_API_KEY/.test(l)), 'λέει στον χρήστη τι λείπει');
  assert.ok(logs.some((l) => /stremio:\/\//.test(l)), 'δίνει έτοιμο σύνδεσμο εγκατάστασης');

  await a.close();
  rmSync(root, { recursive: true, force: true });
});

test('start: το addon δεν βγαίνει στο δίκτυο από προεπιλογή', async () => {
  const root = mkdtempSync(join(tmpdir(), 'app-bind-'));
  const a = await start({ root, env: {}, port: 0 });
  const address = a.server.address();
  assert.equal(address.address, '127.0.0.1');
  await a.close();
  rmSync(root, { recursive: true, force: true });
});

test('start: γράφει το log σε αρχείο μέσα στον φάκελο cache', async () => {
  const { readFileSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'app-log-'));
  const a = await start({ root, env: {}, port: 0 });
  await a.close();
  const text = readFileSync(join(root, '.cache', 'addon.log'), 'utf8');
  assert.match(text, /ο server ακούει/);
  rmSync(root, { recursive: true, force: true });
});
