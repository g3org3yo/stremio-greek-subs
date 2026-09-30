import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../src/log.js';

function collector() {
  const lines = [];
  return { lines, log: (line) => lines.push(line) };
}

test('γράφει στην κονσόλα με χρονική σήμανση', () => {
  const out = collector();
  const log = createLogger({ console: out, time: () => '2026-09-30T12:00:00.000Z' });
  log('κάτι συνέβη');
  assert.deepEqual(out.lines, ['2026-09-30T12:00:00.000Z κάτι συνέβη']);
});

test('γράφει και στο αρχείο, προσθέτοντας γραμμές', () => {
  const dir = mkdtempSync(join(tmpdir(), 'log-'));
  const file = join(dir, 'nested', 'addon.log');
  const out = collector();
  const log = createLogger({ file, console: out, time: () => 'T' });
  log('πρώτο');
  log('δεύτερο');
  const content = readFileSync(file, 'utf8');
  assert.equal(content, 'T πρώτο\nT δεύτερο\n');
  assert.equal(out.lines.length, 2);
  rmSync(dir, { recursive: true, force: true });
});

test('αν το αρχείο δεν είναι εγγράψιμο, δεν σκάει η διεργασία', () => {
  const out = collector();
  const log = createLogger({ file: 'Z:/ανύπαρκτο/πάνω/στο/τίποτα/addon.log', console: out });
  assert.doesNotThrow(() => log('συνεχίζουμε'));
  assert.equal(out.lines.length, 1, 'η κονσόλα κρατά την πληροφορία');
});

test('χωρίς αρχείο, δουλεύει μόνο με κονσόλα', () => {
  const out = collector();
  const log = createLogger({ console: out });
  log('μόνο κονσόλα');
  assert.equal(out.lines.length, 1);
});
