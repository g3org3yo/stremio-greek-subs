// Φτιάχνει το φορητό zip που στέλνεται σε άλλον υπολογιστή:
//   node tools/make-portable.mjs
// Μέσα: τα αρχεία του έργου, οι βιβλιοθήκες (node_modules), το Node που τρέχει
// αυτή τη στιγμή και οι οδηγίες. Έξω: .env, cache, output, κλειδιά — ποτέ.
import AdmZip from 'adm-zip';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(root, 'dist');
const OUT = join(OUT_DIR, 'Stremio-Greek-Subs-portable.zip');
// Το όνομα του φακέλου μέσα στο zip μένει ASCII: ελληνικά ονόματα σε zip
// εμφανίζονται αλλοιωμένα σε μερικούς αποσυμπιεστές.
const INNER = 'Stremio-Greek-Subs';
const SKIP_DIRS = new Set(['.git', 'cache', '.cache', 'output', 'dist', '.superpowers', 'logs', '.partial']);
const SKIP_FILES = new Set(['.env']);

function collect(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collect(full, acc);
    } else if (entry.isFile()) {
      if (SKIP_FILES.has(entry.name) || entry.name.endsWith('.log')) continue;
      acc.push(full);
    }
  }
  return acc;
}

const files = collect(root);
const zip = new AdmZip();
for (const file of files) {
  zip.addFile(`${INNER}/${relative(root, file).split(/[\\/]/).join('/')}`, readFileSync(file));
}

// Οι οδηγίες για τον παραλήπτη (CRLF + UTF-8: το Σημειωματάριο των Windows).
const odigies = readFileSync(join(root, 'tools', 'ODIGIES.txt'), 'utf8').replace(/\r?\n/g, '\r\n');
zip.addFile(`${INNER}/ODIGIES.txt`, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(odigies, 'utf8')]));

// Το Node που τρέχει αυτό το σενάριο: έτσι το πακέτο δουλεύει χωρίς εγκατάσταση.
zip.addFile(`${INNER}/node/node.exe`, readFileSync(process.execPath));

mkdirSync(OUT_DIR, { recursive: true });
zip.writeZip(OUT);

const names = zip.getEntries().map((e) => e.entryName);
const leaked = names.filter((n) => /(^|\/)\.env$/.test(n));
console.log(`πακέτο: ${OUT}`);
console.log(`μέγεθος: ${(statSync(OUT).size / 1048576).toFixed(1)} MB · αρχεία: ${names.length}`);
console.log(`node μαζί: ${names.includes(`${INNER}/node/node.exe`)} · βιβλιοθήκες: ${names.some((n) => n.includes('node_modules/'))}`);
console.log(`.env μέσα: ${leaked.length ? leaked.join(', ') : 'κανένα'}`);
if (leaked.length) process.exitCode = 1;
