import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Ο χρήστης θέλει ζωντανή έξοδο: ό,τι γίνεται στο addon φαίνεται και στην κονσόλα
// και στο αρχείο, γιατί όταν κάτι πάει στραβά η ερώτηση είναι πάντα «τι έγινε με
// αυτή την ταινία;» — και η απάντηση πρέπει να υπάρχει μετά το κλείσιμο του terminal.
export function createLogger({ file, console: out = console, time = () => new Date().toISOString() } = {}) {
  if (file) {
    try {
      mkdirSync(dirname(file), { recursive: true });
    } catch {
      file = null;
    }
  }

  return function log(message) {
    const line = `${time()} ${message}`;
    out.log(line);
    if (!file) return;
    try {
      appendFileSync(file, `${line}\n`, 'utf8');
    } catch {
      // Αν ο δίσκος δεν δεχτεί εγγραφή, το addon ΔΕΝ σταματά: η κονσόλα αρκεί.
    }
  };
}
