// Διάγνωση: τι μοντέλα δίνει το κλειδί και πόσο κάνει ένα μικρό αίτημα.
import { loadConfig } from '../src/config.js';

const config = loadConfig({ env: process.env });
const base = config.geminiBaseUrl.replace(/\/$/, '');
const key = config.geminiApiKey;
console.log('κλειδί:', key ? `παρόν (${key.length} χαρ.)` : 'ΛΕΙΠΕΙ');

const t0 = Date.now();
const listRes = await fetch(`${base}/models`, { headers: { 'x-goog-api-key': key } });
const list = await listRes.json();
console.log(`λίστα (${Date.now() - t0}ms, HTTP ${listRes.status}):`);
for (const m of list.models ?? []) {
  const ok = (m.supportedGenerationMethods ?? []).includes('generateContent');
  if (ok) console.log(`  ${m.name.replace('models/', '')}`);
}

const chosen = (list.models ?? [])
  .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
  .map((m) => m.name.replace('models/', ''))
  .filter((n) => !/embedding|image|video|vision|tts|aqa/.test(n))
  .sort((a, b) => (Number(/gemini-(\d+(?:\.\d+)?)/.exec(b)?.[1] ?? 0) - Number(/gemini-(\d+(?:\.\d+)?)/.exec(a)?.[1] ?? 0)))
  .find((n) => /flash/.test(n));
console.log('επιλογή:', chosen);

const t1 = Date.now();
const res = await fetch(`${base}/${chosen}:generateContent`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
  body: JSON.stringify({
    systemInstruction: { parts: [{ text: 'Μετέφρασε στα ελληνικά. Απάντησε ΜΟΝΟ με JSON πίνακα [{"id":1,"text":"..."}].' }] },
    contents: [{ role: 'user', parts: [{ text: '[{"id":1,"text":"Where did you park the car?"}]' }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  }),
});
const body = await res.text();
console.log(`απάντηση (${Date.now() - t1}ms, HTTP ${res.status}):`);
console.log(body.slice(0, 700));
