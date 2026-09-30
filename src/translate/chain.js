import { parseTranslationReply } from './prompt.js';

// Πόσο μικρό batch δεν αξίζει να σπάσει άλλο, και πόσο βαθιά επιτρέπεται το σπάσιμο.
const MIN_SPLIT = 12;
const MAX_DEPTH = 2;

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

  // Ένα αίτημα σε μία μηχανή. Αν η απάντηση δεν έχει καθόλου ερμηνεύσιμο κείμενο,
  // συνήθως φταίει το μέγεθος: το μοντέλο χτύπησε το όριο εξόδου στη μέση του
  // array. Τότε ξαναζητάμε τα μισά-μισά — με λιγότερη έξοδο χωράει. Μετρημένο
  // ζωντανά: batch 70 cues χάθηκε ολόκληρο, τα μισά του πέρασαν.
  async function ask(engine, items, context, depth) {
    const raw = await engine.translateBatch({ items, targetLangName, context, glossary });
    const map = parseTranslationReply(raw, items.map((it) => it.id));
    if (map.size > 0 || items.length <= MIN_SPLIT || depth >= MAX_DEPTH) return map;

    const mid = Math.ceil(items.length / 2);
    log(`[chain] ο ${engine.name} δεν έδωσε τίποτα για ${items.length} cues — σπάω το batch στα δύο`);
    const out = new Map();
    for (const half of [items.slice(0, mid), items.slice(mid)]) {
      for (const [id, text] of await ask(engine, half, context, depth + 1)) out.set(id, text);
    }
    return out;
  }

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

        let map;
        try {
          map = await ask(engine, items, context, 0);
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

        if (map.size === 0) {
          problems.push(`${engine.name}: μη έγκυρη απάντηση (0/${ids.length} cues)`);
          log(`[chain] ο ${engine.name} δεν έδωσε ερμηνεύσιμη απάντηση`);
          continue;
        }

        // Ό,τι έμεινε το ζητάμε άλλη μία φορά — αλλά μόνο όταν η απώλεια αξίζει ένα
        // ακόμη αίτημα (ένα ολόκληρο μικρό batch): με μικρότερη έξοδο δεν κόβεται
        // ξανά. Έτσι ένα batch 70 cues που έχασε την ουρά του ολοκληρώνεται αντί να
        // μείνουν αγγλικές γραμμές. Το βάθος είναι φραγμένο, δεν υπάρχει βρόχος.
        const missing = items.filter((it) => !map.has(it.id));
        if (missing.length >= MIN_SPLIT) {
          log(`[chain] ο ${engine.name} έδωσε ${map.size}/${ids.length} — δεύτερο πέρασμα για τα ${missing.length}`);
          try {
            for (const [id, text] of await ask(engine, missing, context, MAX_DEPTH)) map.set(id, text);
          } catch (err) {
            log(`[chain] το δεύτερο πέρασμα απέτυχε: ${err.message}`);
          }
        }
        if (map.size < ids.length) {
          log(`[chain] προσοχή: ${map.size}/${ids.length} cues μεταφρασμένα, τα υπόλοιπα μένουν στο πρωτότυπο`);
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
