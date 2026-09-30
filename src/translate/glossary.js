import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Το glossary είναι ο μοχλός ποιότητας που έχει ο χρήστης: ονόματα, όροι, ατάκες που
// δεν πρέπει να μεταφραστούν κατά λέξη. Δεν είναι υποχρεωτικό — χωρίς αυτό δουλεύει.
export function loadGlossary(path) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { version: 0, keep: [], map: {}, hash: 'empty' };
  }

  const glossary = {
    version: parsed.version ?? 1,
    keep: Array.isArray(parsed.keep) ? parsed.keep : [],
    map: parsed.map && typeof parsed.map === 'object' ? parsed.map : {},
  };
  // Το hash μπαίνει στο κλειδί του cache: αλλάζεις το glossary, ακυρώνονται οι
  // αποθηκευμένες μεταφράσεις, δεν σερβίρεται παλιά απόδοση με νέους κανόνες.
  glossary.hash = createHash('sha1').update(JSON.stringify(glossary)).digest('hex').slice(0, 12);
  return glossary;
}
