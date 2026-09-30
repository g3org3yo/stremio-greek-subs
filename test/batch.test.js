import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBatches, applyTranslations } from '../src/subtitle/batch.js';

const cues = Array.from({ length: 150 }, (_, i) => ({
  id: i + 1,
  start: `00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')},000`,
  end: `00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String((i % 60) + 1).padStart(2, '0')},000`,
  text: `line ${i + 1}`,
}));

test('makeBatches: σωστός αριθμός batches και διατήρηση σειράς', () => {
  const batches = makeBatches(cues, 70);
  assert.equal(batches.length, 3);
  assert.equal(batches[0].items.length, 70);
  assert.equal(batches[1].items.length, 70);
  assert.equal(batches[2].items.length, 10);
  const ids = batches.flatMap((b) => b.items.map((it) => it.id));
  assert.deepEqual(ids, cues.map((c) => c.id));
});

test('makeBatches: τα κενά cues δεν στέλνονται στο μοντέλο', () => {
  const withEmpty = [...cues.slice(0, 2), { id: 3, start: 'x', end: 'y', text: '   ' }];
  const batches = makeBatches(withEmpty, 70);
  assert.deepEqual(batches[0].items.map((i) => i.id), [1, 2]);
});

test('makeBatches: η σειρά του batch είναι αρίθμηση από το μηδέν', () => {
  const batches = makeBatches(cues, 100);
  assert.deepEqual(batches.map((b) => b.index), [0, 1]);
});

test('makeBatches: χωρίς μεταφράσιμα cues -> κανένα batch', () => {
  assert.deepEqual(makeBatches([{ id: 1, start: 'x', end: 'y', text: '' }], 70), []);
});

test('applyTranslations: γεμίζει ό,τι μεταφράστηκε και κρατά το πρωτότυπο στα υπόλοιπα', () => {
  const translated = new Map([[1, 'γραμμή 1']]);
  const out = applyTranslations(cues.slice(0, 3), translated);
  assert.equal(out[0].text, 'γραμμή 1');
  assert.equal(out[1].text, 'line 2');
  assert.equal(out[1].start, cues[1].start, 'τα timestamps δεν αλλάζουν');
});

test('applyTranslations: κενή μετάφραση δεν σβήνει το πρωτότυπο', () => {
  const out = applyTranslations(cues.slice(0, 1), new Map([[1, '   ']]));
  assert.equal(out[0].text, 'line 1');
});

test('applyTranslations: δεν αλλάζει πλήθος ούτε ταυτότητα cues', () => {
  const out = applyTranslations(cues, new Map([[5, 'πέντε']]));
  assert.equal(out.length, cues.length);
  assert.deepEqual(out.map((c) => c.id), cues.map((c) => c.id));
});
