import { buildPrompt } from './prompt.js';

// Το LM Studio εκθέτει OpenAI-compatible API, άρα το ίδιο σώμα αίτησης δουλεύει και
// με άλλους τοπικούς servers (llama.cpp server, Ollama με /v1). Είναι η εφεδρεία που
// δεν κοστίζει τίποτα και δεν έχει όρια.
export function createLmStudioEngine({ baseUrl, model, fetchImpl = fetch }) {
  return {
    name: 'lmstudio',

    async isAvailable() {
      try {
        const res = await fetchImpl(`${baseUrl}/models`, { method: 'GET' });
        return Boolean(res.ok);
      } catch {
        return false;
      }
    },

    async translateBatch({ items, targetLangName, context, glossary }) {
      const { system, user } = buildPrompt({ items, targetLangName, context, glossary });

      let res;
      try {
        res = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            stream: false,
            temperature: 0.2,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
        });
      } catch (err) {
        // Ο πιο συχνός λόγος αποτυχίας στην πράξη: ο server δεν τρέχει.
        throw new Error(`Το τοπικό μοντέλο (LM Studio) δεν απαντά στο ${baseUrl}. Άνοιξέ το με: lms server start  [${err.message}]`);
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`LM Studio σφάλμα ${res.status}: ${body.slice(0, 200)}`);
      }

      const data = await res.json();
      return data?.choices?.[0]?.message?.content ?? '';
    },
  };
}
