#!/usr/bin/env node
// Προθέρμανση: μεταφράζει τον υπότιτλο ΠΡΙΝ κάτσεις να δεις, ώστε το πρώτο άνοιγμα
// του μενού να δίνει έτοιμο υπότιτλο αντί για «σε εξέλιξη».
//
//   node scripts/prewarm.js tt15239678                  (ταινία)
//   node scripts/prewarm.js tt0903747:5:14              (επεισόδιο)
//   node scripts/prewarm.js tt15239678 "Dune.2024.mkv"  (με όνομα release: καλύτερο ταίριασμα)
import { createApp } from '../src/index.js';

const [, , id, filename] = process.argv;
if (!id) {
  console.error('Χρήση: node scripts/prewarm.js <imdb-id[:σεζόν:επεισόδιο]> [όνομα release]');
  process.exit(1);
}

const type = id.includes(':') ? 'series' : 'movie';
const app = createApp();
const [imdbId, season, episode] = id.split(':');
const vk = (await import('../src/orchestrator.js')).videoKey({ imdbId, season, episode });

console.log(`Ζητώ υπότιτλο για ${type} ${id}${filename ? ` (${filename})` : ''}…`);
const list = await app.orchestrator.list({ type, id, filename });

if (list.length === 0) {
  console.log('Δεν βρέθηκε υπότιτλος (ούτε ελληνικός, ούτε αγγλικός για μετάφραση).');
  process.exit(app.providers.length === 0 ? 2 : 0);
}

const entry = list[0];
if (!entry.id.startsWith('prog-')) {
  console.log(`Έτοιμος: ${entry.label}`);
  process.exit(0);
}

console.log('Μετάφραση σε εξέλιξη — περιμένω…');
const started = Date.now();
while (Date.now() - started < 15 * 60 * 1000) {
  const job = app.jobs.get(vk);
  if (job && (job.state === 'done' || job.state === 'failed')) {
    if (job.state === 'failed') {
      console.error(`Απέτυχε: ${job.message}`);
      process.exit(1);
    }
    console.log(`Έτοιμο: ${job.result?.translated ?? '?'}/${job.result?.total ?? '?'} cues μεταφρασμένα`);
    console.log(`Ο υπότιτλος είναι στη μνήμη — το επόμενο άνοιγμα στο Stremio θα τον βρει αμέσως.`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 1000));
}
console.error('Πέρασε το όριο αναμονής.');
process.exit(1);
