#!/usr/bin/env node
// Διάγνωση: τι είναι ρυθμισμένο και τι όχι. Η πρώτη ερώτηση όταν κάτι δεν δουλεύει
// είναι πάντα «έχω κλειδιά; με ακούει το μοντέλο; πόσο όριο μου μένει;».
import { createApp } from '../src/index.js';

const app = createApp();
const line = (ok, text) => console.log(`${ok ? '  ✔' : '  ✖'} ${text}`);

console.log(`Root: ${process.cwd()}`);
console.log(`Cache: ${app.config.cacheDir}`);
console.log(`Μετάφραση: ${app.config.targetLangName} (${app.config.targetLang})`);

console.log('\nΠηγές υποτίτλων:');
if (app.providers.length === 0) {
  line(false, 'καμία — βάλε SUBDL_API_KEY στο .env (δωρεάν κλειδί: subdl.com/developers)');
}
for (const provider of app.providers) {
  line(true, `${provider.name}: ρυθμισμένος (σειρά: ${app.config.providerOrder.join(' > ')})`);
  if (typeof provider.quota === 'function') {
    try {
      const q = await provider.quota();
      console.log(
        `      όριο: ${q.searches?.remaining ?? '?'}/${q.searches?.limit ?? '?'} αναζητήσεις, ` +
          `${q.downloads?.remaining ?? '?'}/${q.downloads?.limit ?? '?'} λήψεις (${q.plan?.name ?? '—'})`,
      );
    } catch (err) {
      console.log(`      το όριο δεν διαβάστηκε: ${err.message}`);
    }
  }
}

console.log('\nΜηχανές μετάφρασης:');
for (const engine of app.engines) {
  let available = false;
  try {
    available = await engine.isAvailable();
  } catch (err) {
    console.log(`      ${err.message}`);
  }
  line(available, `${engine.name}: ${available ? 'έτοιμος' : 'δεν είναι διαθέσιμος'}`);
}
if (!app.config.geminiApiKey) {
  console.log('      (χωρίς GEMINI_API_KEY πάμε στο τοπικό LM Studio — θέλει `lms server start`)');
}

console.log('\nΥπότιτλοι στη μνήμη:');
const entries = app.cache.list();
console.log(`  ${entries.length} αρχεία (${Math.round((app.cache.stats().bytes ?? 0) / 1024)} KB)`);
for (const e of entries.slice(0, 8)) {
  const kind = e.kind === 'ai-translation' ? 'μετάφραση' : e.kind === 'provider' ? 'έτοιμος' : 'πηγή';
  console.log(`  - ${e.key} · ${kind} · ${e.releaseName ?? '—'}`);
}

app.server.close();
process.exit(0);
