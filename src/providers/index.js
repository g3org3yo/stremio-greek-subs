import { createSubdlProvider } from './subdl.js';

// Η σειρά έρχεται από τη ρύθμιση, ώστε να μπει δεύτερος provider (π.χ.
// OpenSubtitles) χωρίς αλλαγή κώδικα παραπάνω. Όποιος δεν έχει κλειδί απλώς
// δεν υπάρχει στη λίστα — ο orchestrator δεν χρειάζεται να ξέρει γιατί.
export function createProviders(config, fetchImpl = fetch) {
  const factories = {
    subdl: () =>
      config.subdlApiKey
        ? createSubdlProvider({
            apiKey: config.subdlApiKey,
            fetchImpl,
            minMatchScore: config.minMatchScore,
          })
        : null,
    // Επόμενη φάση: η θέση στη σειρά υπάρχει ήδη, η υλοποίηση όχι.
    opensubtitles: () => null,
  };

  return config.providerOrder
    .map((name) => factories[name]?.())
    .filter((p) => p && p.isConfigured());
}
