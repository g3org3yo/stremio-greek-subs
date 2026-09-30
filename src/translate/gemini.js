import { buildPrompt } from './prompt.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

// Το Gemini δίνει δωρεάν ημερήσιο όριο. Όταν τελειώσει δεν είναι «σφάλμα δικτύου»:
// το 429/403 σημαίνει «μην ξαναδοκιμάσεις σήμερα» και η σειρά fallback πρέπει να
// το ξεχωρίζει από ένα παροδικό 500 που αξίζει επανάληψη.
export function createGeminiEngine({ apiKey, model, fetchImpl = fetch }) {
  return {
    name: 'gemini',

    async isAvailable() {
      return Boolean(apiKey);
    },

    async translateBatch({ items, targetLangName, context, glossary }) {
      const { system, user } = buildPrompt({ items, targetLangName, context, glossary });
      const res = await fetchImpl(`${ENDPOINT}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
        }),
      });

      if (res.status === 429 || res.status === 403) {
        const body = await res.text().catch(() => '');
        throw Object.assign(new Error(`Gemini όριο/άδεια (${res.status}): ${body.slice(0, 200)}`), {
          quotaExhausted: true,
        });
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Gemini σφάλμα ${res.status}: ${body.slice(0, 200)}`);
      }

      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      return parts.map((p) => p.text ?? '').join('');
    },
  };
}
