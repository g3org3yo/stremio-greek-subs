import { parseTranslationReply } from './prompt.js';

// Η σειρά fallback είναι το κέντρο της αξιοπιστίας: ο χρήστης δεν πρέπει να δει
// «η μετάφραση απέτυχε» επειδή τελείωσε το δωρεάν όριο του ενός παρόχου.
//
// Δύο διαφορετικές αποτυχίες αντιμετωπίζονται διαφορετικά:
//  - εξάντληση ορίου (quotaExhausted): ο engine βγαίνει από τη σειρά για τη
//    διάρκεια της διεργασίας — δεν έχει νόημα να ξαναδοκιμαστεί σε κάθε batch.
//  - παροδικό σφάλμα: προσπερνιέται για αυτό το batch και ξαναδοκιμάζεται στο
//    επόμενο, ώστε ένα στιγμιαίο 500 να μην αφαιρέσει τον καλύτερο engine.
export function createChain({ engines, targetLangName, glossary, log = () => {} }) {
  const exhausted = new Set();

  return {
    async translateBatch(items, context = {}) {
      const ids = items.map((it) => it.id);
      const problems = [];

      for (const engine of engines) {
        if (exhausted.has(engine.name)) continue;

        if (typeof engine.isAvailable === 'function') {
          let available = false;
          try {
            available = await engine.isAvailable();
          } catch (err) {
            log(`[chain] ο έλεγχος διαθεσιμότητας του ${engine.name} απέτυχε: ${err.message}`);
          }
          if (!available) {
            problems.push(`${engine.name}: δεν είναι διαθέσιμος`);
            continue;
          }
        }

        let raw;
        try {
          raw = await engine.translateBatch({ items, targetLangName, context, glossary });
        } catch (err) {
          if (err.quotaExhausted) {
            exhausted.add(engine.name);
            log(`[chain] ο ${engine.name} εξαντλήθηκε: ${err.message}`);
          } else {
            log(`[chain] ο ${engine.name} απέτυχε: ${err.message}`);
          }
          problems.push(`${engine.name}: ${err.message}`);
          continue;
        }

        const map = parseTranslationReply(raw, ids);
        if (map.size === 0) {
          problems.push(`${engine.name}: μη έγκυρη απάντηση (0/${ids.length} cues)`);
          log(`[chain] ο ${engine.name} δεν έδωσε ερμηνεύσιμη απάντηση`);
          continue;
        }
        if (map.size < ids.length) {
          log(`[chain] προσοχή: ο ${engine.name} μετέφρασε ${map.size}/${ids.length} cues`);
        }
        return map;
      }

      throw new Error(`Καμία μηχανή μετάφρασης δεν τα κατάφερε. ${problems.join(' | ')}`);
    },

    status() {
      return { exhausted: [...exhausted], engines: engines.map((e) => e.name) };
    },
  };
}
