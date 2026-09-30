import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheKey, createCache, safeKey } from '../src/cache.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'grcache-'));

test('cacheKey: ίδιο περιεχόμενο -> ίδιο κλειδί, ανεξαρτήτως engine', () => {
  const a = cacheKey({ sourceHash: 'h1', targetLang: 'el', glossaryVersion: 'g1' });
  const b = cacheKey({ sourceHash: 'h1', targetLang: 'el', glossaryVersion: 'g1' });
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{12}$/);
});

test('cacheKey: αλλαγή glossary -> νέο κλειδί', () => {
  const a = cacheKey({ sourceHash: 'h1', targetLang: 'el', glossaryVersion: 'g1' });
  const b = cacheKey({ sourceHash: 'h1', targetLang: 'el', glossaryVersion: 'g2' });
  assert.notEqual(a, b);
});

test('cacheKey: αλλαγή υπότιτλου-πηγής -> νέο κλειδί', () => {
  const a = cacheKey({ sourceHash: 'h1', targetLang: 'el', glossaryVersion: 'g1' });
  const b = cacheKey({ sourceHash: 'h2', targetLang: 'el', glossaryVersion: 'g1' });
  assert.notEqual(a, b);
});

test('safeKey: ασφαλές id περνά αυτούσιο', () => {
  assert.equal(safeKey('el', 'abc-123_XY.z'), 'el-abc-123_XY.z');
});

test('safeKey: επικίνδυνο id κατακερματίζεται αντί να γίνει διαδρομή', () => {
  for (const raw of ['../../evil', 'a/b', 'id with space', 'x'.repeat(200), '']) {
    const key = safeKey('el', raw);
    assert.match(key, /^el-[a-f0-9]{12}$/, `απέτυχε για: ${JSON.stringify(raw)}`);
  }
});

test('safeKey: το ίδιο id δίνει πάντα το ίδιο κλειδί', () => {
  assert.equal(safeKey('el', 'a/b'), safeKey('el', 'a/b'));
});

test('safeKey: διαφορετικά επικίνδυνα ids δεν συμπίπτουν', () => {
  assert.notEqual(safeKey('el', 'a/b'), safeKey('el', 'a/b '));
});

test('createCache: put -> has -> getSrt με UTF-8 BOM', () => {
  const dir = tmp();
  const cache = createCache(dir);
  const key = cacheKey({ sourceHash: 'h1', targetLang: 'el', glossaryVersion: 'g1' });
  assert.equal(cache.has(key), false);
  cache.put(key, '\uFEFF1\n00:00:01,000 --> 00:00:02,000\nΓεια\n', { title: 'X', engine: 'gemini' });
  assert.equal(cache.has(key), true);
  assert.match(cache.getSrt(key), /Γεια/);
  assert.equal(cache.meta(key).engine, 'gemini');
  rmSync(dir, { recursive: true, force: true });
});

test('createCache: list και remove', () => {
  const dir = tmp();
  const cache = createCache(dir);
  cache.put('aaaaaaaaaaaa', 'x', { title: 'A' });
  cache.put('bbbbbbbbbbbb', 'y', { title: 'B' });
  assert.equal(cache.list().length, 2);
  cache.remove('aaaaaaaaaaaa');
  assert.equal(cache.list().length, 1);
  assert.equal(cache.stats().count, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('createCache: το list μεταφέρει τα μεταδεδομένα και ταξινομεί νεότερα πρώτα', () => {
  const dir = tmp();
  const cache = createCache(dir);
  cache.put('aaaaaaaaaaaa', 'x', { kind: 'ai-translation', releaseName: 'R1' });
  cache.put('bbbbbbbbbbbb', 'y', { kind: 'placeholder' });
  const list = cache.list();
  assert.equal(list.length, 2);
  const entry = list.find((e) => e.key === 'aaaaaaaaaaaa');
  assert.equal(entry.kind, 'ai-translation');
  assert.equal(entry.releaseName, 'R1');
  assert.ok(entry.bytes > 0);
  assert.ok(entry.modified);
  rmSync(dir, { recursive: true, force: true });
});

test('createCache: λείπει το αρχείο -> getSrt επιστρέφει null, όχι εξαίρεση', () => {
  const dir = tmp();
  const cache = createCache(dir);
  assert.equal(cache.getSrt('deadbeef0000'), null);
  assert.equal(cache.meta('deadbeef0000'), null);
  rmSync(dir, { recursive: true, force: true });
});

test('createCache: το list αντέχει εγγραφή χωρίς .json μεταδεδομένα', () => {
  const dir = tmp();
  const cache = createCache(dir);
  cache.put('aaaaaaaaaaaa', 'x', {});
  rmSync(join(dir, 'aaaaaaaaaaaa.json'), { force: true });
  assert.equal(cache.list().length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('createCache: δημιουργεί τον φάκελο αν λείπει', () => {
  const dir = join(tmp(), 'nested', 'cache');
  const cache = createCache(dir);
  cache.put('aaaaaaaaaaaa', 'x', {});
  assert.deepEqual(readdirSync(dir).sort(), ['aaaaaaaaaaaa.json', 'aaaaaaaaaaaa.srt'].sort());
  rmSync(join(dir, '..', '..'), { recursive: true, force: true });
});
