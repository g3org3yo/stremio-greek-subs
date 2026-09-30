const TIME_RE = /^\s*(\d{1,3}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,3}:\d{2}:\d{2}[,.]\d{1,3})/;

// Κανονικοποιεί σε HH:MM:SS,mmm — τη μορφή που περιμένει το Stremio και κάθε player.
export function normalizeTime(t) {
  const [hms, ms] = t.trim().replace('.', ',').split(',');
  const [h, m, s] = hms.split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')},${(ms ?? '0').padEnd(3, '0').slice(0, 3)}`;
}

// Δέχεται ήδη αποκωδικοποιημένο κείμενο και επιστρέφει cues.
//
// Τα timestamps μένουν STRINGS: δεν μετατρέπονται ποτέ σε αριθμούς, άρα δεν
// υπάρχει περίπτωση σφάλματος στρογγυλοποίησης που θα μετατόπιζε τους υπότιτλους
// προς το τέλος μιας ταινίας. Αυτός είναι ο λόγος που η μορφή διατηρείται αυτούσια.
export function parseSrt(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const cues = [];
  let i = 0;

  while (i < lines.length) {
    const match = lines[i].match(TIME_RE);
    if (!match) {
      i += 1;
      continue;
    }
    const start = normalizeTime(match[1]);
    const end = normalizeTime(match[2]);
    i += 1;

    const body = [];
    while (i < lines.length && lines[i].trim() !== '') {
      body.push(lines[i].replace(/\s+$/, ''));
      i += 1;
    }
    // Το index του αρχείου μπορεί να λείπει ή να είναι λάθος· δίνουμε δικό μας
    // σταθερό και μοναδικό, γιατί πάνω του στηρίζεται το ταίριασμα των μεταφράσεων.
    cues.push({ id: cues.length + 1, start, end, text: body.join('\n') });
  }
  return cues;
}
