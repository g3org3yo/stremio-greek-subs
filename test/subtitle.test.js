import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSubtitle } from '../src/subtitle/encoding.js';
import { parseSrt } from '../src/subtitle/parse.js';
import { serializeSrt } from '../src/subtitle/serialize.js';

const SRT_UTF8 = `1
00:00:01,000 --> 00:00:03,500
Hello there.

2
00:00:04,000 --> 00:00:06,000
<i>Come</i> here.
General Kenobi!

3
00:01:02,250 --> 00:01:05,000
- Stop.
- Never.
`;

test('parseSrt: διαβάζει ids, χρόνους και πολυγραμμικό κείμενο', () => {
  const cues = parseSrt(SRT_UTF8);
  assert.equal(cues.length, 3);
  assert.deepEqual(cues[0], { id: 1, start: '00:00:01,000', end: '00:00:03,500', text: 'Hello there.' });
  assert.equal(cues[1].text, '<i>Come</i> here.\nGeneral Kenobi!');
  assert.equal(cues[2].text, '- Stop.\n- Never.');
});

test('parseSrt: δεν πειράζει τα timestamps — είναι strings, όχι αριθμοί', () => {
  const cues = parseSrt(SRT_UTF8);
  assert.equal(typeof cues[0].start, 'string');
  assert.equal(cues[2].start, '00:01:02,250');
});

test('parseSrt: αντέχει CRLF, BOM, κενές γραμμές και cues χωρίς κείμενο', () => {
  const messy = '\uFEFF1\r\n00:00:01,000 --> 00:00:02,000\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nΚείμενο\r\n';
  const cues = parseSrt(messy);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, '');
  assert.equal(cues[1].text, 'Κείμενο');
});

test('parseSrt: αγνοεί index που λείπει ή είναι λάθος', () => {
  const noIndex = '00:00:01,000 --> 00:00:02,000\nΧωρίς δείκτη\n';
  const cues = parseSrt(noIndex);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, 'Χωρίς δείκτη');
});

test('parseSrt: δέχεται τελεία αντί κόμματος στα χιλιοστά (μορφή .vtt)', () => {
  const cues = parseSrt('1\n00:00:01.500 --> 00:00:02.750\nΓεια\n');
  assert.equal(cues[0].start, '00:00:01,500');
  assert.equal(cues[0].end, '00:00:02,750');
});

test('serializeSrt: round-trip χωρίς απώλεια', () => {
  const cues = parseSrt(SRT_UTF8);
  const out = serializeSrt(cues);
  const back = parseSrt(out);
  assert.deepEqual(back, cues);
});

test('serializeSrt: βάζει BOM και LF, ώστε ο player να μη μαντεύει κωδικοποίηση', () => {
  const out = serializeSrt([{ id: 1, start: '00:00:01,000', end: '00:00:02,000', text: 'Γεια' }]);
  assert.equal(out.charCodeAt(0), 0xFEFF);
  assert.ok(!out.includes('\r'));
  assert.ok(out.endsWith('\n'));
});

test('decodeSubtitle: αναγνωρίζει UTF-8 με BOM', () => {
  const buf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('Γεια σου', 'utf8')]);
  const r = decodeSubtitle(buf);
  assert.equal(r.encoding, 'utf-8');
  assert.equal(r.bom, true);
  assert.equal(r.text, 'Γεια σου');
});

test('decodeSubtitle: αναγνωρίζει σκέτο UTF-8 χωρίς BOM', () => {
  const r = decodeSubtitle(Buffer.from('Καλησπέρα', 'utf8'));
  assert.equal(r.encoding, 'utf-8');
  assert.equal(r.bom, false);
  assert.equal(r.text, 'Καλησπέρα');
});

test('decodeSubtitle: αναγνωρίζει Windows-1253 (παλιοί ελληνικοί υπότιτλοι)', () => {
  // "Καλημέρα" σε windows-1253
  const win1253 = Buffer.from([0xCA, 0xE1, 0xEB, 0xE7, 0xEC, 0xDD, 0xF1, 0xE1]);
  const r = decodeSubtitle(win1253);
  assert.equal(r.encoding, 'windows-1253');
  assert.equal(r.text, 'Καλημέρα');
});

test('decodeSubtitle: αναγνωρίζει Windows-1252 (αγγλικά με έξυπνα εισαγωγικά)', () => {
  // "He’s here" σε windows-1252 — 0x92 δεν είναι έγκυρο UTF-8
  const win1252 = Buffer.from([0x48, 0x65, 0x92, 0x73, 0x20, 0x68, 0x65, 0x72, 0x65]);
  const r = decodeSubtitle(win1252);
  assert.equal(r.encoding, 'windows-1252');
  assert.equal(r.text, 'He\u2019s here');
});

test('decodeSubtitle: αναφέρει το τέλος γραμμής του αρχείου', () => {
  assert.equal(decodeSubtitle(Buffer.from('a\r\nb', 'utf8')).lineEnding, '\r\n');
  assert.equal(decodeSubtitle(Buffer.from('a\nb', 'utf8')).lineEnding, '\n');
});
