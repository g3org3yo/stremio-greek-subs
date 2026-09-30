import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Μικρός parser για .env: το project δεν θέλει dependency μόνο για να διαβάσει
// κλειδιά, και η μορφή που χρησιμοποιείται εδώ είναι απλή (KEY=value, # σχόλια).
export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    let line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

function num(value, fallback) {
  // Το Number('') είναι 0, όχι NaN: μια κενή ρύθμιση θα γινόταν σιωπηλά 0 και ένα
  // μέγεθος batch 0 θα κλείδωνε τη μετάφραση σε ατέρμονο βρόχο.
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig({ root = process.cwd(), env = process.env, envFile } = {}) {
  const file = envFile ?? join(root, '.env');
  const fromFile = existsSync(file) ? parseEnvFile(readFileSync(file, 'utf8')) : {};
  // Ό,τι δίνει το περιβάλλον της διεργασίας υπερισχύει του αρχείου: έτσι μια
  // δοκιμή ή ένα systemd-style unit μπορεί να παρακάμψει ό,τι θέλει.
  const v = { ...fromFile, ...env };
  const port = num(v.ADDON_PORT, 7000);

  return {
    port,
    // Το Stremio δέχεται addon από localhost — γι' αυτό η προεπιλογή είναι 127.0.0.1.
    baseUrl: v.ADDON_BASE_URL ?? `http://127.0.0.1:${port}`,
    subdlApiKey: v.SUBDL_API_KEY ?? '',
    geminiApiKey: v.GEMINI_API_KEY ?? '',
    geminiModel: v.GEMINI_MODEL ?? 'gemini-2.5-flash',
    geminiImageModel: v.GEMINI_IMAGE_MODEL ?? '',
    lmstudioBaseUrl: v.LMSTUDIO_BASE_URL ?? 'http://127.0.0.1:1234/v1',
    lmstudioModel: v.LMSTUDIO_MODEL ?? '',
    targetLang: v.TARGET_LANG ?? 'el',
    targetLangName: v.TARGET_LANG_NAME ?? 'Ελληνικά',
    sourceLangs: (v.SOURCE_LANGS ?? 'en').split(',').map((s) => s.trim()).filter(Boolean),
    providerOrder: (v.PROVIDER_ORDER ?? 'subdl').split(',').map((s) => s.trim()).filter(Boolean),
    priorityProviders: (v.PRIORITY_PROVIDERS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    batchSize: Math.max(1, num(v.TRANSLATE_BATCH_SIZE, 70)),
    minMatchScore: num(v.SUBDL_MIN_MATCH_SCORE, 0.8),
    cacheDir: v.CACHE_DIR ?? join(root, '.cache'),
    glossaryPath: v.GLOSSARY_PATH ?? join(root, 'glossary.json'),
    logFile: v.LOG_FILE ?? join(root, '.cache', 'addon.log'),
  };
}
