import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Ο φάκελος output/ δεν είναι cache: μέσα μπαίνει το ΤΕΛΙΚΟ προϊόν, με όνομα που να
// ταιριάζει σε αυτό που έχει ο χρήστης στον δίσκο του, έτοιμο για upload σε όποιο
// site υποτίτλων θέλει. Γι' αυτό το όνομα του βίντεο κρατιέται σχεδόν αυτούσιο
// (τελείες, αγκύλες, όνομα ομάδας) και προστίθεται μόνο η κατάληξη της γλώσσας.

const TAG = 'Greek';

// Μόνο γνωστές καταλήξεις κόβονται: ένα «.x264» είναι μέρος του ονόματος, όχι τύπος
// αρχείου, και δεν πρέπει να χαθεί από τον τίτλο.
const MEDIA_EXT = /\.(mp4|mkv|avi|mov|m4v|webm|wmv|flv|mpg|mpeg|m2ts|ts|vob|ogv|3gp|srt|sub|ass|ssa|vtt|txt)$/i;
// Τα Windows απαγορεύουν αυτούς τους χαρακτήρες σε όνομα αρχείου.
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g;
// ...και αυτά τα ονόματα-συσκευές, σε οποιονδήποτε φάκελο.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
// 150 + «-Greek.srt» μένει κάτω από τα 255 του NTFS και δεν γεμίζει την οθόνη.
const MAX_BASE = 150;

function clean(value) {
  const out = String(value ?? '')
    .replace(ILLEGAL, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .slice(0, MAX_BASE)
    .trim();
  if (!out) return '';
  return RESERVED.test(out) ? `_${out}` : out;
}

// «C:\Λήψεις\Teenage...-[YTS.GG - YTS.BZ].mp4» -> «Teenage...-[YTS.GG - YTS.BZ]»
export function videoBaseName(videoFileName) {
  const raw = String(videoFileName ?? '').trim();
  if (!raw) return null;
  // Το Stremio δίνει άλλοτε σκέτο όνομα, άλλοτε διαδρομή (και με backslashes).
  const normalized = raw.replace(/\\/g, '/');
  // Διαδρομή που τελειώνει σε διαχωριστικό δεν δείχνει αρχείο: το όνομα του φακέλου
  // («Λήψεις») δεν είναι ταινία, γι' αυτό προτιμάμε την εφεδρεία.
  if (normalized.endsWith('/')) return null;
  const flat = normalized.split('/').filter(Boolean).pop();
  if (!flat) return null;
  return clean(flat.replace(MEDIA_EXT, '')) || null;
}

// Εφεδρείες όταν ο player δεν στείλει όνομα αρχείου (π.χ. streaming): το όνομα του
// release που κατέβηκε, αλλιώς ένα σταθερό όνομα από το imdb id και το επεισόδιο.
function releaseBaseName(releaseName) {
  const value = String(releaseName ?? '').trim();
  if (!value) return null;
  const flat = value.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '';
  return clean(flat.replace(MEDIA_EXT, '')) || null;
}

function episodeBaseName({ imdbId, season, episode }) {
  const id = String(imdbId ?? '').trim();
  if (!id) return null;
  const parts = [id];
  if (season != null && String(season) !== '') {
    const s = String(season).padStart(2, '0');
    const e = episode != null && String(episode) !== '' ? String(episode).padStart(2, '0') : null;
    parts.push(e ? `S${s}E${e}` : `S${s}`);
  }
  return parts.join('-');
}

// Το «-Greek» μπαίνει πάντα στο τέλος, μία φορά: έτσι το ίδιο όνομα βγαίνει ίδιο
// ακόμη κι αν το release έφερε ήδη δικό του «.Greek» ή «-GREEK».
function withTag(base) {
  const stripped = base.replace(new RegExp(`[-._]${TAG}$`, 'i'), '').trim() || base;
  const suffix = `-${TAG}`;
  const trimmed = stripped.length + suffix.length > MAX_BASE ? stripped.slice(0, MAX_BASE - suffix.length).trim() : stripped;
  return `${trimmed}${suffix}.srt`;
}

export function outputName({ videoFileName, releaseName, imdbId, season, episode } = {}) {
  const base =
    videoBaseName(videoFileName) ??
    releaseBaseName(releaseName) ??
    episodeBaseName({ imdbId, season, episode }) ??
    'subtitle';
  return withTag(base);
}

// Ίδιο περιεχόμενο = καμία εγγραφή: το άνοιγμα του μενού υποτίτλων ξανά και ξανά δεν
// πρέπει να πειράζει την ημερομηνία των αρχείων που ο χρήστης έχει ήδη ανεβάσει.
export function writeOutput(dir, name, text) {
  if (!dir || !name) return null;
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  if (existsSync(path)) {
    try {
      if (readFileSync(path, 'utf8') === text) return { path, name, written: false };
    } catch {
      // Άμα δεν διαβάζεται, το ξαναγράφουμε — δεν χάνουμε τίποτα.
    }
  }
  writeFileSync(path, text, 'utf8');
  return { path, name, written: true };
}

export function listOutput(dir, { limit } = {}) {
  if (!dir || !existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => /\.(srt|ass|ssa|vtt)$/i.test(f))
    .map((f) => {
      const st = statSync(join(dir, f));
      return { name: f, bytes: st.size, modified: st.mtime.toISOString() };
    })
    .sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
  return limit ? files.slice(0, limit) : files;
}

// Το όνομα έρχεται από URL: δεν χτίζουμε ποτέ διαδρομή από αυτό. Κοιτάμε αν υπάρχει
// κυριολεκτικά μέσα στον φάκελο, οπότε ένα «../.env» δεν έχει πού να πάει.
export function findOutput(dir, name) {
  if (!dir || !name) return null;
  return listOutput(dir).find((f) => f.name === name) ?? null;
}

export function readOutput(dir, name) {
  const hit = findOutput(dir, name);
  if (!hit) return null;
  try {
    return { ...hit, buffer: readFileSync(join(dir, hit.name)) };
  } catch {
    return null;
  }
}
