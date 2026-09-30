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

test('gemini: χωρίς μοντέλο διαλέγει flash από τη λίστα /models', async () => {
  let asked = [];
  const engine = createGeminiEngine({
    apiKey: 'κ',
    fetchImpl: async (url, init) => {
      asked.push(url);
      if (/\/models$/.test(url)) {
        return jsonResponse({
          models: [
            { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
            { name: 'models/gemini-3.8-pro', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
          ],
        });
      }
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '[{"id":1,"text":"Γεια"}]' }] } }] });
    },
  });
  assert.equal(await engine.isAvailable(), true);
  assert.match(asked[0], /\/models$/);
  const raw = await engine.translateBatch({ items: [{ id: 1, text: 'Hi' }], targetLangName: 'Ελληνικά' });
  assert.match(raw, /Γεια/);
  assert.match(asked[1], /gemini-3\.8-flash:generateContent/);
  assert.equal(asked.filter((u) => /\/models$/.test(u)).length, 1, 'η λίστα ζητείται μία φορά');
});

test('gemini: απόσυρση μοντέλου (404) -> ξαναδιαλέγει και ξαναδοκιμάζει, δεν σταματά', async () => {
  const asked = [];
  const engine = createGeminiEngine({
    apiKey: 'κ',
    model: 'gemini-παλιό-flash',
    fetchImpl: async (url, init) => {
      asked.push(url);
      if (/\/models$/.test(url)) {
        return jsonResponse({
          models: [{ name: 'models/gemini-νεο-flash', supportedGenerationMethods: ['generateContent'] }],
        });
      }
      if (/gemini-παλιό-flash/.test(url)) {
        return {
          ok: false,
          status: 404,
          text: async () => '{"error":{"message":"This model is no longer available to new users"}}',
        };
      }
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '[{"id":1,"text":"Γεια"}]' }] } }] });
    },
  });
  const raw = await engine.translateBatch({ items: [{ id: 1, text: 'Hi' }], targetLangName: 'Ελληνικά' });
  assert.match(raw, /Γεια/, 'η μετάφραση προχωρά με το νέο μοντέλο');
  assert.ok(asked.some((u) => /gemini-νεο-flash:generateContent/.test(u)));
});

test('gemini: αν δεν μπορεί να διαβάσει τη λίστα, ο έλεγχος λέει «όχι» αντί να πετάξει', async () => {
  const engine = createGeminiEngine({
    apiKey: 'κ',
    fetchImpl: async () => ({ ok: false, status: 403, text: async () => 'denied' }),
  });
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

test('chain: άδειο/άχρηστο batch -> το σπάει στα δύο και ολοκληρώνει, αντί να χαθεί το επεισόδιο', async () => {
  // Ζωντανό σφάλμα: batch 70 cues δεν έδωσε τίποτα ερμηνεύσιμο και ΟΛΟ το επεισόδιο
  // έμεινε χωρίς μετάφραση. Τα μισά περνούν (λιγότερη έξοδος για το μοντέλο).
  const many = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, text: `line ${i + 1}` }));
  const calls = [];
  const engine = {
    name: 'gemini',
    isAvailable: async () => true,
    translateBatch: async ({ items: list }) => {
      calls.push(list.length);
      if (list.length > 10) return '[]'; // δεν τα καταφέρνει με μεγάλο batch
      return JSON.stringify(list.map((it) => ({ id: it.id, text: `γρ${it.id}` })));
    },
  };
  const chain = createChain({ engines: [engine], targetLangName: 'Ελληνικά', glossary, log: () => {} });
  const map = await chain.translateBatch(many, {});
  assert.equal(map.size, 20, 'και τα 20 cues μεταφράστηκαν');
  assert.equal(map.get(20), 'γρ20');
  assert.deepEqual(calls, [20, 10, 10], 'μία προσπάθεια, μετά δύο μισά');
});

test('chain: κομμένη ουρά -> ζητάει τα υπόλοιπα άλλη μία φορά, χωρίς ατέρμονο βρόχο', async () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, text: `line ${i + 1}` }));
  const calls = [];
  const engine = {
    name: 'gemini',
    isAvailable: async () => true,
    // Γυρίζει ΠΑΝΤΑ μόνο το 40% των ζητούμενων, κομμένο στη μέση (χωρίς τελικό «]»).
    translateBatch: async ({ items: list }) => {
      calls.push(list.length);
      const cut = Math.max(1, Math.floor(list.length * 0.4));
      return `[${list.slice(0, cut).map((it) => `{"id":${it.id},"text":"γρ${it.id}"}`).join(',')}`;
    },
  };
  const chain = createChain({ engines: [engine], targetLangName: 'Ελληνικά', glossary, log: () => {} });
  const map = await chain.translateBatch(many, {});
  assert.equal(map.size, 12, '8 σώθηκαν από την κομμένη απάντηση, 4 ήρθαν στο δεύτερο πέρασμα');
  assert.deepEqual(calls, [20, 12], 'δύο αιτήματα: το αρχικό και τα υπόλοιπα — και σταματάει');
});
