import { test } from 'node:test';
import assert from 'node:assert/strict';

// Ο έλεγχος του runner: το project απαιτεί Node >= 22 (node:test, global fetch,
// TextDecoder με windows-1253).
test('το runtime είναι Node 22 ή νεότερο', () => {
  const major = Number(process.versions.node.split('.')[0]);
  assert.ok(major >= 22, `βρέθηκε Node ${process.versions.node}`);
});
