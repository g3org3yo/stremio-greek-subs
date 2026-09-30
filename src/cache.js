import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SAFE = /^[A-Za-z0-9._-]{1,64}$/;

// Ο engine ΔΕΝ συμμετέχει στο κλειδί: μια μετάφραση ισχύει ό,τι κι αν την έφτιαξε,
// ώστε να μην ξαναπληρώνεται το ίδιο έργο μόνο και μόνο γιατί άλλαξε η μηχανή.
export function cacheKey({ sourceHash, targetLang, glossaryVersion }) {
  return createHash('sha1')
    .update(`${sourceHash}|${targetLang}|${glossaryVersion}`)
    .digest('hex')
    .slice(0, 12);
}

// Τα ids των providers γίνονται ονόματα αρχείων και τμήματα URL. Κάτι σαν
// "../../evil" ή "a/b" θα έγραφε έξω από τον φάκελο cache ή θα έσπαγε τη διαδρομή
// /s/:file. Ό,τι δεν ταιριάζει στο ασφαλές σύνολο κατακερματίζεται: παραμένει
// σταθερό για την ίδια είσοδο, αλλά δεν μπορεί να ξεφύγει από τον φάκελο.
export function safeKey(prefix, raw) {
  const value = String(raw ?? '');
  if (SAFE.test(value)) return `${prefix}-${value}`;
  return `${prefix}-${createHash('sha1').update(value).digest('hex').slice(0, 12)}`;
}

// Έλεγχος για οτιδήποτε έρχεται από URL και καταλήγει σε όνομα αρχείου. Το `..`
// περνά το SAFE (οι τελείες επιτρέπονται), γι' αυτό απορρίπτεται ρητά: αλλιώς
// ένα σκέτο `..` θα έδειχνε φάκελο αντί για αρχείο.
export function isSafeKey(key) {
  const value = String(key ?? '');
  return SAFE.test(value) && !/^\.+$/.test(value);
}

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function createCache(dir) {
  mkdirSync(dir, { recursive: true });
  const srtPath = (key) => join(dir, `${key}.srt`);
  const metaPath = (key) => join(dir, `${key}.json`);

  return {
    has(key) {
      return existsSync(srtPath(key));
    },
    getSrt(key) {
      try {
        return readFileSync(srtPath(key), 'utf8');
      } catch {
        return null;
      }
    },
    meta(key) {
      return readJsonSafe(metaPath(key));
    },
    put(key, srtText, meta = {}) {
      writeFileSync(srtPath(key), srtText, 'utf8');
      writeFileSync(metaPath(key), JSON.stringify({ ...meta, key, savedAt: new Date().toISOString() }, null, 2), 'utf8');
    },
    list() {
      return readdirSync(dir)
        .filter((f) => f.endsWith('.srt'))
        .map((f) => {
          const key = f.replace(/\.srt$/, '');
          const st = statSync(join(dir, f));
          return {
            key,
            bytes: st.size,
            modified: st.mtime.toISOString(),
            ...(readJsonSafe(metaPath(key)) ?? {}),
          };
        })
        .sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
    },
    remove(key) {
      for (const p of [srtPath(key), metaPath(key)]) {
        if (existsSync(p)) rmSync(p, { force: true });
      }
    },
    stats() {
      const files = readdirSync(dir).filter((f) => f.endsWith('.srt'));
      let bytes = 0;
      for (const f of files) bytes += statSync(join(dir, f)).size;
      return { count: files.length, bytes };
    },
  };
}
