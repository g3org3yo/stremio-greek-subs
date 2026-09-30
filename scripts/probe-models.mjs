// Ποιο μοντέλο απαντά πραγματικά; (η λίστα /models περιέχει και μοντέλα που δεν σερβίρονται)
import { loadConfig } from '../src/config.js';

const config = loadConfig({ env: process.env });
const key = config.geminiApiKey;

async function tryModel(version, model) {
  const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent`;
  const t = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: 'Μετέφρασε στα ελληνικά. ΜΟΝΟ JSON πίνακας [{"id":1,"text":"..."}].' }] },
        contents: [{ role: 'user', parts: [{ text: '[{"id":1,"text":"Where is the car?"}]' }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(20000),
    });
    const body = await res.text();
    const ms = Date.now() - t;
    const head = body.slice(0, 150).replace(/\s+/g, ' ');
    console.log(`${res.ok ? '✔' : '✖'} ${version}/${model}  ${res.status} ${ms}ms  ${head}`);
    return res.ok;
  } catch (err) {
    console.log(`✖ ${version}/${model}  ${Date.now() - t}ms  ${err.name}: ${err.message}`);
    return false;
  }
}

for (const model of ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-lite-latest']) {
  await tryModel('v1beta', model);
}
await tryModel('v1alpha', 'gemini-3.8-flash');
