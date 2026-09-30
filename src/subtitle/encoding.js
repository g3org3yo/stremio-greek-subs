// Οι υπότιτλοι κυκλοφορούν σε τρεις κωδικοποιήσεις στην πράξη: UTF-8 (σύγχρονοι),
// Windows-1253 (παλαιότεροι ελληνικοί) και Windows-1252 (αγγλικοί με έξυπνα εισαγωγικά).
// Λάθος ανίχνευση = σκουπίδια σε όλη τη ταινία, γι' αυτό δεν μαντεύουμε με λίστες
// byte-order-mark αλλά δοκιμάζουμε αυστηρά και μετράμε το αποτέλεσμα.

const UTF8 = 'utf-8';
const WINDOWS_1252 = 'windows-1252';
const WINDOWS_1253 = 'windows-1253';

function isGreekLetter(code) {
  return (code >= 0x0386 && code <= 0x03ce) || code === 0x0390 || code === 0x03b0;
}

// Το UTF-8 είναι αυστηρό: αν αποκωδικοποιείται χωρίς σφάλμα, είναι UTF-8.
function isValidUtf8(buf) {
  try {
    new TextDecoder(UTF8, { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

function score(text) {
  let greek = 0;
  let garbage = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (isGreekLetter(code)) greek += 1;
    else if (code === 0xfffd) garbage += 1;
  }
  // Τα ελληνικά γράμματα μετρούν υπέρ, τα αντικαταστατικά κατά.
  return greek * 3 - garbage * 5;
}

export function decodeSubtitle(buf) {
  const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const body = bom ? buf.subarray(3) : buf;
  const lineEnding = body.includes(0x0d) ? '\r\n' : '\n';

  if (bom) return { text: body.toString('utf8'), encoding: UTF8, bom: true, lineEnding };
  if (isValidUtf8(body)) return { text: body.toString('utf8'), encoding: UTF8, bom: false, lineEnding };

  // Δεν είναι UTF-8. Δοκιμάζουμε 1252 πρώτα και δεχόμαστε 1253 μόνο με ΑΥΣΤΗΡΑ
  // καλύτερο σκορ: στα καθαρά λατινικά τα δύο συμπίπτουν, και το 1252 είναι το
  // σωστό εκεί. Το 1253 κερδίζει μόνο όταν βρει πραγματικά ελληνικά γράμματα.
  let best = null;
  for (const encoding of [WINDOWS_1252, WINDOWS_1253]) {
    const text = new TextDecoder(encoding).decode(body);
    const s = score(text);
    if (!best || s > best.score) best = { encoding, text, score: s };
  }
  return { text: best.text, encoding: best.encoding, bom: false, lineEnding };
}
