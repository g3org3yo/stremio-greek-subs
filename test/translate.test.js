import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiEngine } from '../src/translate/gemini.js';
import { createLmStudioEngine } from '../src/translate/lmstudio.js';
import { createChain } from '../src/translate/chain.js';

const glossary = { version: 1, keep: [], map: {}, hash: 'g1' };
const items = [{ id: 1, text: 'Hello' }, { id: 2, text: 'World' }];

function jsonResponse(payload, ok = true, status = 200) {
  return { ok, status, json: async () => payload, text: async () => JSON.stringify(payload) };
}

test('gemini: στέλνει το prompt και επιστρέφει το κείμενο του μοντέλου', async () => {
  let captured;
  const fetchImpl = async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body), headers: opts.headers };
    return jsonResponse({ candidates: [{ content: { parts: [{ text: '[{"id":1,"text":"Γεια"}]' }] } }] });
  };
  const engine = createGeminiEngine({ apiKey: 'k', model: 'gemini-2.5-flash', fetchImpl });
  const raw = await engine.translateBatch({ items, targetLangName: 'Ελληνικά', context: {}, glossary });
  assert.match(captured.url, /gemini-2\.5-flash:generateContent/);
  assert.equal(captured.headers['x-goog-api-key'], 'k');
  assert.match(captured.body.contents[0].parts[0].text, /Hello/);
  assert.match(captured.body.systemInstruction.parts[0].text, /υπότιτλους/);
  assert.equal(captured.body.generationConfig.responseMimeType, 'application/json');
  assert.equal(raw, '[{"id":1,"text":"Γεια"}]');
});

test('gemini: χωρίς κλειδί δεν είναι διαθέσιμος', async () => {
  const engine = createGeminiEngine({ apiKey: '', model: 'm', fetchImpl: async () => jsonResponse({}) });
  assert.equal(await engine.isAvailable(), false);
});

test('gemini: 429 -> σφάλμα με quotaExhausted', async () => {
  const engine = createGeminiEngine({
    apiKey: 'k',
    model: 'm',
    fetchImpl: async () => jsonResponse({ error: { message: 'quota' } }, false, 429),
  });
  await assert.rejects(
    () => engine.translateBatch({ items, targetLangName: 'Ελληνικά', context: {}, glossary }),
    (err) => err.quotaExhausted === true,
  );
});

test('gemini: 403 θεωρείται εξάντληση άδειας, όχι παροδικό σφάλμα', async () => {
  const engine = createGeminiEngine({
    apiKey: 'k',
    model: 'm',
    fetchImpl: async () => jsonResponse({ error: { message: 'forbidden' } }, false, 403),
  });
  await assert.rejects(
    () => engine.translateBatch({ items, targetLangName: 'Ελληνικά', context: {}, glossary }),
    (err) => err.quotaExhausted === true,
  );
});

test('gemini: 500 -> σφάλμα ΧΩΡΙΣ quotaExhausted, ώστε να ξαναδοκιμαστεί', async () => {
  const engine = createGeminiEngine({
    apiKey: 'k',
    model: 'm',
    fetchImpl: async () => jsonResponse({ error: 'boom' }, false, 500),
  });
  await assert.rejects(
    () => engine.translateBatch({ items, targetLangName: 'Ελληνικά', context: {}, glossary }),
    (err) => err.quotaExhausted !== true && /500/.test(err.message),
  );
});

test('gemini: απάντηση χωρίς candidates -> κενό κείμενο, όχι εξαίρεση', async () => {
  const engine = createGeminiEngine({ apiKey: 'k', model: 'm', fetchImpl: async () => jsonResponse({}) });
  const raw = await engine.translateBatch({ items, targetLangName: 'Ελληνικά', context: {}, glossary });
  assert.equal(raw, '');
});

test('lmstudio: μιλάει OpenAI-compatible API στη τοπική διεύθυνση', async () => {
  let captured;
  const engine = createLmStudioEngine({
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'qwen',
    fetchImpl: async (url, opts) => {
      captured = { url, body: JSON.parse(opts.body) };
      return jsonResponse({ choices: [{ message: { content: '[{"id":1,"text":"Γεια"}]' } }] });
    },
  });
  const raw = await engine.translateBatch({ items, targetLangName: 'Ελληνικά', context: {}, glossary });
  assert.equal(captured.url, 'http://127.0.0.1:1234/v1/chat/completions');
  assert.equal(captured.body.model, 'qwen');
  assert.equal(captured.body.stream, false);
  assert.equal(captured.body.messages[0].role, 'system');
  assert.equal(raw, '[{"id":1,"text":"Γεια"}]');
});

test('lmstudio: isAvailable ρωτά το /models και επιστρέφει false σε αποτυχία σύνδεσης', async () => {
  const up = createLmStudioEngine({ baseUrl: 'http://x/v1', model: 'm', fetchImpl: async () => ({ ok: true }) });
  const down = createLmStudioEngine({ baseUrl: 'http://x/v1', model: 'm', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(await up.isAvailable(), true);
  assert.equal(await down.isAvailable(), false);
});

test('lmstudio: σύνδεση αρνήθηκε -> καθαρό ελληνικά μήνυμα με οδηγία', async () => {
  const engine = createLmStudioEngine({
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'qwen',
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  await assert.rejects(
    () => engine.translateBatch({ items, targetLangName: 'Ελληνικά', context: {}, glossary }),
    /lms server start/,
  );
});

test('chain: χρησιμοποιεί τον πρώτο engine και επιστρέφει map', async () => {
  const calls = [];
  const engineA = { name: 'a', isAvailable: async () => true, translateBatch: async () => { calls.push('a'); return '[{"id":1,"text":"Γεια"},{"id":2,"text":"Κόσμε"}]'; } };
  const engineB = { name: 'b', isAvailable: async () => true, translateBatch: async () => { calls.push('b'); return '[]'; } };
  const chain = createChain({ engines: [engineA, engineB], targetLangName: 'Ελληνικά', glossary, log: () => {} });
  const map = await chain.translateBatch(items, {});
  assert.deepEqual(calls, ['a']);
  assert.equal(map.get(2), 'Κόσμε');
});

test('chain: 429 στον πρώτο -> συνεχίζει με τον δεύτερο και τον σημαδεύει εξαντλημένο', async () => {
  const calls = [];
  const engineA = {
    name: 'gemini',
    isAvailable: async () => true,
    translateBatch: async () => { calls.push('a'); throw Object.assign(new Error('quota'), { quotaExhausted: true }); },
  };
  const engineB = { name: 'lmstudio', isAvailable: async () => true, translateBatch: async () => { calls.push('b'); return '[{"id":1,"text":"Γεια"}]'; } };
  const chain = createChain({ engines: [engineA, engineB], targetLangName: 'Ελληνικά', glossary, log: () => {} });
  const map = await chain.translateBatch(items, {});
  assert.deepEqual(calls, ['a', 'b']);
  assert.equal(chain.status().exhausted.includes('gemini'), true);
  assert.equal(map.get(1), 'Γεια');

  // δεύτερο batch: ο gemini δεν ξαναδοκιμάζεται
  calls.length = 0;
  await chain.translateBatch(items, {});
  assert.deepEqual(calls, ['b']);
});

test('chain: τοπικό μοντέλο που δεν τρέχει -> σφάλμα χωρίς quotaExhausted, δεν το σημαδεύει εξαντλημένο', async () => {
  const engineB = { name: 'lmstudio', isAvailable: async () => false, translateBatch: async () => { throw new Error('δεν έπρεπε να κληθεί'); } };
  const chain = createChain({ engines: [engineB], targetLangName: 'Ελληνικά', glossary, log: () => {} });
  await assert.rejects(() => chain.translateBatch(items, {}), /δεν είναι διαθέσιμος/);
  assert.deepEqual(chain.status().exhausted, []);
});

test('chain: παροδικό σφάλμα -> δοκιμάζει τον επόμενο αλλά ΔΕΝ τον σημαδεύει εξαντλημένο', async () => {
  const calls = [];
  const engineA = {
    name: 'gemini',
    isAvailable: async () => true,
    translateBatch: async () => { calls.push('a'); throw new Error('500 σφάλμα δικτύου'); },
  };
  const engineB = { name: 'lmstudio', isAvailable: async () => true, translateBatch: async () => { calls.push('b'); return '[{"id":1,"text":"Γεια"}]'; } };
  const chain = createChain({ engines: [engineA, engineB], targetLangName: 'Ελληνικά', glossary, log: () => {} });
  await chain.translateBatch(items, {});
  assert.deepEqual(chain.status().exhausted, []);

  calls.length = 0;
  await chain.translateBatch(items, {});
  assert.deepEqual(calls, ['a', 'b'], 'ο gemini ξαναδοκιμάζεται στο επόμενο batch');
});

test('chain: κενή απάντηση -> σφάλμα, όχι σιωπηλά κενή μετάφραση', async () => {
  const engine = { name: 'a', isAvailable: async () => true, translateBatch: async () => 'δεν μπορώ' };
  const chain = createChain({ engines: [engine], targetLangName: 'Ελληνικά', glossary, log: () => {} });
  await assert.rejects(() => chain.translateBatch(items, {}), /μη έγκυρη απάντηση/);
});

test('chain: όλοι οι engines εξαντλημένοι -> ένα σφάλμα με όλες τις αιτίες', async () => {
  const dead = (name, message) => ({ name, isAvailable: async () => true, translateBatch: async () => { throw new Error(message); } });
  const chain = createChain({ engines: [dead('gemini', 'όριο'), dead('lmstudio', 'έκλεισε')], targetLangName: 'Ελληνικά', glossary, log: () => {} });
  await assert.rejects(() => chain.translateBatch(items, {}), (err) => /όριο/.test(err.message) && /έκλεισε/.test(err.message));
});

test('chain: μερική μετάφραση -> επιστρέφει ό,τι πήρε, ώστε να καλυφθεί το υπόλοιπο με το πρωτότυπο', async () => {
  const logs = [];
  const engine = { name: 'a', isAvailable: async () => true, translateBatch: async () => '[{"id":1,"text":"Γεια"}]' };
  const chain = createChain({ engines: [engine], targetLangName: 'Ελληνικά', glossary, log: (m) => logs.push(m) });
  const map = await chain.translateBatch(items, {});
  assert.equal(map.size, 1);
  assert.ok(logs.some((l) => /1\/2/.test(l)), 'καταγράφει την απώλεια');
});
