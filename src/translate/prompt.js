// Οι κανόνες είναι σε φυσική γλώσσα και στα ελληνικά, όπως και η έξοδος: τα μοντέλα
// τηρούν καλύτερα οδηγίες στη γλώσσα-στόχο, και οι δύο μηχανές (Gemini, τοπικό)
// παίρνουν ακριβώς το ίδιο prompt ώστε μια αλλαγή να ισχύει και για τις δύο.
const RULES = [
  'Μεταφράζεις υπότιτλους ταινιών και σειρών. Το αποτέλεσμα διαβάζεται από ανθρώπους που βλέπουν ταυτόχρονα την εικόνα.',
  'Γράψε φυσικά ελληνικά κινηματογραφικού τόνου, όχι κατά λέξη μετάφραση.',
  'Κράτα ΑΥΣΤΗΡΑ μία γραμμή εξόδου ανά γραμμή εισόδου — μην συνενώνεις, μη σπάσεις, μη συγχωνεύσεις cues.',
  'Κράτα τις παύλες διαλόγου (-), τα <i></i> και τα υπόλοιπα tags αυτούσια.',
  'Μη μεταφράζεις κύρια ονόματα, τίτλους έργων ή εμπορικά σήματα.',
  'Οι σημειώσεις για κωφούς ([θόρυβος], (γέλια)) μεταφράζονται κι αυτές, κρατώντας τις αγκύλες.',
  'Μην προσθέτεις σχόλια, επεξηγήσεις ή επιπλέον κείμενο. Μην αλλάζεις τη σειρά.',
  'Απάντησε ΜΟΝΟ με JSON array της μορφής [{"id":1,"text":"..."}] και τίποτα άλλο.',
  'Απάντησε ΜΟΝΟ με τα ζητούμενα ids. Ο αριθμός των αντικειμένων πρέπει να είναι ακριβώς όσος ο αριθμός των cues.',
];

export function buildPrompt({ items, targetLangName, context = {}, glossary }) {
  const lines = [...RULES, `Γλώσσα-στόχος: ${targetLangName}.`];

  const keep = glossary?.keep ?? [];
  if (keep.length > 0) lines.push(`Κράτα αμετάφραστα: ${keep.join(', ')}.`);

  const pairs = Object.entries(glossary?.map ?? {});
  if (pairs.length > 0) {
    lines.push(`Υποχρεωτικές αποδόσεις: ${pairs.map(([k, v]) => `"${k}" -> "${v}"`).join('; ')}.`);
  }

  const header = [];
  if (context.title) header.push(`Έργο: ${context.title}${context.year ? ` (${context.year})` : ''}`);

  const payload = items.map((it) => ({ id: it.id, text: it.text }));
  const user = `${header.length ? `${header.join('\n')}\n` : ''}Μετέφρασε τα παρακάτω ${payload.length} cues:\n${JSON.stringify(payload)}`;
  return { system: lines.join('\n'), user };
}

// Τα μοντέλα δεν είναι τυπικοί πελάτες API: βάζουν fences, πρόλογο, περιστασιακά
// αλλάζουν τον τύπο του id. Δεχόμαστε ό,τι μπορούμε να ερμηνεύσουμε με βεβαιότητα
// και αγνοούμε σιωπηλά ό,τι δεν μπορούμε — το κάθε cue που λείπει καλύπτεται από
// το πρωτότυπο κείμενο, οπότε δεν υπάρχει κίνδυνος διάβασμα λάθος γραμμής.
export function parseTranslationReply(text, expectedIds) {
  const allowed = new Set(expectedIds);
  const result = new Map();
  if (!text) return result;

  const cleaned = String(text).replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return result;

  let parsed;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return result;
  }
  if (!Array.isArray(parsed)) return result;

  for (const row of parsed) {
    const id = Number(row?.id);
    if (!Number.isInteger(id) || !allowed.has(id)) continue;
    if (typeof row?.text !== 'string' || row.text.trim() === '') continue;
    result.set(id, row.text);
  }
  return result;
}
