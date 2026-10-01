import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

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

// Δέχεται πολλά ονόματα για την ίδια ρύθμιση: όποιος ακολούθησε το .env.example ή
// όποιος αντέγραψε ρυθμίσεις από το Hermes πρέπει να δουλεύει και στις δύο περιπτώσεις.
// Το κενό string μετράει ως «δεν δόθηκε», ώστε μια άδεια γραμμή να μην κρύβει το alias.
function pick(...values) {
  return values.find((x) => x !== undefined && x !== null && String(x).trim() !== '');
}

function list(value, fallback = '') {
  return String(value ?? fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig({ root = process.cwd(), env = process.env, envFile } = {}) {
  const file = envFile ?? join(root, '.env');
  const fromFile = existsSync(file) ? parseEnvFile(readFileSync(file, 'utf8')) : {};
  // Ό,τι δίνει το περιβάλλον της διεργασίας υπερισχύει του αρχείου: έτσι μια
  // δοκιμή ή ένα systemd-style unit μπορεί να παρακάμψει ό,τι θέλει.
  const v = { ...fromFile, ...env };
  const port = num(pick(v.PORT, v.ADDON_PORT), 7000);
  // Φάση 1: μόνο τοπικά. Το BIND_HOST υπάρχει για αργότερα (κινητό στο ίδιο WiFi),
  // αλλά η προεπιλογή κρατά το addon αόρατο στο δίκτυο.
  const host = pick(v.BIND_HOST, v.ADDON_HOST) ?? '127.0.0.1';
  // Αν ο χρήστης ακούει σε όλες τις διεπαφές, η διεύθυνση που δίνουμε στον ίδιο τον
  // υπολογιστή παραμένει η loopback — το 0.0.0.0 δεν είναι προσβάσιμο από browser.
  const browserHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const cacheDir = isAbsolute(v.CACHE_DIR ?? '') ? v.CACHE_DIR : resolve(root, v.CACHE_DIR ?? '.cache');
  // Ο φάκελος με τους έτοιμους υπότιτλους για upload. Δίπλα στο έργο, ώστε ο χρήστης
  // να τον βρίσκει με το μάτι· δεν είναι cache και δεν πρέπει να σβήνεται μαζί της.
  const outputDir = isAbsolute(v.OUTPUT_DIR ?? '') ? v.OUTPUT_DIR : resolve(root, v.OUTPUT_DIR ?? 'output');

  return {
    port,
    host,
    baseUrl: pick(v.ADDON_BASE_URL) ?? `http://${browserHost}:${port}`,
    // Όταν ο χρήστης δηλώσει ρητά διεύθυνση (π.χ. HTTPS μέσω tunnel), αυτή υπερισχύει
    // πάντα· αλλιώς ο server χτίζει τα URLs από το Host του αιτήματος, ώστε το addon
    // να δουλεύει σωστά ακόμη κι αν αλλάξει η θύρα.
    baseUrlExplicit: Boolean(pick(v.ADDON_BASE_URL)),
    subdlApiKey: pick(v.SUBDL_API_KEY) ?? '',
    // GOOGLE_API_KEY είναι το όνομα που χρησιμοποιεί το Hermes: το δεχόμαστε για να
    // μη χρειάζεται ο χρήστης να θυμάται δεύτερο όνομα για το ίδιο κλειδί.
    geminiApiKey: pick(v.GEMINI_API_KEY, v.GOOGLE_API_KEY) ?? '',
    // Κενό = αυτόματη επιλογή: η Google αποσύρει μοντέλα, και ένα καρφωμένο όνομα
    // γίνεται 404 χωρίς λόγο. Το addon διαβάζει τη λίστα /models και διαλέγει flash.
    geminiModel: pick(v.GEMINI_MODEL) ?? '',
    // Το endpoint είναι ρύθμιση, όχι σταθερά: το Hermes του χρήστη δίνει ήδη
    // GEMINI_BASE_URL και το addon πρέπει να σέβεται την ίδια τιμή.
    geminiBaseUrl: pick(v.GEMINI_BASE_URL) ?? 'https://generativelanguage.googleapis.com/v1beta',
    // Χρονικό όριο ανά αίτημα: ένα κολλημένο αίτημα δεν πρέπει να παγώσει την ουρά
    // μετάφρασης (μετρημένο: το gemini-flash-latest δεν απάντησε καθόλου).
    geminiTimeoutMs: num(pick(v.GEMINI_TIMEOUT_MS), 90000),
    geminiImageModel: pick(v.GEMINI_IMAGE_MODEL) ?? '',
    lmstudioBaseUrl: pick(v.LMSTUDIO_BASE_URL) ?? 'http://127.0.0.1:1234/v1',
    lmstudioModel: pick(v.LMSTUDIO_MODEL) ?? '',
    targetLang: pick(v.TARGET_LANG) ?? 'el',
    targetLangName: pick(v.TARGET_LANG_NAME) ?? 'Ελληνικά',
    sourceLangs: list(pick(v.SOURCE_LANGS), 'en'),
    providerOrder: list(pick(v.PROVIDER_ORDER), 'subdl'),
    // Σειρά μηχανών μετάφρασης: Gemini (δωρεάν όριο) και μετά το τοπικό μοντέλο.
    engineOrder: list(pick(v.ENGINE_ORDER), 'gemini,lmstudio'),
    priorityProviders: list(v.PRIORITY_PROVIDERS),
    batchSize: Math.max(1, num(pick(v.TRANSLATE_BATCH_SIZE, v.BATCH_SIZE), 70)),
    minMatchScore: num(pick(v.SUBDL_MIN_MATCH_SCORE, v.MIN_MATCH_SCORE), 0.8),
    cacheDir,
    outputDir,
    glossaryPath: isAbsolute(v.GLOSSARY_FILE ?? '')
      ? v.GLOSSARY_FILE
      : resolve(root, pick(v.GLOSSARY_PATH, v.GLOSSARY_FILE) ?? 'glossary.json'),
    logFile: isAbsolute(v.LOG_FILE ?? '') ? v.LOG_FILE : resolve(cacheDir, v.LOG_FILE ?? 'addon.log'),
  };
}
