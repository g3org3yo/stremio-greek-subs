// Το μοντέλο δέχεται πολλά cues μαζί (λιγότερα αιτήματα, λιγότερα όρια) αλλά ένα
// τεράστιο αίτημα αυξάνει την πιθανότητα να παραλείψει γραμμές. Το μέγεθος του
// batch είναι ρύθμιση, όχι σταθερά.

// Τα cues χωρίς κείμενο δεν στέλνονται πουθενά: δεν υπάρχει τίποτα να μεταφραστεί.
export function makeBatches(cues, size) {
  const translatable = cues.filter((c) => c.text && c.text.trim() !== '');
  const batches = [];
  for (let i = 0; i < translatable.length; i += size) {
    batches.push({
      index: batches.length,
      items: translatable.slice(i, i + size).map((c) => ({ id: c.id, text: c.text })),
    });
  }
  return batches;
}

// Επιστρέφει νέα cues: τα timestamps περνούν αυτούσια, μεταφρασμένο κείμενο μπαίνει
// μόνο όπου υπάρχει, και όπου το μοντέλο δεν απάντησε κρατάμε το πρωτότυπο — ένα
// αγγλικό cue είναι πολύ καλύτερο από ένα κενό διάστημα χωρίς υπότιτλο.
export function applyTranslations(cues, byId) {
  return cues.map((cue) => {
    const hit = byId.get(cue.id);
    if (typeof hit === 'string' && hit.trim() !== '') return { ...cue, text: hit };
    return cue;
  });
}
