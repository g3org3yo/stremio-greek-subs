import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, parseTranslationReply } from '../src/translate/prompt.js';

const glossary = { version: 1, keep: ['Millennium Falcon'], map: { 'the Force': 'η Δύναμη' }, hash: 'abc' };

test('buildPrompt: αναφέρει τη γλώσσα-στόχο, το glossary και τους κανόνες', () => {
  const { system, user } = buildPrompt({
    items: [{ id: 1, text: '<i>Hello</i> there.' }],
    targetLangName: 'Ελληνικά',
    context: { title: 'Star Wars', year: 1977 },
    glossary,
  });
  assert.match(system, /Ελληνικά/);
  assert.match(system, /Millennium Falcon/);
  assert.match(system, /η Δύναμη/);
  assert.match(system, /μην συνενώνεις/i);
  assert.match(user, /Star Wars/);
  assert.match(user, /<i>Hello<\/i> there\./);
});

test('buildPrompt: το ζεύγος id/κείμενο ταξιδεύει ως JSON ώστε να μη χαθεί η αντιστοιχία', () => {
  const { user } = buildPrompt({
    items: [{ id: 7, text: 'Ένα' }, { id: 8, text: 'Δύο' }],
    targetLangName: 'Ελληνικά',
    context: {},
    glossary: { keep: [], map: {} },
  });
  assert.match(user, /\[{"id":7,"text":"Ένα"},{"id":8,"text":"Δύο"}\]/);
  assert.match(user, /2 cues/);
});

test('buildPrompt: χωρίς glossary δεν εμφανίζει κενές οδηγίες', () => {
  const { system } = buildPrompt({ items: [{ id: 1, text: 'x' }], targetLangName: 'Ελληνικά', context: {}, glossary: { keep: [], map: {} } });
  assert.ok(!/Κράτα αμετάφραστα:\s*\./.test(system));
  assert.ok(!/Υποχρεωτικές αποδόσεις/.test(system));
});

test('parseTranslationReply: διαβάζει καθαρό JSON', () => {
  const map = parseTranslationReply('[{"id":1,"text":"Γεια"}]', [1]);
  assert.equal(map.get(1), 'Γεια');
});

test('parseTranslationReply: αντέχει markdown fences και σχολιασμό γύρω από το JSON', () => {
  const raw = 'Ορίστε:\n```json\n[{"id":1,"text":"Γεια"},{"id":2,"text":"Κόσμε"}]\n```\nΤέλος.';
  const map = parseTranslationReply(raw, [1, 2]);
  assert.equal(map.size, 2);
  assert.equal(map.get(2), 'Κόσμε');
});

test('parseTranslationReply: αγνοεί ids που δεν ζητήθηκαν και επιστρέφει μόνο έγκυρα', () => {
  const map = parseTranslationReply('[{"id":1,"text":"Γεια"},{"id":99,"text":"Άκυρο"}]', [1, 2]);
  assert.equal(map.size, 1);
  assert.equal(map.has(99), false);
});

test('parseTranslationReply: δέχεται id ως string και αγνοεί κενά κείμενα', () => {
  const map = parseTranslationReply('[{"id":"1","text":"Γεια"},{"id":2,"text":"   "}]', [1, 2]);
  assert.equal(map.size, 1);
  assert.equal(map.get(1), 'Γεια');
});

test('parseTranslationReply: αντέχει πολυγραμμικό κείμενο με escapes μέσα στο JSON', () => {
  const raw = '[{"id":1,"text":"- Πρώτη γραμμή\\n- Δεύτερη"}]';
  assert.equal(parseTranslationReply(raw, [1]).get(1), '- Πρώτη γραμμή\n- Δεύτερη');
});

test('parseTranslationReply: σκουπίδια -> κενός map, χωρίς εξαίρεση', () => {
  assert.equal(parseTranslationReply('συγγνώμη, δεν μπορώ', [1]).size, 0);
});

test('parseTranslationReply: σπασμένο JSON -> κενός map, χωρίς εξαίρεση', () => {
  assert.equal(parseTranslationReply('[{"id":1,"text":"Γεια"', [1]).size, 0);
});
