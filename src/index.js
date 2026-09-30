import { loadConfig } from './config.js';
import { loadGlossary } from './translate/glossary.js';
import { createCache } from './cache.js';
import { createJobQueue } from './jobs.js';
import { createProviders } from './providers/index.js';
import { createGeminiEngine } from './translate/gemini.js';
import { createLmStudioEngine } from './translate/lmstudio.js';
import { createOrchestrator } from './orchestrator.js';
import { createAddonServer } from './server.js';
import { createLogger } from './log.js';

// Ένα σημείο όπου δένονται όλα, ώστε οι δοκιμές να μπορούν να φτιάξουν ολόκληρη
// την εφαρμογή με δικό τους root και δικό τους περιβάλλον.
export function createApp({ root = process.cwd(), env = process.env, fetchImpl = fetch } = {}) {
  const config = loadConfig({ root, env });
  const log = createLogger({ file: config.logFile });
  const glossary = loadGlossary(config.glossaryPath);
  const cache = createCache(config.cacheDir);
  const jobs = createJobQueue({ log });
  const providers = createProviders(config, fetchImpl);

  // Σειρά του χρήστη: Gemini (δωρεάν όριο) πρώτα, τοπικό LM Studio ως εφεδρεία που
  // δεν κοστίζει τίποτα. Όποιος δεν έχει ρυθμιστεί απλώς δεν είναι διαθέσιμος.
  const engineFactories = {
    gemini: () =>
      createGeminiEngine({
        apiKey: config.geminiApiKey,
        model: config.geminiModel,
        baseUrl: config.geminiBaseUrl,
        timeoutMs: config.geminiTimeoutMs,
        fetchImpl,
      }),
    lmstudio: () =>
      createLmStudioEngine({ baseUrl: config.lmstudioBaseUrl, model: config.lmstudioModel, fetchImpl }),
  };
  const engines = config.engineOrder.map((name) => engineFactories[name]?.()).filter(Boolean);

  const orchestrator = createOrchestrator({
    config,
    providers,
    engines,
    cache,
    jobs,
    glossary,
    baseUrl: config.baseUrl,
    log,
  });

  const server = createAddonServer({ config, orchestrator, cache, jobs, logFile: config.logFile, log });

  return { config, log, glossary, cache, jobs, providers, engines, orchestrator, server };
}

function warnings({ config, providers }) {
  const out = [];
  if (providers.length === 0) {
    out.push('Δεν βρέθηκε πηγή υποτίτλων: βάλε SUBDL_API_KEY στο .env (δωρεάν κλειδί από το subdl.com).');
  }
  if (!config.geminiApiKey && !config.lmstudioModel) {
    out.push('Καμία μηχανή μετάφρασης: βάλε GEMINI_API_KEY ή άνοιξε το LM Studio και όρισε LMSTUDIO_MODEL.');
  }
  return out;
}

export async function start({ root = process.cwd(), env = process.env, port, host } = {}) {
  // Το logFile είναι μέσα στο cache dir: φτιάχνουμε πρώτα τον φάκελο.
  const app = createApp({ root, env });
  const listenPort = port ?? app.config.port;
  const listenHost = host ?? app.config.host;

  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(listenPort, listenHost, resolve);
  });

  const address = app.server.address();
  const origin = app.config.baseUrlExplicit ? app.config.baseUrl : `http://${listenHost}:${address.port}`;
  app.log(`[start] ο server ακούει στο ${origin} (${app.providers.length} πηγές, ${app.engines.length} μηχανές)`);
  for (const warning of warnings(app)) app.log(`[start] ΠΡΟΣΟΧΗ: ${warning}`);
  app.log(`[start] οδηγίες και κατάσταση: ${origin}/`);
  app.log(`[start] εγκατάσταση στο Stremio: stremio://${origin.replace(/^https?:\/\//, '')}/manifest.json`);

  const close = () =>
    new Promise((resolve) => {
      app.server.close(() => resolve());
    });

  return { ...app, origin, close };
}
