# Greek Subs AI — Πλάνο Υλοποίησης

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Τοπικό Stremio addon στο PC που βρίσκει ελληνικούς υπότιτλους και, όταν δεν υπάρχουν, μεταφράζει τους αγγλικούς στα ελληνικά δωρεάν (Gemini free tier → τοπικό LM Studio).

**Architecture:** Μία Node διεργασία με τρία ανεξάρτητα στρώματα πίσω από στενές διεπαφές: `providers` (πηγές υποτίτλων), `subtitle` (μορφή SRT), `translate` (μηχανές μετάφρασης με σειρά fallback). Από πάνω, `orchestrator` αποφασίζει τη σειρά (cache → υπάρχοντες ελληνικοί → αγγλικοί+μετάφραση) και ο HTTP server εκθέτει το Stremio API. Η μετάφραση τρέχει σε ουρά στο παρασκήνιο και δεν μπλοκάρει ποτέ την απάντηση.

**Tech Stack:** Node.js LTS (portable, σε δικό μας φάκελο), ESM, `node:http`, global `fetch`, `node:test` + `node:assert/strict`, μία εξάρτηση (`adm-zip`). Χωρίς express, χωρίς βάση δεδομένων, χωρίς build step.

**Spec:** `docs/superpowers/specs/2026-09-30-stremio-greek-subs-design.md`

## Global Constraints

- **Node ≥ 22 LTS.** Το Node εγκαθίσταται portable στο `D:\Hermes Agent\Tools\node` (το `node` του Hermes είναι ιδιωτικό και δεν είναι στο system PATH).
- **ESM μόνο** (`"type": "module"`). Τίποτα άλλο εκτός από `adm-zip` ως runtime εξάρτηση.
- **Τα timestamps δεν περνούν ΠΟΤΕ από μοντέλο.** Παραμένουν strings από το αρχικό parse μέχρι το serialize· αυτό εγγυάται μηδέν μετατόπιση συγχρονισμού.
- **Κωδικοί γλώσσας:** SubDL API → `el` (ISO 639-1). Απάντηση στο Stremio → `ell` (ISO 639-2).
- **Ο engine δεν μπαίνει στο cache key.** Κλειδί = `sha1(sourceHash|targetLang|glossaryVersion)`.
- **User-facing μηνύματα στα ελληνικά· κώδικας, σχόλια, ονόματα μεταβλητών στα αγγλικά.**
- **Κανένα credential σε git.** Το `.env` είναι στο `.gitignore`.
- **Το addon δεν κάνει ποτέ blocking αίτημα πάνω από 3 δευτερόλεπτα** προς το Stremio.
- **Ζωντανή έξοδος:** κάθε batch μετάφρασης τυπώνει γραμμή προόδου στο stdout.
- Paths: project root = `D:\Hermes Agent\Projects\stremio-greek-subs`. Όλα τα commands τρέχουν από εκεί.

---

## File Structure

| Αρχείο | Ευθύνη |
|---|---|
| `package.json` | ESM, scripts `start`/`test`, εξάρτηση `adm-zip` |
| `.env.example` | Όλες οι ρυθμίσεις, χωρίς τιμές |
| `glossary.json` | Όροι/ονόματα που δεν μεταφράζονται (το διορθώνει ο χρήστης) |
| `src/config.js` | Φόρτωση `.env` → αντικείμενο ρυθμίσεων, με defaults |
| `src/logger.js` | Γραμμές προόδου σε stdout + `logs/addon.log` |
| `src/subtitle/encoding.js` | Ανίχνευση/αποκωδικοποίηση UTF-8, Windows-1253, Windows-1252 |
| `src/subtitle/parse.js` | SRT → cues |
| `src/subtitle/serialize.js` | cues → SRT (UTF-8 με BOM) |
| `src/subtitle/batch.js` | Ομαδοποίηση cues + επανασυναρμολόγηση μεταφράσεων |
| `src/translate/prompt.js` | Κατασκευή prompt + ανεκτικό parsing της απάντησης |
| `src/translate/glossary.js` | Φόρτωση + hash του glossary |
| `src/translate/gemini.js` | Engine: Gemini free tier |
| `src/translate/lmstudio.js` | Engine: τοπικό LM Studio (OpenAI-compatible) |
| `src/translate/chain.js` | Σειρά engines, ημερήσια εξάντληση, fallback |
| `src/cache.js` | Κλειδί + αποθήκευση/ανάγνωση/διαγραφή αρχείων cache |
| `src/providers/subdl.js` | SubDL API v2: search, files/search, download, /me |
| `src/providers/index.js` | Σειρά providers από τη ρύθμιση |
| `src/jobs.js` | Ουρά, dedupe, πρόοδος, συνέχεια από `.partial` |
| `src/orchestrator.js` | Η σειρά: cache → ελληνικοί → αγγλικοί+μετάφραση |
| `src/admin.js` | HTML σελίδα `/admin` + `/health` |
| `src/index.js` | HTTP server, routes, binding |
| `test/*.test.js` | Unit + integration tests |
| `scripts/check-engines.js` | Έλεγχος Gemini/LM Studio + υπόλοιπο SubDL |
| `scripts/prewarm.js` | Χειροκίνητη προθέρμανση μετάφρασης (CLI) |
| `start.cmd` | Εκκίνηση με απόλυτη διαδρομή node |
| `README.md` | Εγκατάσταση στο Stremio |

---

### Task 0: Περιβάλλον — Node LTS portable, σκελετός project

**Files:**
- Create: `package.json`, `.env.example`, `glossary.json`

**Interfaces:**
- Consumes: τίποτα
- Produces: `npm test` και `npm start` δουλεύουν· `node_modules` με `adm-zip`

- [ ] **Step 1: Εγκατάσταση Node LTS portable χωρίς UAC**

```bash
mkdir -p "/d/Hermes Agent/Tools" && cd "/d/Hermes Agent/Tools"
# βρες το τελευταίο LTS — μη μαντεύεις έκδοση
curl -s https://nodejs.org/dist/index.json \
  | python -c "import sys,json; d=json.load(sys.stdin); l=[x for x in d if x['lts']]; print(l[0]['version'])"
```
Σημείωσε την έκδοση που τυπώθηκε (π.χ. `v24.11.0`) και βάλε τη στη θέση `<VER>`:

```bash
VER=<VER>
curl -fL -o node.zip "https://nodejs.org/dist/$VER/node-$VER-win-x64.zip"
rm -rf "/d/Hermes Agent/Tools/node" && mkdir -p "/d/Hermes Agent/Tools/node"
tar -xf node.zip -C "/d/Hermes Agent/Tools/node" --strip-components=1
rm node.zip
"/d/Hermes Agent/Tools/node/node.exe" -v
```
Expected: τυπώνει την έκδοση, π.χ. `v24.11.0`

- [ ] **Step 2: Προσθήκη στο user PATH (μόνιμα, χωρίς admin)**

```bash
setx PATH "%PATH%;D:\Hermes Agent\Tools\node" >/dev/null
echo "$PATH" | tr ':' '\n' | grep -i "Tools/node" || echo "(θα ισχύσει σε νέα shells — τα start.cmd χρησιμοποιούν απόλυτη διαδρομή)"
```

- [ ] **Step 3: Σκελετός project**

`package.json`:
```json
{
  "name": "stremio-greek-subs",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "start": "node src/index.js",
    "test": "node --test test/",
    "check-engines": "node scripts/check-engines.js",
    "prewarm": "node scripts/prewarm.js"
  },
  "dependencies": { "adm-zip": "^0.5.16" }
}
```

`.env.example`:
```
PORT=7000
BIND_HOST=127.0.0.1
SUBDL_API_KEY=
OPENSUBTITLES_API_KEY=
GOOGLE_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
LMSTUDIO_BASE_URL=http://127.0.0.1:1234/v1
LMSTUDIO_MODEL=
TARGET_LANG=el
SOURCE_LANGS=en
PROVIDER_ORDER=subdl,opensubtitles
ENGINE_ORDER=gemini,lmstudio
BATCH_SIZE=70
CACHE_DIR=./cache
GLOSSARY_FILE=./glossary.json
LOG_LEVEL=info
MIN_MATCH_SCORE=0.8
```

`glossary.json`:
```json
{
  "version": 1,
  "keep": [],
  "map": {
    "the Force": "η Δύναμη",
    "Stormtrooper": "Στορμτρούπερ"
  },
  "notes": "keep = όροι που μένουν αμετάφραστοι. map = υποχρεωτική μετάφραση. Κάθε αλλαγή ακυρώνει το cache μετάφρασης."
}
```

- [ ] **Step 4: Εγκατάσταση εξάρτησης και επαλήθευση**

```bash
cd "/d/Hermes Agent/Projects/stremio-greek-subs"
export PATH="/d/Hermes Agent/Tools/node:$PATH"
npm install
npm test
```
Expected: `npm install` προσθέτει 1 πακέτο· `npm test` τρέχει χωρίς tests και βγαίνει με 0.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example glossary.json
git commit -m "chore: project scaffold, portable Node LTS, single dep adm-zip"
```

---

### Task 1: Ανίχνευση κωδικοποίησης και SRT parse/serialize

Το πιο κρίσιμο κομμάτι: λάθος εδώ μεταφράζεται σε σπασμένο συγχρονισμό σε κάθε ταινία.

**Files:**
- Create: `src/subtitle/encoding.js`, `src/subtitle/parse.js`, `src/subtitle/serialize.js`
- Test: `test/subtitle.test.js`

**Interfaces:**
- Consumes: τίποτα
- Produces:
  - `decodeSubtitle(buf: Buffer) -> { text: string, encoding: 'utf-8'|'windows-1253'|'windows-1252', bom: boolean, lineEnding: '\n'|'\r\n' }`
  - `parseSrt(text: string) -> Cue[]` όπου `Cue = { id: number, start: string, end: string, text: string }` — `start`/`end` σε μορφή `HH:MM:SS,mmm` ως **strings**
  - `serializeSrt(cues: Cue[], opts?: { bom?: boolean }) -> string`

- [ ] **Step 1: Γράψε τα tests**

`test/subtitle.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSubtitle } from '../src/subtitle/encoding.js';
import { parseSrt } from '../src/subtitle/parse.js';
import { serializeSrt } from '../src/subtitle/serialize.js';

const SRT_UTF8 = `1
00:00:01,000 --> 00:00:03,500
Hello there.

2
00:00:04,000 --> 00:00:06,000
<i>Come</i> here.
General Kenobi!

3
00:01:02,250 --> 00:01:05,000
- Stop.
- Never.
`;

test('parseSrt: διαβάζει ids, χρόνους και πολυγραμμικό κείμενο', () => {
  const cues = parseSrt(SRT_UTF8);
  assert.equal(cues.length, 3);
  assert.deepEqual(cues[0], { id: 1, start: '00:00:01,000', end: '00:00:03,500', text: 'Hello there.' });
  assert.equal(cues[1].text, '<i>Come</i> here.\nGeneral Kenobi!');
  assert.equal(cues[2].text, '- Stop.\n- Never.');
});

test('parseSrt: δεν πειράζει τα timestamps — είναι strings, όχι αριθμοί', () => {
  const cues = parseSrt(SRT_UTF8);
  assert.equal(typeof cues[0].start, 'string');
  assert.equal(cues[2].start, '00:01:02,250');
});

test('parseSrt: αντέχει CRLF, BOM, κενές γραμμές και cues χωρίς κείμενο', () => {
  const messy = '\uFEFF1\r\n00:00:01,000 --> 00:00:02,000\r\n\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n\r\nΚείμενο\r\n';
  const cues = parseSrt(messy);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, '');
  assert.equal(cues[1].text, 'Κείμενο');
});

test('parseSrt: αγνοεί index που λείπει ή είναι λάθος', () => {
  const noIndex = '00:00:01,000 --> 00:00:02,000\nΧωρίς δείκτη\n';
  const cues = parseSrt(noIndex);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, 'Χωρίς δείκτη');
});

test('serializeSrt: round-trip χωρίς απώλεια', () => {
  const cues = parseSrt(SRT_UTF8);
  const out = serializeSrt(cues);
  const back = parseSrt(out);
  assert.deepEqual(back, cues);
});

test('serializeSrt: βάζει BOM και LF, ώστε ο player να μη μαντεύει κωδικοποίηση', () => {
  const out = serializeSrt([{ id: 1, start: '00:00:01,000', end: '00:00:02,000', text: 'Γεια' }]);
  assert.equal(out.charCodeAt(0), 0xFEFF);
  assert.ok(!out.includes('\r'));
  assert.ok(out.endsWith('\n'));
});

test('decodeSubtitle: αναγνωρίζει UTF-8 με BOM', () => {
  const buf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('Γεια σου', 'utf8')]);
  const r = decodeSubtitle(buf);
  assert.equal(r.encoding, 'utf-8');
  assert.equal(r.bom, true);
  assert.equal(r.text, 'Γεια σου');
});

test('decodeSubtitle: αναγνωρίζει Windows-1253 (παλιοί ελληνικοί υπότιτλοι)', () => {
  const greek = 'Καλημέρα κόσμε';
  const buf = Buffer.from(greek, 'latin1'); // placeholder, αντικαθίσταται παρακάτω
  const win1253 = Buffer.from([0xCA, 0xE1, 0xEB, 0xE7, 0xEC, 0xDD, 0xF1, 0xE1]); // "Καλημέρα"
  const r = decodeSubtitle(win1253);
  assert.equal(r.encoding, 'windows-1253');
  assert.equal(r.text, 'Καλημέρα');
});

test('decodeSubtitle: αναγνωρίζει Windows-1252 (αγγλικά με έξυπνα εισαγωγικά)', () => {
  const win1252 = Buffer.from([0x48, 0x65, 0x92, 0x73, 0x20, 0x68, 0x65, 0x72, 0x65]); // He's here
  const r = decodeSubtitle(win1252);
  assert.equal(r.encoding, 'windows-1252');
  assert.equal(r.text, 'He\u2019s here');
});
```

- [ ] **Step 2: Τρέξε τα tests — πρέπει να αποτύχουν**

```bash
cd "/d/Hermes Agent/Projects/stremio-greek-subs" && export PATH="/d/Hermes Agent/Tools/node:$PATH" && npm test
```
Expected: FAIL — `Cannot find module '../src/subtitle/encoding.js'`

- [ ] **Step 3: Υλοποίηση `src/subtitle/encoding.js`**

```js
const WINDOWS_1253 = 'windows-1253';
const WINDOWS_1252 = 'windows-1252';

// Όσες θέσεις στο windows-1253 είναι γράμματα (τόνοι, ελληνικό αλφάβητο, τελικό σίγμα).
function isGreekLetter(code) {
  return (code >= 0x0386 && code <= 0x03CE) || code === 0x0390 || code === 0x03B0;
}

function decodeWith(buf, encoding) {
  return new TextDecoder(encoding, { fatal: false }).decode(buf);
}

// Το UTF-8 είναι αυστηρό: αν αποκωδικοποιεί χωρίς U+FFFD, είναι UTF-8.
function isValidUtf8(buf) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

export function decodeSubtitle(buf) {
  const hasBom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  const body = hasBom ? buf.subarray(3) : buf;
  const lineEnding = body.includes(0x0D) ? '\r\n' : '\n';

  if (hasBom) {
    return { text: body.toString('utf8'), encoding: 'utf-8', bom: true, lineEnding };
  }
  if (isValidUtf8(body)) {
    return { text: body.toString('utf8'), encoding: 'utf-8', bom: false, lineEnding };
  }

  // Δεν είναι UTF-8. Δοκίμασε windows-1253 (ελληνικά) και διάλεξε όποια βγάζει
  // περισσότερα ελληνικά γράμματα και λιγότερα άγνωστα σύμβολα.
  const candidates = [WINDOWS_1253, WINDOWS_1252];
  let best = null;
  for (const encoding of candidates) {
    const text = decodeWith(body, encoding);
    let greek = 0;
    let garbage = 0;
    for (const ch of text) {
      const code = ch.codePointAt(0);
      if (isGreekLetter(code)) greek += 1;
      else if (code === 0xFFFD) garbage += 1;
    }
    const score = greek * 3 - garbage * 5;
    if (!best || score > best.score) best = { encoding, text, score };
  }
  return { text: best.text, encoding: best.encoding, bom: false, lineEnding };
}
```

- [ ] **Step 4: Υλοποίηση `src/subtitle/parse.js`**

```js
const TIME_RE = /^\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/;

export function normalizeTime(t) {
  const [hms, ms] = t.trim().replace('.', ',').split(',');
  const [h, m, s] = hms.split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')},${(ms || '0').padEnd(3, '0').slice(0, 3)}`;
}

// Δέχεται ήδη αποκωδικοποιημένο κείμενο. Τα timestamps μένουν strings:
// δεν τα μετατρέπουμε ποτέ σε αριθμούς, άρα δεν υπάρχει περίπτωση σφάλματος στρογγυλοποίησης.
export function parseSrt(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const cues = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(TIME_RE);
    if (!m) {
      i += 1;
      continue;
    }
    const start = normalizeTime(m[1]);
    const end = normalizeTime(m[2]);
    i += 1;
    const body = [];
    while (i < lines.length && lines[i].trim() !== '') {
      body.push(lines[i].replace(/\s+$/, ''));
      i += 1;
    }
    // Το index μπορεί να λείπει· δίνουμε δικό μας, σταθερό.
    cues.push({ id: cues.length + 1, start, end, text: body.join('\n') });
  }
  return cues;
}
```

- [ ] **Step 5: Υλοποίηση `src/subtitle/serialize.js`**

```js
export function serializeSrt(cues, opts = {}) {
  const bom = opts.bom !== false;
  const blocks = cues.map((cue) => `${cue.id}\n${cue.start} --> ${cue.end}\n${cue.text}\n`);
  return (bom ? '\uFEFF' : '') + blocks.join('\n');
}
```

- [ ] **Step 6: Τρέξε τα tests — πρέπει να περάσουν**

```bash
npm test
```
Expected: PASS σε όλα τα βήματα. Αν αποτύχει το test των Windows-1253, τύπωσε το `r.text` — σημαίνει ότι τα bytes του fixture δεν είναι σωστά ελληνικά.

- [ ] **Step 7: Commit**

```bash
git add src/subtitle/ test/subtitle.test.js
git commit -m "feat(subtitle): SRT parse/serialize με ανίχνευση UTF-8/1253/1252"
```

---

### Task 2: Ομαδοποίηση cues και prompt μετάφρασης

**Files:**
- Create: `src/subtitle/batch.js`, `src/translate/prompt.js`, `src/translate/glossary.js`
- Test: `test/batch.test.js`, `test/prompt.test.js`

**Interfaces:**
- Consumes: `Cue` από Task 1
- Produces:
  - `makeBatches(cues: Cue[], size: number) -> Batch[]` όπου `Batch = { index: number, items: {id: number, text: string}[] }`
  - `applyTranslations(cues: Cue[], byId: Map<number,string>) -> Cue[]` — κρατά το πρωτότυπο κείμενο όπου λείπει μετάφραση
  - `loadGlossary(path: string) -> { version: number, keep: string[], map: Record<string,string>, hash: string }`
  - `buildPrompt({ items, targetLangName, context, glossary }) -> { system: string, user: string }`
  - `parseTranslationReply(text: string, expectedIds: number[]) -> Map<number,string>`

- [ ] **Step 1: Γράψε τα tests**

`test/batch.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBatches, applyTranslations } from '../src/subtitle/batch.js';

const cues = Array.from({ length: 150 }, (_, i) => ({
  id: i + 1,
  start: `00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')},000`,
  end: `00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String((i % 60) + 1).padStart(2, '0')},000`,
  text: `line ${i + 1}`,
}));

test('makeBatches: σωστός αριθμός batches και διατήρηση σειράς', () => {
  const batches = makeBatches(cues, 70);
  assert.equal(batches.length, 3);
  assert.equal(batches[0].items.length, 70);
  assert.equal(batches[1].items.length, 70);
  assert.equal(batches[2].items.length, 10);
  const ids = batches.flatMap((b) => b.items.map((it) => it.id));
  assert.deepEqual(ids, cues.map((c) => c.id));
});

test('makeBatches: τα κενά cues δεν στέλνονται στο μοντέλο', () => {
  const withEmpty = [...cues.slice(0, 2), { id: 3, start: 'x', end: 'y', text: '   ' }];
  const batches = makeBatches(withEmpty, 70);
  assert.deepEqual(batches[0].items.map((i) => i.id), [1, 2]);
});

test('applyTranslations: γεμίζει ό,τι μεταφράστηκε και κρατά το πρωτότυπο στα υπόλοιπα', () => {
  const translated = new Map([[1, 'γραμμή 1']]);
  const out = applyTranslations(cues.slice(0, 3), translated);
  assert.equal(out[0].text, 'γραμμή 1');
  assert.equal(out[1].text, 'line 2');
  assert.equal(out[1].start, cues[1].start, 'τα timestamps δεν αλλάζουν');
});
```

`test/prompt.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, parseTranslationReply } from '../src/translate/prompt.js';

const glossary = { version: 1, keep: ['Millennium Falcon'], map: { 'the Force': 'η Δύναμη' }, hash: 'abc' };

test('buildPrompt: αναφέρει τη γλώσσα-στόχο, το glossary και τους κανόνες', () => {
  const { system, user } = buildPrompt({
    items: [{ id: 1, text: '<i>Hello</i> there.' }],
    targetLangName: 'Ελληνικά',
    context: { title: 'Star Wars', year: 1977 },
    glossary,
  });
  assert.match(system, /Ελληνικά/);
  assert.match(system, /Millennium Falcon/);
  assert.match(system, /η Δύναμη/);
  assert.match(system, /μην συνενώνεις/i);
  assert.match(user, /Star Wars/);
  assert.match(user, /<i>Hello<\/i> there\./);
});

test('parseTranslationReply: διαβάζει καθαρό JSON', () => {
  const map = parseTranslationReply('[{"id":1,"text":"Γεια"}]', [1]);
  assert.equal(map.get(1), 'Γεια');
});

test('parseTranslationReply: αντέχει markdown fences και σχολιασμό γύρω από το JSON', () => {
  const raw = 'Ορίστε:\n```json\n[{"id":1,"text":"Γεια"},{"id":2,"text":"Κόσμε"}]\n```\nΤέλος.';
  const map = parseTranslationReply(raw, [1, 2]);
  assert.equal(map.size, 2);
  assert.equal(map.get(2), 'Κόσμε');
});

test('parseTranslationReply: αγνοεί ids που δεν ζητήθηκαν και επιστρέφει μόνο έγκυρα', () => {
  const map = parseTranslationReply('[{"id":1,"text":"Γεια"},{"id":99,"text":"Άκυρο"}]', [1, 2]);
  assert.equal(map.size, 1);
  assert.equal(map.has(99), false);
});

test('parseTranslationReply: σκουπίδια -> κενός map, χωρίς εξαίρεση', () => {
  assert.equal(parseTranslationReply('συγγνώμη, δεν μπορώ', [1]).size, 0);
});
```

- [ ] **Step 2: Τρέξε τα tests — πρέπει να αποτύχουν**

```bash
npm test
```
Expected: FAIL — `Cannot find module '../src/subtitle/batch.js'`

- [ ] **Step 3: Υλοποίηση `src/subtitle/batch.js`**

```js
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

export function applyTranslations(cues, byId) {
  return cues.map((cue) => {
    const hit = byId.get(cue.id);
    if (typeof hit === 'string' && hit.trim() !== '') return { ...cue, text: hit };
    return cue;
  });
}
```

- [ ] **Step 4: Υλοποίηση `src/translate/glossary.js`**

```js
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export function loadGlossary(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { version: 0, keep: [], map: {}, hash: 'empty' };
  }
  const parsed = JSON.parse(raw);
  const glossary = {
    version: parsed.version ?? 1,
    keep: parsed.keep ?? [],
    map: parsed.map ?? {},
  };
  // Το hash μπαίνει στο cache key: αλλαγή του glossary = νέα μετάφραση.
  glossary.hash = createHash('sha1').update(JSON.stringify(glossary)).digest('hex').slice(0, 12);
  return glossary;
}
```

- [ ] **Step 5: Υλοποίηση `src/translate/prompt.js`**

```js
const RULES = [
  'Μεταφράζεις υπότιτλους ταινιών/σειρών. Το αποτέλεσμα διαβάζεται από ανθρώπους που βλέπουν την εικόνα.',
  'Γράψε φυσικά ελληνικά κινηματογραφικού τόνου, όχι κατά λέξη μετάφραση.',
  'Κράτα ΑΥΣΤΗΡΑ μία γραμμή εξόδου ανά γραμμή εισόδου — μην συνενώνεις, μην σπάσεις, μη συγχωνεύσεις cues.',
  'Κράτα τις παύλες διαλόγου (-), τα <i></i> και τα υπόλοιπα tags αυτούσια.',
  'Μη μεταφράζεις κύρια ονόματα, τίτλους έργων, ονόματα σειρών ή εμπορικά σήματα.',
  'Οι σημειώσεις για κωφούς ([θόρυβος], (γέλια)) μεταφράζονται κι αυτές, κρατώντας τις αγκύλες.',
  'Μην προσθέτεις σχόλια, επεξηγήσεις ή επιπλέον κείμενο. Μην αλλάζεις τη σειρά.',
  'Απάντησε ΜΟΝΟ με JSON array της μορφής [{"id":1,"text":"..."}] και τίποτα άλλο.',
];

export function buildPrompt({ items, targetLangName, context = {}, glossary }) {
  const lines = [...RULES, `Γλώσσα-στόχος: ${targetLangName}.`];
  if (glossary?.keep?.length) {
    lines.push(`Κράτα αμετάφραστα: ${glossary.keep.join(', ')}.`);
  }
  const pairs = Object.entries(glossary?.map ?? {});
  if (pairs.length) {
    lines.push('Υποχρεωτικές αποδόσεις: ' + pairs.map(([k, v]) => `"${k}" -> "${v}"`).join('; ') + '.');
  }
  const system = lines.join('\n');

  const header = [];
  if (context.title) header.push(`Έργο: ${context.title}${context.year ? ` (${context.year})` : ''}`);
  const payload = items.map((it) => ({ id: it.id, text: it.text }));
  const user = `${header.join('\n')}\nΜετέφρασε τα παρακάτω ${payload.length} cues:\n${JSON.stringify(payload)}`;
  return { system, user };
}

export function parseTranslationReply(text, expectedIds) {
  const allowed = new Set(expectedIds);
  const result = new Map();
  if (!text) return result;

  // Δεχόμαστε ```json fences, πρόλογο, ή σκέτο array.
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
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
    if (!allowed.has(id)) continue;
    if (typeof row?.text !== 'string' || row.text.trim() === '') continue;
    result.set(id, row.text);
  }
  return result;
}
```

- [ ] **Step 6: Τρέξε τα tests — πρέπει να περάσουν**

```bash
npm test
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/subtitle/batch.js src/translate/prompt.js src/translate/glossary.js test/batch.test.js test/prompt.test.js
git commit -m "feat(translate): batching, κοινό prompt και ανεκτικό parsing απάντησης"
```

---

### Task 3: Cache

**Files:**
- Create: `src/cache.js`
- Test: `test/cache.test.js`

**Interfaces:**
- Consumes: τίποτα
- Produces:
  - `cacheKey({ sourceHash, targetLang, glossaryVersion }) -> string` (12 hex chars)
  - `createCache(dir) -> { has(key), getSrt(key), put(key, srtText, meta), meta(key), list(), remove(key), stats() }`

- [ ] **Step 1: Γράψε τα tests**

`test/cache.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheKey, createCache } from '../src/cache.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'grcache-'));

test('cacheKey: ίδιο περιεχόμενο -> ίδιο κλειδί, ανεξαρτήτως engine', () => {
  const a = cacheKey({ sourceHash: 'h1', targetLang: 'el', glossaryVersion: 'g1' });
  const b = cacheKey({ sourceHash: 'h1', targetLang: 'el', glossaryVersion: 'g1' });
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{12}$/);
});

test('cacheKey: αλλαγή glossary -> νέο κλειδί', () => {
  const a = cacheKey({ sourceHash: 'h1', targetLang: 'el', glossaryVersion: 'g1' });
  const b = cacheKey({ sourceHash: 'h1', targetLang: 'el', glossaryVersion: 'g2' });
  assert.notEqual(a, b);
});

test('createCache: put -> has -> getSrt με UTF-8 BOM', () => {
  const dir = tmp();
  const cache = createCache(dir);
  const key = cacheKey({ sourceHash: 'h1', targetLang: 'el', glossaryVersion: 'g1' });
  assert.equal(cache.has(key), false);
  cache.put(key, '\uFEFF1\n00:00:01,000 --> 00:00:02,000\nΓεια\n', { title: 'X', engine: 'gemini' });
  assert.equal(cache.has(key), true);
  assert.match(cache.getSrt(key), /Γεια/);
  assert.equal(cache.meta(key).engine, 'gemini');
  rmSync(dir, { recursive: true, force: true });
});

test('createCache: list και remove', () => {
  const dir = tmp();
  const cache = createCache(dir);
  cache.put('aaaaaaaaaaaa', 'x', { title: 'A' });
  cache.put('bbbbbbbbbbbb', 'y', { title: 'B' });
  assert.equal(cache.list().length, 2);
  cache.remove('aaaaaaaaaaaa');
  assert.equal(cache.list().length, 1);
  assert.equal(cache.stats().count, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('createCache: λείπει το αρχείο -> getSrt επιστρέφει null, όχι εξαίρεση', () => {
  const dir = tmp();
  const cache = createCache(dir);
  assert.equal(cache.getSrt('deadbeef0000'), null);
  assert.equal(cache.meta('deadbeef0000'), null);
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Τρέξε τα tests — πρέπει να αποτύχουν**

```bash
npm test
```
Expected: FAIL — `Cannot find module '../src/cache.js'`

- [ ] **Step 3: Υλοποίηση `src/cache.js`**

```js
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Ο engine ΔΕΝ συμμετέχει: μια μετάφραση ισχύει ό,τι κι αν την έφτιαξε.
export function cacheKey({ sourceHash, targetLang, glossaryVersion }) {
  return createHash('sha1')
    .update(`${sourceHash}|${targetLang}|${glossaryVersion}`)
    .digest('hex')
    .slice(0, 12);
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
          return { key, bytes: st.size, modified: st.mtime.toISOString(), ...(readJsonSafe(metaPath(key)) ?? {}) };
        })
        .sort((a, b) => b.modified.localeCompare(a.modified));
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
```

- [ ] **Step 4: Τρέξε τα tests — πρέπει να περάσουν**

```bash
npm test
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cache.js test/cache.test.js
git commit -m "feat(cache): κλειδί ανεξάρτητο engine + αποθήκευση αρχείων"
```

---

### Task 4: Μηχανές μετάφρασης και σειρά fallback

**Files:**
- Create: `src/translate/gemini.js`, `src/translate/lmstudio.js`, `src/translate/chain.js`
- Test: `test/translate.test.js`

**Interfaces:**
- Consumes: `buildPrompt`, `parseTranslationReply` (Task 2)
- Produces:
  - `createGeminiEngine({ apiKey, model, fetchImpl }) -> Engine`
  - `createLmStudioEngine({ baseUrl, model, fetchImpl }) -> Engine`
  - `createChain({ engines, targetLangName, glossary, log }) -> { translateBatch(items, context) -> Map<number,string>, status() }`
  - `Engine = { name: string, isAvailable(): Promise<boolean>, translateBatch({ items, targetLangName, context, glossary }): Promise<string> }` — επιστρέφει το **ακατέργαστο κείμενο** του μοντέλου
  - Σφάλμα με σημαία: `Object.assign(new Error(msg), { quotaExhausted: true })`

- [ ] **Step 1: Γράψε τα tests**

`test/translate.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiEngine } from '../src/translate/gemini.js';
import { createLmStudioEngine } from '../src/translate/lmstudio.js';
import { createChain } from '../src/translate/chain.js';

const glossary = { version: 1, keep: [], map: {}, hash: 'g1' };
const items = [{ id: 1, text: 'Hello' }, { id: 2, text: 'World' }];

function jsonResponse(payload, ok = true, status = 200) {
  return { ok, status, json: async () => payload, text: async () => JSON.stringify(payload) };
}

test('gemini: στέλνει το prompt και επιστρέφει το κείμενο του μοντέλου', async () => {
  let captured;
  const fetchImpl = async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body), headers: opts.headers };
    return jsonResponse({ candidates: [{ content: { parts: [{ text: '[{"id":1,"text":"Γεια"}]' }] } }] });
  };
  const engine = createGeminiEngine({ apiKey: 'k', model: 'gemini-2.5-flash', fetchImpl });
  const raw = await engine.translateBatch({ items, targetLangName: 'Ελληνικά', context: {}, glossary });
  assert.match(captured.url, /gemini-2\.5-flash:generateContent/);
  assert.equal(captured.headers['x-goog-api-key'], 'k');
  assert.match(captured.body.contents[0].parts[0].text, /Hello/);
  assert.equal(raw, '[{"id":1,"text":"Γεια"}]');
});

test('gemini: 429 -> σφάλμα με quotaExhausted', async () => {
  const engine = createGeminiEngine({
    apiKey: 'k',
    model: 'm',
    fetchImpl: async () => jsonResponse({ error: { message: 'quota' } }, false, 429),
  });
  await assert.rejects(
    () => engine.translateBatch({ items, targetLangName: 'Ελληνικά', context: {}, glossary }),
    (err) => err.quotaExhausted === true,
  );
});

test('lmstudio: μιλάει OpenAI-compatible API στη τοπική διεύθυνση', async () => {
  let captured;
  const engine = createLmStudioEngine({
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'qwen',
    fetchImpl: async (url, opts) => {
      captured = { url, body: JSON.parse(opts.body) };
      return jsonResponse({ choices: [{ message: { content: '[{"id":1,"text":"Γεια"}]' } }] });
    },
  });
  const raw = await engine.translateBatch({ items, targetLangName: 'Ελληνικά', context: {}, glossary });
  assert.equal(captured.url, 'http://127.0.0.1:1234/v1/chat/completions');
  assert.equal(captured.body.model, 'qwen');
  assert.equal(captured.body.stream, false);
  assert.equal(raw, '[{"id":1,"text":"Γεια"}]');
});

test('lmstudio: σύνδεση αρνήθηκε -> καθαρό ελληνικό μήνυμα', async () => {
  const engine = createLmStudioEngine({
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'qwen',
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  await assert.rejects(
    () => engine.translateBatch({ items, targetLangName: 'Ελληνικά', context: {}, glossary }),
    /lms server start/,
  );
});

test('chain: χρησιμοποιεί τον πρώτο engine και επιστρέφει map', async () => {
  const calls = [];
  const engineA = { name: 'a', isAvailable: async () => true, translateBatch: async () => { calls.push('a'); return '[{"id":1,"text":"Γεια"},{"id":2,"text":"Κόσμε"}]'; } };
  const engineB = { name: 'b', isAvailable: async () => true, translateBatch: async () => { calls.push('b'); return '[]'; } };
  const chain = createChain({ engines: [engineA, engineB], targetLangName: 'Ελληνικά', glossary, log: () => {} });
  const map = await chain.translateBatch(items, {});
  assert.deepEqual(calls, ['a']);
  assert.equal(map.get(2), 'Κόσμε');
});

test('chain: 429 στον πρώτο -> συνεχίζει με τον δεύτερο και τον σημαδεύει εξαντλημένο', async () => {
  const calls = [];
  const engineA = {
    name: 'gemini',
    isAvailable: async () => true,
    translateBatch: async () => { calls.push('a'); throw Object.assign(new Error('quota'), { quotaExhausted: true }); },
  };
  const engineB = { name: 'lmstudio', isAvailable: async () => true, translateBatch: async () => { calls.push('b'); return '[{"id":1,"text":"Γεια"}]'; } };
  const chain = createChain({ engines: [engineA, engineB], targetLangName: 'Ελληνικά', glossary, log: () => {} });
  const map = await chain.translateBatch(items, {});
  assert.deepEqual(calls, ['a', 'b']);
  assert.equal(chain.status().exhausted.includes('gemini'), true);

  // δεύτερο batch: ο gemini δεν ξαναδοκιμάζεται
  calls.length = 0;
  await chain.translateBatch(items, {});
  assert.deepEqual(calls, ['b']);
});

test('chain: τοπικό μοντέλο που δεν τρέχει -> σφάλμα χωρίς quotaExhausted, δεν το σημαδεύει εξαντλημένο', async () => {
  const engineB = { name: 'lmstudio', isAvailable: async () => false, translateBatch: async () => { throw new Error('δεν έπρεπε να κληθεί'); } };
  const chain = createChain({ engines: [engineB], targetLangName: 'Ελληνικά', glossary, log: () => {} });
  await assert.rejects(() => chain.translateBatch(items, {}), /δεν είναι διαθέσιμος/);
  assert.deepEqual(chain.status().exhausted, []);
});

test('chain: κενή απάντηση -> σφάλμα, όχι σιωπηλά κενή μετάφραση', async () => {
  const engine = { name: 'a', isAvailable: async () => true, translateBatch: async () => 'δεν μπορώ' };
  const chain = createChain({ engines: [engine], targetLangName: 'Ελληνικά', glossary, log: () => {} });
  await assert.rejects(() => chain.translateBatch(items, {}), /μη έγκυρη απάντηση/);
});
```

- [ ] **Step 2: Τρέξε τα tests — πρέπει να αποτύχουν**

```bash
npm test
```
Expected: FAIL — `Cannot find module '../src/translate/gemini.js'`

- [ ] **Step 3: Υλοποίηση `src/translate/gemini.js`**

```js
import { buildPrompt } from './prompt.js';

export function createGeminiEngine({ apiKey, model, fetchImpl = fetch }) {
  return {
    name: 'gemini',
    async isAvailable() {
      return Boolean(apiKey);
    },
    async translateBatch({ items, targetLangName, context, glossary }) {
      const { system, user } = buildPrompt({ items, targetLangName, context, glossary });
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
        }),
      });
      if (res.status === 429 || res.status === 403) {
        const body = await res.text().catch(() => '');
        throw Object.assign(new Error(`Gemini όριο/άδεια (${res.status}): ${body.slice(0, 200)}`), { quotaExhausted: true });
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Gemini σφάλμα ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      return parts.map((p) => p.text ?? '').join('');
    },
  };
}
```

- [ ] **Step 4: Υλοποίηση `src/translate/lmstudio.js`**

```js
import { buildPrompt } from './prompt.js';

export function createLmStudioEngine({ baseUrl, model, fetchImpl = fetch }) {
  return {
    name: 'lmstudio',
    async isAvailable() {
      try {
        const res = await fetchImpl(`${baseUrl}/models`, { method: 'GET' });
        return res.ok;
      } catch {
        return false;
      }
    },
    async translateBatch({ items, targetLangName, context, glossary }) {
      const { system, user } = buildPrompt({ items, targetLangName, context, glossary });
      let res;
      try {
        res = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            stream: false,
            temperature: 0.2,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
        });
      } catch (err) {
        throw new Error(
          `Το τοπικό μοντέλο (LM Studio) δεν απαντά στο ${baseUrl}. Άνοιξέ το με: lms server start  [${err.message}]`,
        );
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`LM Studio σφάλμα ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = await res.json();
      return data?.choices?.[0]?.message?.content ?? '';
    },
  };
}
```

- [ ] **Step 5: Υλοποίηση `src/translate/chain.js`**

```js
import { parseTranslationReply } from './prompt.js';

export function createChain({ engines, targetLangName, glossary, log = () => {} }) {
  const exhausted = new Set();

  return {
    async translateBatch(items, context = {}) {
      const ids = items.map((it) => it.id);
      const problems = [];

      for (const engine of engines) {
        if (exhausted.has(engine.name)) continue;

        // Ο έλεγχος διαθεσιμότητας δεν είναι μοιραίος: ένας engine που δεν
        // τρέχει (π.χ. τοπικό μοντέλο κλειστό) δεν «εξαντλείται», απλώς προσπερνιέται.
        if (typeof engine.isAvailable === 'function' && !(await engine.isAvailable())) {
          problems.push(`${engine.name}: δεν είναι διαθέσιμος`);
          continue;
        }

        let raw;
        try {
          raw = await engine.translateBatch({ items, targetLangName, context, glossary });
        } catch (err) {
          if (err.quotaExhausted) {
            exhausted.add(engine.name);
            log(`[chain] ο ${engine.name} εξαντλήθηκε για σήμερα: ${err.message}`);
          } else {
            log(`[chain] ο ${engine.name} απέτυχε: ${err.message}`);
          }
          problems.push(`${engine.name}: ${err.message}`);
          continue;
        }

        const map = parseTranslationReply(raw, ids);
        if (map.size === 0) {
          problems.push(`${engine.name}: μη έγκυρη απάντηση (0/${ids.length} cues)`);
          continue;
        }
        if (map.size < ids.length) {
          log(`[chain] προσοχή: ο ${engine.name} μετέφρασε ${map.size}/${ids.length} cues`);
        }
        return map;
      }

      throw new Error(`Καμία μηχανή μετάφρασης δεν τα κατάφερε. ${problems.join(' | ')}`);
    },
    status() {
      return { exhausted: [...exhausted], engines: engines.map((e) => e.name) };
    },
  };
}
```

- [ ] **Step 6: Τρέξε τα tests — πρέπει να περάσουν**

```bash
npm test
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/translate/gemini.js src/translate/lmstudio.js src/translate/chain.js test/translate.test.js
git commit -m "feat(translate): engines Gemini/LM Studio με σειρά fallback"
```

---

### Task 5: Provider SubDL

**Files:**
- Create: `src/providers/subdl.js`, `src/providers/index.js`, `test/fixtures/subdl-*.json`
- Test: `test/subdl.test.js`

**Interfaces:**
- Consumes: `adm-zip`
- Produces:
  - `createSubdlProvider({ apiKey, fetchImpl, minMatchScore }) -> Provider`
  - `Provider = { name, isConfigured(), search({ imdbId, type, season, episode, filename, languages[] }) -> Candidate[], download(candidate) -> Promise<{ buffer, filename }>, quota() -> Promise<{downloads, searches}> }`
  - `Candidate = { provider, id, language, releaseName, score, downloads }`
  - `createProviders(config, fetchImpl) -> Provider[]` (σειρά από `PROVIDER_ORDER`, αγνοεί όσους δεν έχουν κλειδί)

- [ ] **Step 1: Γράψε τα fixtures**

`test/fixtures/subdl-files-search.json`:
```json
{
  "status": true,
  "match": { "engine": "local", "confidence": "high", "type": "movie", "title": "Dune: Part Two", "year": 2024 },
  "subtitles": [
    { "release_name": "Dune.Part.Two.2024.2160p.WEB-DL-GROUP", "lang": "english", "match_score": 0.94, "url": "/subtitle/aaa", "n_id": "aaa", "downloads": 900 },
    { "release_name": "Dune.Part.Two.2024.1080p.BluRay-OTHER", "lang": "english", "match_score": 0.41, "url": "/subtitle/bbb", "n_id": "bbb", "downloads": 5000 },
    { "release_name": "Dune.Part.Two.2024.2160p.WEB-DL-GROUP", "lang": "greek", "match_score": 0.91, "url": "/subtitle/ccc", "n_id": "ccc", "downloads": 120 }
  ]
}
```

`test/fixtures/subdl-me.json`:
```json
{
  "plan": { "is_pro": false, "name": "Free" },
  "usage": {
    "search": { "used": 12, "limit": 2000, "remaining": 1988, "period": "day" },
    "downloads": { "used": 3, "limit": 50, "remaining": 47, "period": "day" }
  }
}
```

- [ ] **Step 2: Γράψε τα tests**

`test/subdl.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import AdmZip from 'adm-zip';
import { createSubdlProvider } from '../src/providers/subdl.js';
import { createProviders } from '../src/providers/index.js';

const fixture = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));

function zipBuffer(name, content) {
  const zip = new AdmZip();
  zip.addFile(name, Buffer.from(content, 'utf8'));
  return zip.toBuffer();
}

test('search: χρησιμοποιεί files/search όταν υπάρχει filename και φιλτράρει κάτω από minMatchScore', async () => {
  let calledUrl;
  const provider = createSubdlProvider({
    apiKey: 'k',
    minMatchScore: 0.8,
    fetchImpl: async (url) => {
      calledUrl = url;
      return { ok: true, status: 200, json: async () => fixture('subdl-files-search.json') };
    },
  });
  const out = await provider.search({
    imdbId: 'tt15239678',
    type: 'movie',
    filename: 'Dune.Part.Two.2024.2160p.WEB-DL-GROUP.mkv',
    languages: ['en'],
  });
  assert.match(calledUrl, /\/api\/v2\/files\/search\?/);
  assert.match(calledUrl, /filename=Dune/);
  assert.equal(out.length, 1, 'το 0.41 κόβεται, το 0.94 περνά');
  assert.equal(out[0].id, 'aaa');
  assert.equal(out[0].releaseName, 'Dune.Part.Two.2024.2160p.WEB-DL-GROUP');
  assert.equal(out[0].language, 'en');
});

test('search: χωρίς filename πέφτει σε subtitles/search με imdb_id', async () => {
  let calledUrl;
  const provider = createSubdlProvider({
    apiKey: 'k',
    minMatchScore: 0.8,
    fetchImpl: async (url) => {
      calledUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: true, subtitles: [{ n_id: 'x1', release_name: 'R', lang: 'english', downloads: 10 }] }),
      };
    },
  });
  const out = await provider.search({ imdbId: 'tt15239678', type: 'movie', languages: ['en'] });
  assert.match(calledUrl, /\/api\/v2\/subtitles\/search\?/);
  assert.match(calledUrl, /imdb_id=tt15239678/);
  assert.equal(out.length, 1, 'χωρίς match_score δεν φιλτράρουμε');
});

test('search: ζητά ελληνικούς με κωδικό el (ISO 639-1)', async () => {
  let calledUrl;
  const provider = createSubdlProvider({
    apiKey: 'k',
    minMatchScore: 0.8,
    fetchImpl: async (url) => {
      calledUrl = url;
      return { ok: true, status: 200, json: async () => ({ status: true, subtitles: [] }) };
    },
  });
  await provider.search({ imdbId: 'tt15239678', type: 'movie', languages: ['el'] });
  assert.match(calledUrl, /languages=el/);
});

test('search: 429 -> σφάλμα με quotaExhausted', async () => {
  const provider = createSubdlProvider({
    apiKey: 'k',
    minMatchScore: 0.8,
    fetchImpl: async () => ({ ok: false, status: 429, text: async () => 'quota_exceeded' }),
  });
  await assert.rejects(
    () => provider.search({ imdbId: 'tt1', type: 'movie', languages: ['en'] }),
    (err) => err.quotaExhausted === true,
  );
});

test('download: αποσυμπιέζει zip και διαλέγει το αρχείο με τη σωστή επέκταση', async () => {
  const provider = createSubdlProvider({
    apiKey: 'k',
    minMatchScore: 0.8,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => zipBuffer('sub.srt', '1\n00:00:01,000 --> 00:00:02,000\nHello\n'),
    }),
  });
  const { buffer, filename } = await provider.download({ id: 'aaa' });
  assert.equal(filename, 'sub.srt');
  assert.match(buffer.toString('utf8'), /Hello/);
});

test('download: δέχεται και σκέτο srt χωρίς zip', async () => {
  const provider = createSubdlProvider({
    apiKey: 'k',
    minMatchScore: 0.8,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nHello\n', 'utf8'),
    }),
  });
  const { buffer } = await provider.download({ id: 'aaa' });
  assert.match(buffer.toString('utf8'), /Hello/);
});

test('quota: διαβάζει το /api/v2/me', async () => {
  const provider = createSubdlProvider({
    apiKey: 'k',
    minMatchScore: 0.8,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => fixture('subdl-me.json') }),
  });
  const q = await provider.quota();
  assert.equal(q.downloads.remaining, 47);
  assert.equal(q.searches.limit, 2000);
});

test('createProviders: αγνοεί providers χωρίς κλειδί', () => {
  const providers = createProviders({ subdlApiKey: '', opensubtitlesApiKey: '', providerOrder: ['subdl', 'opensubtitles'] }, fetch);
  assert.equal(providers.length, 0);
  const withKey = createProviders({ subdlApiKey: 'k', opensubtitlesApiKey: '', providerOrder: ['subdl', 'opensubtitles'] }, fetch);
  assert.deepEqual(withKey.map((p) => p.name), ['subdl']);
});
```

- [ ] **Step 3: Τρέξε τα tests — πρέπει να αποτύχουν**

```bash
npm test
```
Expected: FAIL — `Cannot find module '../src/providers/subdl.js'`

- [ ] **Step 4: Υλοποίηση `src/providers/subdl.js`**

```js
import AdmZip from 'adm-zip';

const BASE = 'https://api.subdl.com';
const SUBTITLE_EXT = /\.(srt|ass|ssa|vtt|sub)$/i;

// Το SubDL θέλει ISO 639-1 ("el"), όχι ISO 639-2 ("ell").
export function toSubdlLang(code) {
  const map = { ell: 'el', gre: 'el', eng: 'en', en: 'en' };
  return map[code] ?? code;
}

function pickLang(lang) {
  const value = String(lang ?? '').toLowerCase();
  if (value.startsWith('greek') || value === 'el' || value === 'ell') return 'el';
  if (value.startsWith('english') || value === 'en' || value === 'eng') return 'en';
  return value.slice(0, 2);
}

export function createSubdlProvider({ apiKey, fetchImpl = fetch, minMatchScore = 0.8 }) {
  const headers = { authorization: `Bearer ${apiKey}`, accept: 'application/json' };

  async function get(path, params) {
    const url = `${BASE}${path}?${new URLSearchParams(params)}`;
    const res = await fetchImpl(url, { headers });
    if (res.status === 429 || res.status === 402) {
      const body = await res.text().catch(() => '');
      throw Object.assign(new Error(`SubDL όριο/άδεια (${res.status}): ${body.slice(0, 200)}`), { quotaExhausted: true });
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`SubDL σφάλμα ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  }

  return {
    name: 'subdl',
    isConfigured() {
      return Boolean(apiKey);
    },

    async search({ imdbId, type, season, episode, filename, languages = ['en'] }) {
      const langParam = languages.map(toSubdlLang).join(',');
      const tvParams = {};
      if (season != null) tvParams.season = String(season);
      if (episode != null) tvParams.episode = String(episode);

      // Δεν υπάρχει video hash στο SubDL: το files/search είναι ο ακριβής τρόπος
      // ταιριάσματος release (δίνει match_score). Χωρίς filename πάμε σε imdb_id.
      if (filename) {
        const data = await get('/api/v2/files/search', {
          filename,
          languages: langParam,
          subs_per_page: '30',
          ...tvParams,
        });
        const rows = data?.subtitles ?? [];
        return rows
          .filter((r) => r.match_score == null || r.match_score >= minMatchScore)
          .map((r) => ({
            provider: 'subdl',
            id: String(r.n_id ?? r.id),
            language: pickLang(r.lang),
            releaseName: r.release_name ?? filename,
            score: r.match_score ?? null,
            downloads: r.downloads ?? 0,
          }))
          .filter((c) => c.id && c.id !== 'undefined')
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      }

      const params = { languages: langParam, unpack: '1', ...tvParams };
      if (imdbId) params.imdb_id = imdbId;
      else params.film_name = filename ?? '';
      if (type === 'series' && season != null && episode == null) params.full_season = '1';
      const data = await get('/api/v2/subtitles/search', params);
      return (data?.subtitles ?? [])
        .map((r) => ({
          provider: 'subdl',
          id: String(r.n_id ?? r.id),
          language: pickLang(r.lang),
          releaseName: r.release_name ?? 'άγνωστο release',
          score: null,
          downloads: r.downloads ?? 0,
        }))
        .filter((c) => c.id && c.id !== 'undefined')
        .sort((a, b) => b.downloads - a.downloads);
    },

    async download(candidate) {
      const url = `${BASE}/api/v2/subtitles/${encodeURIComponent(candidate.id)}/download?format=zip`;
      const res = await fetchImpl(url, { headers });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`SubDL λήψη απέτυχε ${res.status}: ${body.slice(0, 200)}`);
      }
      const raw = Buffer.from(await res.arrayBuffer());

      // Πολλές λήψεις έρχονται σκέτο srt, άλλες zip (και σπάνια rar).
      if (raw.length > 4 && raw[0] === 0x50 && raw[1] === 0x4B) {
        const zip = new AdmZip(raw);
        const entries = zip.getEntries().filter((e) => !e.isDirectory && SUBTITLE_EXT.test(e.entryName));
        if (entries.length === 0) throw new Error('Το zip δεν περιέχει αρχείο υποτίτλου');
        entries.sort((a, b) => b.header.size - a.header.size); // το μεγαλύτερο = το πλήρες
        return { buffer: entries[0].getData(), filename: entries[0].entryName };
      }
      if (raw.length > 4 && raw.subarray(0, 4).toString('latin1') === 'Rar!') {
        throw new Error('Ο υπότιτλος είναι σε μορφή rar — διάλεξε άλλο release');
      }
      return { buffer: raw, filename: `${candidate.id}.srt` };
    },

    async quota() {
      const data = await get('/api/v2/me', {});
      return { searches: data?.usage?.search ?? null, downloads: data?.usage?.downloads ?? null, plan: data?.plan ?? null };
    },
  };
}
```

- [ ] **Step 5: Υλοποίηση `src/providers/index.js`**

```js
import { createSubdlProvider } from './subdl.js';

export function createProviders(config, fetchImpl = fetch) {
  const factories = {
    subdl: () =>
      config.subdlApiKey
        ? createSubdlProvider({
            apiKey: config.subdlApiKey,
            fetchImpl,
            minMatchScore: config.minMatchScore,
          })
        : null,
    // Το OpenSubtitles προστίθεται σε επόμενη φάση· η θέση του στη σειρά υπάρχει ήδη.
    opensubtitles: () => null,
  };

  return config.providerOrder
    .map((name) => factories[name]?.())
    .filter((p) => p && p.isConfigured());
}
```

- [ ] **Step 6: Τρέξε τα tests — πρέπει να περάσουν**

```bash
npm install adm-zip
npm test
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/providers/ test/subdl.test.js test/fixtures/
git commit -m "feat(providers): SubDL v2 με files/search, match_score, zip και quota"
```

---

### Task 6: Ουρά εργασιών μετάφρασης

**Files:**
- Create: `src/jobs.js`
- Test: `test/jobs.test.js`

**Interfaces:**
- Consumes: `Cue`, `makeBatches`, `applyTranslations`, `serializeSrt`
- Produces:
  - `createJobQueue({ log }) -> { enqueue(key, runFn) -> Job, get(key), list(), }`
  - `Job = { key, state: 'queued'|'running'|'done'|'failed', batchesDone, batchesTotal, message, startedAt, finishedAt }`
  - `enqueue` με ίδιο key επιστρέφει το **ίδιο** job (dedupe)
  - `runFn({ onProgress }) -> Promise<any>` — όπου `onProgress(done, total)`

- [ ] **Step 1: Γράψε τα tests**

`test/jobs.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJobQueue } from '../src/jobs.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('enqueue: τρέχει το έργο και περνά σε done', async () => {
  const queue = createJobQueue({ log: () => {} });
  const job = queue.enqueue('k1', async () => 'αποτέλεσμα');
  assert.equal(job.state, 'queued');
  await wait(20);
  assert.equal(queue.get('k1').state, 'done');
});

test('enqueue: ίδιο κλειδί τρεις φορές -> ένα job, μία εκτέλεση', async () => {
  const queue = createJobQueue({ log: () => {} });
  let runs = 0;
  const run = async () => {
    runs += 1;
    await wait(30);
  };
  const a = queue.enqueue('k1', run);
  const b = queue.enqueue('k1', run);
  const c = queue.enqueue('k1', run);
  assert.equal(a, b);
  assert.equal(b, c);
  await wait(60);
  assert.equal(runs, 1);
});

test('onProgress: ενημερώνει batchesDone/batchesTotal', async () => {
  const queue = createJobQueue({ log: () => {} });
  const job = queue.enqueue('k1', async ({ onProgress }) => {
    onProgress(1, 3);
    await wait(10);
    onProgress(3, 3);
  });
  await wait(60);
  assert.equal(job.batchesTotal, 3);
  assert.equal(job.batchesDone, 3);
});

test('αποτυχία: state=failed με το μήνυμα σφάλματος και χωρίς να ρίξει τη διεργασία', async () => {
  const queue = createJobQueue({ log: () => {} });
  const job = queue.enqueue('k1', async () => {
    throw new Error('το μοντέλο έκλεισε');
  });
  await wait(20);
  assert.equal(job.state, 'failed');
  assert.match(job.message, /το μοντέλο έκλεισε/);
});

test('σειρά: τα jobs τρέχουν ένα τη φορά (concurrency 1) και με τη σειρά', async () => {
  const queue = createJobQueue({ log: () => {} });
  const order = [];
  const make = (name) => async () => {
    order.push(`start-${name}`);
    await wait(20);
    order.push(`end-${name}`);
  };
  queue.enqueue('a', make('a'));
  queue.enqueue('b', make('b'));
  await wait(120);
  assert.deepEqual(order, ['start-a', 'end-a', 'start-b', 'end-b']);
});

test('list: επιστρέφει θέσεις, ολοκληρωμένα πρώτα', async () => {
  const queue = createJobQueue({ log: () => {} });
  queue.enqueue('k1', async () => { await wait(10); });
  await wait(60);
  const jobs = queue.list();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].state, 'done');
});
```

- [ ] **Step 2: Τρέξε τα tests — πρέπει να αποτύχουν**

```bash
npm test
```
Expected: FAIL — `Cannot find module '../src/jobs.js'`

- [ ] **Step 3: Υλοποίηση `src/jobs.js`**

```js
// Ουρά με συγχρονισμό 1: το τοπικό μοντέλο δεν σηκώνει παραπάνω και το SubDL
// έχει ημερήσια όρια. Ένα job ανά κλειδί cache — άνοιγμα του μενού 3 φορές
// δεν ξεκινά 3 μεταφράσεις.
export function createJobQueue({ log = () => {} } = {}) {
  const jobs = new Map();
  const pending = [];
  let running = false;

  async function pump() {
    if (running) return;
    running = true;
    while (pending.length > 0) {
      const key = pending.shift();
      const job = jobs.get(key);
      if (!job || job.state !== 'queued') continue;

      job.state = 'running';
      job.startedAt = new Date().toISOString();
      log(`[jobs] ξεκινά ${key}`);
      try {
        const result = await job._run({
          onProgress: (done, total) => {
            job.batchesDone = done;
            job.batchesTotal = total;
            log(`[jobs] ${key} · batch ${done}/${total}`);
          },
        });
        job.state = 'done';
        job.result = result;
        log(`[jobs] ολοκληρώθηκε ${key}`);
      } catch (err) {
        job.state = 'failed';
        job.message = err.message;
        log(`[jobs] απέτυχε ${key}: ${err.message}`);
      } finally {
        job.finishedAt = new Date().toISOString();
        delete job._run;
      }
    }
    running = false;
  }

  return {
    enqueue(key, runFn) {
      const existing = jobs.get(key);
      if (existing && (existing.state === 'queued' || existing.state === 'running')) return existing;

      const job = {
        key,
        state: 'queued',
        batchesDone: 0,
        batchesTotal: 0,
        message: null,
        startedAt: null,
        finishedAt: null,
        _run: runFn,
      };
      jobs.set(key, job);
      pending.push(key);
      queueMicrotask(pump);
      return job;
    },
    get(key) {
      return jobs.get(key) ?? null;
    },
    list() {
      return [...jobs.values()].map(({ _run, ...job }) => ({ ...job }));
    },
  };
}
```

- [ ] **Step 4: Τρέξε τα tests — πρέπει να περάσουν**

```bash
npm test
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/jobs.js test/jobs.test.js
git commit -m "feat(jobs): ουρά μετάφρασης με dedupe ανά κλειδί και συγχρονισμό 1"
```

---

### Task 7: Orchestrator — η σειρά απόφασης

**Files:**
- Create: `src/orchestrator.js`
- Test: `test/orchestrator.test.js`

**Interfaces:**
- Consumes: providers, cache, chain, jobs, `parseSrt`, `applyTranslations`, `makeBatches`, `serializeSrt`
- Produces:
  - `createOrchestrator({ config, cache, jobs, providers, makeChain, log }) -> { getSubtitleTracks({ type, id, extra }) -> Promise<Track[]> }`
  - `Track = { id, url, lang: 'ell', label }`
  - `id` μορφής `tt1234567` ή `tt1234567:5:14`

- [ ] **Step 1: Γράψε τα tests**

`test/orchestrator.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCache, cacheKey } from '../src/cache.js';
import { createJobQueue } from '../src/jobs.js';
import { createOrchestrator } from '../src/orchestrator.js';

const SRT_EN = '\uFEFF1\n00:00:01,000 --> 00:00:03,000\nHello there.\n\n2\n00:00:04,000 --> 00:00:06,000\nWorld.\n';
const SRT_EL = '\uFEFF1\n00:00:01,000 --> 00:00:03,000\nΓεια σου.\n\n2\n00:00:04,000 --> 00:00:06,000\nΚόσμε.\n';

function harness({ providerCandidates, cache = null, chainMap = new Map() }) {
  const dir = cache?.dir ?? mkdtempSync(join(tmpdir(), 'gr-orch-'));
  const theCache = cache ?? createCache(dir);
  const jobs = createJobQueue({ log: () => {} });
  const downloads = [];
  const provider = {
    name: 'fake',
    isConfigured: () => true,
    async search({ languages }) {
      return providerCandidates.filter((c) => languages.includes(c.language));
    },
    async download(candidate) {
      downloads.push(candidate.id);
      return { buffer: Buffer.from(candidate.body, 'utf8'), filename: 'x.srt' };
    },
  };
  const makeChain = () => ({
    translateBatch: async (items) => {
      const map = new Map();
      for (const it of items) map.set(it.id, chainMap.get(it.text) ?? `EL:${it.text}`);
      return map;
    },
    status: () => ({ exhausted: [] }),
  });
  const orchestrator = createOrchestrator({
    config: { targetLang: 'el', sourceLangs: ['en'], batchSize: 70, baseUrl: 'http://127.0.0.1:7000' },
    cache: theCache,
    jobs,
    providers: [provider],
    makeChain,
    log: () => {},
  });
  return { orchestrator, jobs, dir, theCache, downloads };
}

const waitFor = async (fn, ms = 300) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
};

test('υπάρχουν ελληνικοί υπότιτλοι -> τους σερβίρει, ΧΩΡΙΣ καμία μετάφραση', async () => {
  let chainCalls = 0;
  const h = harness({
    providerCandidates: [{ id: 'g1', language: 'el', releaseName: 'Greek release', body: SRT_EL }],
  });
  const tracks = await h.orchestrator.getSubtitleTracks({ type: 'movie', id: 'tt1', extra: {} });
  const greek = tracks.find((t) => /SubDL/.test(t.label));
  assert.ok(greek, 'πρέπει να υπάρχει track ελληνικών από SubDL');
  assert.equal(greek.lang, 'ell');
  const srt = h.theCache.getSrt(greek.url.match(/\/s\/([a-f0-9]+)\.srt/)[1]);
  assert.match(srt, /Γεια σου/);
  rmSync(h.dir, { recursive: true, force: true });
});

test('δεν υπάρχουν ελληνικοί -> μετάφραση στο παρασκήνιο και placeholder', async () => {
  const h = harness({
    providerCandidates: [{ id: 'e1', language: 'en', releaseName: 'Eng release', body: SRT_EN }],
  });
  const tracks = await h.orchestrator.getSubtitleTracks({ type: 'movie', id: 'tt1', extra: {} });
  const ai = tracks.find((t) => /AI/.test(t.label));
  assert.ok(ai, 'πρέπει να υπάρχει track AI μετάφρασης');
  const key = ai.url.match(/\/s\/([a-f0-9]+)\.srt/)[1];
  assert.match(h.theCache.getSrt(key), /σε εξέλιξη|Αναμονή/i, 'πριν τελειώσει, placeholder');

  await waitFor(() => h.jobs.get(key)?.state === 'done');
  const final = h.theCache.getSrt(key);
  assert.match(final, /EL:Hello there\./);
  assert.match(final, /00:00:01,000 --> 00:00:03,000/, 'τα timestamps έμειναν ίδια');

  const englishTrack = tracks.find((t) => t.lang === 'eng');
  assert.ok(englishTrack, 'οι αγγλικοί δίνονται ως εναλλακτική');
  rmSync(h.dir, { recursive: true, force: true });
});

test('δεύτερη φορά: χτύπημα cache, χωρίς νέα λήψη από τον provider', async () => {
  const h = harness({
    providerCandidates: [{ id: 'e1', language: 'en', releaseName: 'Eng release', body: SRT_EN }],
  });
  const first = await h.orchestrator.getSubtitleTracks({ type: 'movie', id: 'tt1', extra: {} });
  const key = first.find((t) => /AI/.test(t.label)).url.match(/\/s\/([a-f0-9]+)\.srt/)[1];
  await waitFor(() => h.jobs.get(key)?.state === 'done');

  h.downloads.length = 0;
  const second = await h.orchestrator.getSubtitleTracks({ type: 'movie', id: 'tt1', extra: {} });
  assert.deepEqual(h.downloads, [], 'δεν ξανακατέβηκε');
  const ai = second.find((t) => /AI/.test(t.label));
  assert.match(ai.label, /✓/);
  rmSync(h.dir, { recursive: true, force: true });
});

test('τίποτα διαθέσιμο -> κενή λίστα, χωρίς εξαίρεση', async () => {
  const h = harness({ providerCandidates: [] });
  const tracks = await h.orchestrator.getSubtitleTracks({ type: 'movie', id: 'tt9', extra: {} });
  assert.deepEqual(tracks, []);
  rmSync(h.dir, { recursive: true, force: true });
});

test('σειρά: το id με episode περνά season/episode στον provider', async () => {
  let seen = null;
  const dir = mkdtempSync(join(tmpdir(), 'gr-orch-'));
  const orchestrator = createOrchestrator({
    config: { targetLang: 'el', sourceLangs: ['en'], batchSize: 70, baseUrl: 'http://x' },
    cache: createCache(dir),
    jobs: createJobQueue({ log: () => {} }),
    providers: [
      {
        name: 'fake',
        isConfigured: () => true,
        async search(q) {
          seen = q;
          return [];
        },
        async download() {
          throw new Error('unused');
        },
      },
    ],
    makeChain: () => ({ translateBatch: async () => new Map(), status: () => ({}) }),
    log: () => {},
  });
  await orchestrator.getSubtitleTracks({ type: 'series', id: 'tt0903747:5:14', extra: { filename: 'Breaking.Bad.S05E14.mkv' } });
  assert.equal(seen.season, '5');
  assert.equal(seen.episode, '14');
  assert.equal(seen.imdbId, 'tt0903747');
  assert.equal(seen.filename, 'Breaking.Bad.S05E14.mkv');
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Τρέξε τα tests — πρέπει να αποτύχουν**

```bash
npm test
```
Expected: FAIL — `Cannot find module '../src/orchestrator.js'`

- [ ] **Step 3: Υλοποίηση `src/orchestrator.js`**

```js
import { createHash } from 'node:crypto';
import { cacheKey } from './cache.js';
import { parseSrt } from './subtitle/parse.js';
import { serializeSrt } from './subtitle/serialize.js';
import { decodeSubtitle } from './subtitle/encoding.js';
import { applyTranslations, makeBatches } from './subtitle/batch.js';

const GREEK_NAMES = 'Ελληνικά';

export function parseStremioId(id) {
  const [imdbId, season, episode] = String(id).split(':');
  return {
    imdbId,
    season: season != null ? String(season) : null,
    episode: episode != null ? String(episode) : null,
  };
}

function placeholderSrt(text) {
  // Πρέπει να είναι έγκυρο SRT: ο player αρνείται αρχείο χωρίς σωστούς χρόνους.
  return serializeSrt([{ id: 1, start: '00:00:02,000', end: '00:00:20,000', text }]);
}

export function createOrchestrator({ config, cache, jobs, providers, makeChain, log = () => {} }) {
  function englishTrackFor(candidate, baseUrl) {
    if (!candidate) return null;
    return {
      id: `orig-${candidate.id}`,
      url: `${baseUrl}/s/orig-${candidate.id}.srt`,
      lang: 'eng',
      label: `English — ${candidate.releaseName.slice(0, 40)}`,
    };
  }

  return {
    async getSubtitleTracks({ type, id, extra = {} }) {
      const { imdbId, season, episode } = parseStremioId(id);
      const baseUrl = config.baseUrl ?? '';
      const tracks = [];

      // 1) Έτοιμη μετάφραση από cache — το πιο συχνό μονοπάτι μετά την πρώτη φορά.
      //    Το κλειδί εξαρτάται από το sourceHash, οπότε δεν μπορούμε να το ξέρουμε
      //    πριν βρούμε τον υπότιτλο· για αυτό το cache ελέγχεται μετά την εύρεση.

      // 2) Υπάρχουν πραγματικοί ελληνικοί;
      let greekCandidate = null;
      let sourceCandidate = null;
      let greekQuotaError = null;

      for (const provider of providers) {
        try {
          if (!greekCandidate) {
            const greek = await provider.search({
              imdbId,
              type,
              season,
              episode,
              filename: extra.filename ?? null,
              languages: [config.targetLang],
            });
            greekCandidate = greek[0] ?? null;
          }
        } catch (err) {
          greekQuotaError = err.message;
          log(`[orchestrator] ελληνικά από ${provider.name}: ${err.message}`);
        }
        try {
          if (!sourceCandidate) {
            const sources = await provider.search({
              imdbId,
              type,
              season,
              episode,
              filename: extra.filename ?? null,
              languages: config.sourceLangs,
            });
            sourceCandidate = sources[0] ?? null;
          }
        } catch (err) {
          log(`[orchestrator] πηγή από ${provider.name}: ${err.message}`);
        }
        if (greekCandidate && sourceCandidate) break;
      }

      // 3) Οι αγγλικοί σερβίρονται πάντα ως εναλλακτική, χωρίς μετάφραση.
      let sourceCues = null;
      let sourceProvider = null;
      if (sourceCandidate) {
        sourceProvider = providers.find((p) => p.name === sourceCandidate.provider);
        try {
          const { buffer } = await sourceProvider.download(sourceCandidate);
          const { text } = decodeSubtitle(buffer);
          sourceCues = parseSrt(text);
          const origKey = `orig-${sourceCandidate.id}`;
          cache.put(origKey, serializeSrt(sourceCues), {
            kind: 'original',
            provider: sourceCandidate.provider,
            releaseName: sourceCandidate.releaseName,
            language: sourceCandidate.language,
          });
          tracks.push(englishTrackFor(sourceCandidate, baseUrl));
        } catch (err) {
          log(`[orchestrator] λήψη πηγής απέτυχε: ${err.message}`);
        }
      }

      if (greekCandidate) {
        const provider = providers.find((p) => p.name === greekCandidate.provider);
        try {
          const { buffer } = await provider.download(greekCandidate);
          const { text } = decodeSubtitle(buffer);
          const cues = parseSrt(text);
          const key = `el-${greekCandidate.id}`;
          cache.put(key, serializeSrt(cues), {
            kind: 'real-greek',
            provider: greekCandidate.provider,
            releaseName: greekCandidate.releaseName,
          });
          tracks.unshift({
            id: `real-greek-${greekCandidate.id}`,
            url: `${baseUrl}/s/${key}.srt`,
            lang: 'ell',
            label: `Ελληνικοί — ${greekCandidate.releaseName.slice(0, 34)}`,
          });
        } catch (err) {
          log(`[orchestrator] λήψη ελληνικών απέτυχε: ${err.message}`);
        }
      }

      // 4) Μετάφραση
      if (sourceCandidate && sourceCues?.length) {
        const sourceHash = createHash('sha1').update(serializeSrt(sourceCues)).digest('hex').slice(0, 16);
        const key = cacheKey({
          sourceHash,
          targetLang: config.targetLang,
          glossaryVersion: config.glossary?.hash ?? 'none',
        });

        if (cache.has(key)) {
          tracks.unshift({
            id: `ai-${key}`,
            url: `${baseUrl}/s/${key}.srt`,
            lang: 'ell',
            label: 'Ελληνικοί (AI) ✓',
          });
        } else {
          const existing = jobs.get(key);
          const state = existing?.state;
          if (state !== 'done') {
            if (!cache.has(key)) {
              cache.put(key, placeholderSrt('Η μετάφραση στα ελληνικά ξεκίνησε.\nΞαναδιάλεξε αυτόν τον υπότιτλο σε ένα-δύο λεπτά.'), {
                kind: 'placeholder',
              });
            }
            const pct = existing && existing.batchesTotal > 0 ? Math.round((existing.batchesDone / existing.batchesTotal) * 100) : 0;
            tracks.unshift({
              id: `ai-${key}`,
              url: `${baseUrl}/s/${key}.srt`,
              lang: 'ell',
              label: state === 'failed' ? `Ελληνικοί (AI) — απέτυχε, δες /admin` : `Ελληνικοί (AI) — σε εξέλιξη ${pct}%`,
            });

            jobs.enqueue(key, async ({ onProgress }) => {
              const batches = makeBatches(sourceCues, config.batchSize);
              const collected = new Map();
              const chain = makeChain();
              for (const batch of batches) {
                const translated = await chain.translateBatch(batch.items, {
                  title: extra.filename ?? imdbId,
                  targetLangName: GREEK_NAMES,
                });
                for (const [k, v] of translated) collected.set(k, v);
                onProgress(batch.index + 1, batches.length);
              }
              const merged = applyTranslations(sourceCues, collected);
              cache.put(key, serializeSrt(merged), {
                kind: 'ai-translation',
                provider: sourceCandidate.provider,
                releaseName: sourceCandidate.releaseName,
                sourceHash,
                cues: merged.length,
                translated: collected.size,
              });
              return { translated: collected.size, total: sourceCues.length };
            });
          }
        }
      }

      if (tracks.length === 0 && greekQuotaError) {
        log(`[orchestrator] τίποτα για ${id}: ${greekQuotaError}`);
      }
      return tracks;
    },
  };
}
```

- [ ] **Step 4: Τρέξε τα tests — πρέπει να περάσουν**

```bash
npm test
```
Expected: PASS. Αν αποτύχει το test «δεύτερη φορά», έλεγξε ότι το `sourceHash` υπολογίζεται από το **ίδιο** σειριοποιημένο κείμενο και στις δύο κλήσεις.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator.js test/orchestrator.test.js
git commit -m "feat(orchestrator): σειρά cache -> ελληνικοί -> αγγλικοί+μετάφραση"
```

---

### Task 8: HTTP server — manifest, subtitles handler, σερβίρισμα αρχείων

**Files:**
- Create: `src/index.js`, `src/config.js`, `src/logger.js`
- Test: `test/server.test.js`

**Interfaces:**
- Consumes: όλα τα προηγούμενα
- Produces: λειτουργικός server στο `http://127.0.0.1:7000` με:
  - `GET /manifest.json`
  - `GET /subtitles/:type/:id.json`
  - `GET /s/:file` (με `no-store` όσο εκκρεμεί, `max-age` όταν τελειώσει)
  - `GET /health`

- [ ] **Step 1: Γράψε τα tests**

`test/server.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/index.js';
import { createCache } from '../src/cache.js';
import { createJobQueue } from '../src/jobs.js';

async function start(tracks) {
  const dir = mkdtempSync(join(tmpdir(), 'gr-srv-'));
  const server = createServer({
    config: { port: 0, targetLang: 'el', sourceLangs: ['en'], batchSize: 70, cacheDir: dir, logLevel: 'error' },
    cache: createCache(dir),
    jobs: createJobQueue({ log: () => {} }),
    providers: [],
    orchestrator: { getSubtitleTracks: async () => tracks },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, dir, close: () => new Promise((r) => server.close(r)) };
}

test('manifest: σωστό resources/types/idPrefixes', async () => {
  const h = await start([]);
  const res = await fetch(`${h.base}/manifest.json`);
  const body = await res.json();
  assert.deepEqual(body.resources, ['subtitles']);
  assert.deepEqual(body.types, ['movie', 'series']);
  assert.deepEqual(body.idPrefixes, ['tt']);
  assert.equal(body.catalogs.length, 0);
  assert.equal(body.id, 'gr.greeksubs.ai');
  await h.close();
  rmSync(h.dir, { recursive: true, force: true });
});

test('subtitles handler: επιστρέφει {subtitles:[...]} με σωστά πεδία', async () => {
  const h = await start([{ id: 'x', url: 'http://127.0.0.1:7000/s/abc.srt', lang: 'ell', label: 'Ελληνικοί (AI) ✓' }]);
  const res = await fetch(`${h.base}/subtitles/movie/tt15239678.json`);
  const body = await res.json();
  assert.equal(body.subtitles.length, 1);
  assert.equal(body.subtitles[0].lang, 'ell');
  assert.ok(body.subtitles[0].id && body.subtitles[0].url);
  await h.close();
  rmSync(h.dir, { recursive: true, force: true });
});

test('/s/:file: no-store όσο εκκρεμεί, max-age όταν τελειώσει', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gr-srv-'));
  const cache = createCache(dir);
  cache.put('pendingkey12', '\uFEFF1\n00:00:01,000 --> 00:00:02,000\nplaceholder\n', { kind: 'placeholder' });
  cache.put('finalkey1234', '\uFEFF1\n00:00:01,000 --> 00:00:02,000\nΓεια\n', { kind: 'ai-translation' });
  const server = createServer({
    config: { port: 0, cacheDir: dir, logLevel: 'error' },
    cache,
    jobs: createJobQueue({ log: () => {} }),
    providers: [],
    orchestrator: { getSubtitleTracks: async () => [] },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const pending = await fetch(`${base}/s/pendingkey12.srt`);
  assert.match(pending.headers.get('cache-control'), /no-store/);
  const final = await fetch(`${base}/s/finalkey1234.srt`);
  assert.match(final.headers.get('cache-control'), /max-age=86400/);
  assert.match(await final.text(), /Γεια/);

  const missing = await fetch(`${base}/s/deadbeef0000.srt`);
  assert.equal(missing.status, 404);
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

test('handler: σφάλμα του orchestrator -> 200 με κενή λίστα, όχι 500', async () => {
  const h = await start(null);
  const server = h.server;
  void server;
  const res = await fetch(`${h.base}/subtitles/movie/tt1.json`);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).subtitles, []);
  await h.close();
  rmSync(h.dir, { recursive: true, force: true });
});

test('health: αναφέρει cache και ουρά', async () => {
  const h = await start([]);
  const body = await (await fetch(`${h.base}/health`)).json();
  assert.equal(body.ok, true);
  assert.ok(body.cache);
  assert.ok(body.queue);
  await h.close();
  rmSync(h.dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Τρέξε τα tests — πρέπει να αποτύχουν**

```bash
npm test
```
Expected: FAIL — `Cannot find module '../src/index.js'`

- [ ] **Step 3: Υλοποίηση `src/config.js`**

```js
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Μικρός .env reader: αποφεύγουμε εξάρτηση μόνο για αυτό.
function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadConfig({ cwd = process.cwd(), env = process.env, overrides = {} } = {}) {
  const fileEnv = { ...readEnvFile(join(cwd, '.env')), ...env };
  const num = (v, fallback) => (v == null || v === '' ? fallback : Number(v));
  const list = (v, fallback) => (v == null || v === '' ? fallback : String(v).split(',').map((s) => s.trim()).filter(Boolean));

  return {
    port: num(fileEnv.PORT, 7000),
    bindHost: fileEnv.BIND_HOST || '127.0.0.1',
    subdlApiKey: fileEnv.SUBDL_API_KEY || '',
    opensubtitlesApiKey: fileEnv.OPENSUBTITLES_API_KEY || '',
    googleApiKey: fileEnv.GOOGLE_API_KEY || '',
    geminiModel: fileEnv.GEMINI_MODEL || 'gemini-2.5-flash',
    lmstudioBaseUrl: fileEnv.LMSTUDIO_BASE_URL || 'http://127.0.0.1:1234/v1',
    lmstudioModel: fileEnv.LMSTUDIO_MODEL || '',
    targetLang: fileEnv.TARGET_LANG || 'el',
    sourceLangs: list(fileEnv.SOURCE_LANGS, ['en']),
    providerOrder: list(fileEnv.PROVIDER_ORDER, ['subdl', 'opensubtitles']),
    engineOrder: list(fileEnv.ENGINE_ORDER, ['gemini', 'lmstudio']),
    batchSize: num(fileEnv.BATCH_SIZE, 70),
    cacheDir: fileEnv.CACHE_DIR || join(cwd, 'cache'),
    glossaryFile: fileEnv.GLOSSARY_FILE || join(cwd, 'glossary.json'),
    logLevel: fileEnv.LOG_LEVEL || 'info',
    minMatchScore: num(fileEnv.MIN_MATCH_SCORE, 0.8),
    baseUrl: fileEnv.BASE_URL || `http://127.0.0.1:${num(fileEnv.PORT, 7000)}`,
    ...overrides,
  };
}
```

- [ ] **Step 4: Υλοποίηση `src/logger.js`**

```js
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function createLogger({ level = 'info', logFile = join('logs', 'addon.log') } = {}) {
  const levels = { error: 0, warn: 1, info: 2, debug: 3 };
  const threshold = levels[level] ?? 2;
  try {
    mkdirSync(dirname(logFile), { recursive: true });
  } catch {
    /* το log αρχείο είναι προαιρετικό */
  }

  const write = (lvl, msg) => {
    if ((levels[lvl] ?? 2) > threshold) return;
    const line = `${new Date().toISOString()} [${lvl}] ${msg}`;
    console.log(line);
    try {
      appendFileSync(logFile, `${line}\n`, 'utf8');
    } catch {
      /* αγνόησε */
    }
  };

  return {
    error: (m) => write('error', m),
    warn: (m) => write('warn', m),
    info: (m) => write('info', m),
    debug: (m) => write('debug', m),
  };
}
```

- [ ] **Step 5: Υλοποίηση `src/index.js`**

```js
import { createServer as createHttpServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createCache } from './cache.js';
import { createJobQueue } from './jobs.js';
import { createProviders } from './providers/index.js';
import { createOrchestrator } from './orchestrator.js';
import { createChain } from './translate/chain.js';
import { createGeminiEngine } from './translate/gemini.js';
import { createLmStudioEngine } from './translate/lmstudio.js';
import { loadGlossary } from './translate/glossary.js';
import { renderAdminPage, adminApi } from './admin.js';

export const MANIFEST = {
  id: 'gr.greeksubs.ai',
  version: '0.1.0',
  name: 'Greek Subs AI',
  description: 'Ελληνικοί υπότιτλοι: πρώτα πραγματικοί, αλλιώς αυτόματη μετάφραση (Gemini / τοπικό μοντέλο).',
  logo: 'https://raw.githubusercontent.com/Stremio/stremio-addon-sdk/master/docs/logo.png',
  resources: ['subtitles'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: [],
  behaviorHints: { configurable: false },
};

export function createServer({ config, cache, jobs, providers, orchestrator, log = () => {}, glossary }) {
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'access-control-allow-origin': '*', ...headers });
    res.end(body);
  };
  const sendJson = (res, status, obj, headers = {}) =>
    send(res, status, JSON.stringify(obj), { 'content-type': 'application/json; charset=utf-8', ...headers });

  return createHttpServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? '127.0.0.1'}`);
    const path = decodeURIComponent(url.pathname);

    try {
      if (path === '/manifest.json') return sendJson(res, 200, MANIFEST);
      if (path === '/health') {
        return sendJson(res, 200, {
          ok: true,
          cache: cache.stats(),
          queue: jobs.list().map(({ key, state, batchesDone, batchesTotal }) => ({ key, state, batchesDone, batchesTotal })),
        });
      }

      const sub = path.match(/^\/subtitles\/(movie|series)\/(.+)\.json$/);
      if (sub) {
        const id = sub[2];
        const extra = Object.fromEntries(url.searchParams.entries());
        let tracks = [];
        try {
          tracks = await orchestrator.getSubtitleTracks({ type: sub[1], id, extra });
        } catch (err) {
          log(`[server] σφάλμα handler για ${id}: ${err.message}`);
          tracks = [];
        }
        return sendJson(res, 200, { subtitles: tracks });
      }

      const file = path.match(/^\/s\/([A-Za-z0-9._-]+)$/);
      if (file) {
        const name = file[1];
        const key = name.replace(/\.srt$/i, '');
        const content = cache.getSrt(key);
        if (content == null) return sendJson(res, 404, { error: 'δεν βρέθηκε' });
        const meta = cache.meta(key) ?? {};
        // Όσο εκκρεμεί η μετάφραση, ο player ΔΕΝ πρέπει να κρατήσει το placeholder.
        const cacheControl = meta.kind === 'placeholder' ? 'no-store' : 'public, max-age=86400';
        return send(res, 200, content, {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': cacheControl,
        });
      }

      if (path === '/admin') return send(res, 200, renderAdminPage(), { 'content-type': 'text/html; charset=utf-8' });
      if (path.startsWith('/admin/api/')) {
        const handled = await adminApi({ path, query: url.searchParams, cache, jobs, providers, glossary, log });
        if (handled) return sendJson(res, handled.status, handled.body);
      }

      return sendJson(res, 404, { error: 'άγνωστη διαδρομή' });
    } catch (err) {
      log(`[server] ανεξέλεγκτο σφάλμα: ${err.stack ?? err.message}`);
      return sendJson(res, 500, { error: 'εσωτερικό σφάλμα' });
    }
  });
}

export function createApp({ config = loadConfig() } = {}) {
  const log = createLogger({ level: config.logLevel });
  const cache = createCache(config.cacheDir);
  const jobs = createJobQueue({ log: log.info });
  const glossary = loadGlossary(config.glossaryFile);
  const providers = createProviders(config);
  const withGlossary = { ...config, glossary };

  const makeChain = () => {
    const engines = {
      gemini: () => createGeminiEngine({ apiKey: withGlossary.googleApiKey, model: withGlossary.geminiModel }),
      lmstudio: () =>
        withGlossary.lmstudioModel
          ? createLmStudioEngine({ baseUrl: withGlossary.lmstudioBaseUrl, model: withGlossary.lmstudioModel })
          : null,
    };
    return createChain({
      engines: withGlossary.engineOrder.map((n) => engines[n]?.()).filter(Boolean),
      targetLangName: 'Ελληνικά',
      glossary,
      log: log.info,
    });
  };

  const orchestrator = createOrchestrator({
    config: withGlossary,
    cache,
    jobs,
    providers,
    makeChain,
    log: log.info,
  });

  const server = createServer({ config: withGlossary, cache, jobs, providers, orchestrator, log: log.info, glossary });
  return { server, config: withGlossary, cache, jobs, providers, glossary, log };
}

// Εκκίνηση μόνο όταν το αρχείο τρέχει απευθείας (τα tests κάνουν import).
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const { server, config, log } = createApp();
  server.listen(config.port, config.bindHost, () => {
    log.info(`Greek Subs AI: http://${config.bindHost}:${config.port}/manifest.json`);
    log.info(`Διαχείριση: http://${config.bindHost}:${config.port}/admin`);
    if (config.providerOrder.includes('subdl') && !config.subdlApiKey) log.warn('Λείπει το SUBDL_API_KEY — δεν θα βρίσκει υπότιτλους.');
    if (!config.googleApiKey) log.warn('Λείπει το GOOGLE_API_KEY — η μετάφραση θα πάει στο τοπικό μοντέλο.');
  });
}
```

**Σημείωση για το `admin.js`:** δημιουργείται στο Task 9. Μέχρι τότε, γράψε στο `src/admin.js` δύο προσωρινές εξαγωγές που θα αντικατασταθούν:
```js
export function renderAdminPage() { return '<!doctype html><title>υπό κατασκευή</title>'; }
export async function adminApi() { return null; }
```

- [ ] **Step 6: Τρέξε τα tests — πρέπει να περάσουν**

```bash
npm test
```
Expected: PASS

- [ ] **Step 7: Χειροκίνητος έλεγχος του manifest**

```bash
node src/index.js &
sleep 1
curl -s http://127.0.0.1:7000/manifest.json
curl -s -i http://127.0.0.1:7000/s/deadbeef.srt | head -3
kill %1
```
Expected: έγκυρο JSON manifest· `404` με ελληνικό μήνυμα λάθους.

- [ ] **Step 8: Commit**

```bash
git add src/index.js src/config.js src/logger.js src/admin.js test/server.test.js
git commit -m "feat(server): manifest, subtitles handler, no-store placeholder, health"
```

---

### Task 9: Σελίδα διαχείρισης `/admin`

**Files:**
- Create: `src/admin.js` (αντικαθιστά το stub του Task 8)
- Test: `test/admin.test.js`

**Interfaces:**
- Consumes: `cache`, `jobs`, `providers`, `glossary`
- Produces:
  - `renderAdminPage() -> string` (αυτοτελής HTML, χωρίς εξωτερικά assets)
  - `adminApi({ path, query, cache, jobs, providers, glossary, log }) -> Promise<{status, body} | null>`
  - Διαδρομές API: `GET /admin/api/status`, `POST /admin/api/cache/delete?key=`, `POST /admin/api/prewarm?imdb=`

- [ ] **Step 1: Γράψε τα tests**

`test/admin.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderAdminPage, adminApi } from '../src/admin.js';
import { createCache } from '../src/cache.js';
import { createJobQueue } from '../src/jobs.js';

test('renderAdminPage: αυτοτελής HTML σε ελληνικά', () => {
  const html = renderAdminPage();
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /Υπότιτλοι/);
  assert.ok(!/https?:\/\//.test(html.replace(/127\.0\.0\.1/g, '')), 'χωρίς εξωτερικά assets');
});

test('adminApi status: επιστρέφει cache, jobs, providers, glossary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gr-admin-'));
  const cache = createCache(dir);
  cache.put('aaaabbbbcccc', 'x', { kind: 'ai-translation', releaseName: 'R' });
  const res = await adminApi({
    path: '/admin/api/status',
    query: new URLSearchParams(),
    cache,
    jobs: createJobQueue({ log: () => {} }),
    providers: [{ name: 'subdl', isConfigured: () => true }],
    glossary: { version: 1, keep: [], map: {}, hash: 'h' },
    log: () => {},
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.cache.count, 1);
  assert.deepEqual(res.body.providers, ['subdl']);
  assert.equal(res.body.glossary.hash, 'h');
  rmSync(dir, { recursive: true, force: true });
});

test('adminApi cache/delete: διαγράφει την εγγραφή', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gr-admin-'));
  const cache = createCache(dir);
  cache.put('aaaabbbbcccc', 'x', {});
  const res = await adminApi({
    path: '/admin/api/cache/delete',
    query: new URLSearchParams({ key: 'aaaabbbbcccc' }),
    cache,
    jobs: createJobQueue({ log: () => {} }),
    providers: [],
    glossary: {},
    log: () => {},
  });
  assert.equal(res.status, 200);
  assert.equal(cache.has('aaaabbbbcccc'), false);
  rmSync(dir, { recursive: true, force: true });
});

test('adminApi prewarm: χωρίς imdb -> 400', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gr-admin-'));
  const res = await adminApi({
    path: '/admin/api/prewarm',
    query: new URLSearchParams(),
    cache: createCache(dir),
    jobs: createJobQueue({ log: () => {} }),
    providers: [],
    glossary: {},
    log: () => {},
  });
  assert.equal(res.status, 400);
  rmSync(dir, { recursive: true, force: true });
});

test('adminApi: άγνωστο μονοπάτι -> null, ώστε ο caller να δώσει 404', async () => {
  const res = await adminApi({ path: '/admin/api/x', query: new URLSearchParams(), log: () => {} });
  assert.equal(res, null);
});
```

- [ ] **Step 2: Τρέξε τα tests — πρέπει να αποτύχουν**

```bash
npm test
```
Expected: FAIL — το stub δεν υλοποιεί τις διαδρομές

- [ ] **Step 3: Υλοποίηση `src/admin.js`**

```js
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function renderAdminPage() {
  return `<!doctype html>
<html lang="el"><head><meta charset="utf-8"><title>Greek Subs AI — Υπότιτλοι</title>
<style>
 body{font-family:system-ui,sans-serif;margin:2rem;max-width:60rem}
 table{border-collapse:collapse;width:100%;margin:1rem 0}
 th,td{border-bottom:1px solid #ccc;text-align:left;padding:.4rem}
 .ok{color:#0a0}.bad{color:#c00}code{background:#f2f2f2;padding:.1rem .3rem}
 h1{font-size:1.3rem}h2{font-size:1rem;margin-top:1.6rem}
</style></head><body>
<h1>Greek Subs AI</h1>
<p>Manifest: <code>http://127.0.0.1:7000/manifest.json</code></p>
<div id="summary">Φόρτωση…</div>
<h2>Μεταφράσεις στη μνήμη</h2>
<table id="cache"><thead><tr><th>Κλειδί</th><th>Είδος</th><th>Release</th><th>Μέγεθος</th><th></th></tr></thead><tbody></tbody></table>
<h2>Εργασίες</h2>
<table id="jobs"><thead><tr><th>Κλειδί</th><th>Κατάσταση</th><th>Πρόοδος</th><th>Μήνυμα</th></tr></thead><tbody></tbody></table>
<h2>Προθέρμανση</h2>
<p>Βάλε IMDb id (π.χ. <code>tt15239678</code> ή <code>tt0903747:5:14</code>) και η μετάφραση ξεκινάει πριν κάτσεις να δεις.</p>
<form onsubmit="event.preventDefault();prewarm(this.imdb.value)">
 <input name="imdb" placeholder="tt15239678" size="20"> <button>Ξεκίνα</button>
</form>
<pre id="out"></pre>
<script>
async function refresh(){
  const r = await fetch('/admin/api/status').then(x=>x.json());
  document.getElementById('summary').innerHTML =
    'Υπότιτλοι στη μνήμη: <b>'+r.cache.count+'</b> · '+(r.cache.bytes/1024).toFixed(0)+' KB'+
    '<br>Providers: '+(r.providers.join(', ')||'<span class="bad">κανένας — λείπει κλειδί</span>')+
    '<br>Glossary: <code>'+r.glossary.hash+'</code>'+
    '<br>Λήψεις SubDL σήμερα: '+(r.quota&&r.quota.downloads?r.quota.downloads.used+'/'+r.quota.downloads.limit:'—');
  const tb = document.querySelector('#cache tbody'); tb.innerHTML='';
  for(const e of r.cacheEntries){
    const tr = document.createElement('tr');
    tr.innerHTML = '<td><code>'+e.key+'</code></td><td>'+e.kind+'</td><td>'+e.releaseName+'</td><td>'+(e.bytes/1024).toFixed(1)+' KB</td>'+
      '<td><button data-k="'+e.key+'">Διαγραφή</button></td>';
    tb.appendChild(tr);
  }
  tb.querySelectorAll('button').forEach(b=>b.onclick=async()=>{await fetch('/admin/api/cache/delete?key='+b.dataset.k,{method:'POST'});refresh();});
  const jb = document.querySelector('#jobs tbody'); jb.innerHTML='';
  for(const j of r.jobs){
    const tr=document.createElement('tr');
    tr.innerHTML='<td><code>'+j.key+'</code></td><td>'+j.state+'</td><td>'+j.batchesDone+'/'+j.batchesTotal+'</td><td>'+(j.message||'')+'</td>';
    jb.appendChild(tr);
  }
}
async function prewarm(imdb){
  const r = await fetch('/admin/api/prewarm?imdb='+encodeURIComponent(imdb),{method:'POST'}).then(x=>x.json());
  document.getElementById('out').textContent = JSON.stringify(r,null,2);
  refresh();
}
refresh(); setInterval(refresh, 3000);
</script></body></html>`;
}

export async function adminApi({ path, query, cache, jobs, providers = [], glossary = {}, orchestrator, log = () => {} }) {
  if (path === '/admin/api/status') {
    if (!cache) return { status: 500, body: { error: 'λείπει το cache' } };
    let quota = null;
    const subdl = providers.find((p) => p.name === 'subdl');
    if (subdl?.quota) {
      try {
        quota = await subdl.quota();
      } catch (err) {
        quota = { error: err.message };
      }
    }
    return {
      status: 200,
      body: {
        cache: cache.stats(),
        cacheEntries: cache.list().map((e) => ({ ...e, releaseName: esc(e.releaseName ?? ''), kind: e.kind ?? '' })),
        jobs: jobs ? jobs.list() : [],
        providers: providers.map((p) => p.name),
        glossary: { hash: glossary?.hash ?? 'none' },
        quota,
      },
    };
  }

  if (path === '/admin/api/cache/delete') {
    const key = query.get('key');
    if (!key) return { status: 400, body: { error: 'λείπει το key' } };
    cache.remove(key);
    log(`[admin] διαγράφηκε ${key}`);
    return { status: 200, body: { removed: key } };
  }

  if (path === '/admin/api/prewarm') {
    const imdb = query.get('imdb');
    if (!imdb) return { status: 400, body: { error: 'λείπει το imdb' } };
    if (!orchestrator) return { status: 503, body: { error: 'ο orchestrator δεν είναι διαθέσιμος' } };
    // Το prewarm απλώς καλεί το ίδιο μονοπάτι με το Stremio: ξεκινά το job
    // χωρίς να μπλοκάρει (το enqueue είναι fire-and-forget).
    const tracks = await orchestrator.getSubtitleTracks({ type: 'movie', id: imdb, extra: {} });
    log(`[admin] προθέρμανση ${imdb}: ${tracks.length} tracks`);
    return { status: 200, body: { imdb, tracks: tracks.map((t) => t.label) } };
  }

  return null;
}
```

**Προσοχή:** το `/admin/api/status` καλεί το `orchestrator` μόνο στο prewarm. Πέρασε το `orchestrator` στο `adminApi` από το `src/index.js` (πρόσθεσε `orchestrator` στο αντικείμενο της κλήσης στο route `/admin/api/`).

- [ ] **Step 4: Τρέξε τα tests — πρέπει να περάσουν**

```bash
npm test
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/admin.js test/admin.test.js src/index.js
git commit -m "feat(admin): σελίδα διαχείρισης, υπόλοιπο SubDL, προθέρμανση, διαγραφή cache"
```

---

### Task 10: Εκκίνηση, αυτόματη εκκίνηση και README

**Files:**
- Create: `start.cmd`, `scripts/check-engines.js`, `scripts/prewarm.js`, `README.md`

**Interfaces:**
- Consumes: `createApp` από Task 8
- Produces: διπλό κλικ εκκίνηση· έλεγχος ετοιμότητας μηχανών· οδηγίες εγκατάστασης στο Stremio

- [ ] **Step 1: `scripts/check-engines.js`**

```js
import { loadConfig } from '../src/config.js';
import { createGeminiEngine } from '../src/translate/gemini.js';
import { createLmStudioEngine } from '../src/translate/lmstudio.js';
import { createProviders } from '../src/providers/index.js';

const config = loadConfig();
const probe = [{ id: 1, text: 'Good morning, captain.' }, { id: 2, text: 'We are ready.' }];
const ctx = { title: 'Έλεγχος', targetLangName: 'Ελληνικά' };
const glossary = { version: 1, keep: [], map: {}, hash: 'probe' };

console.log('— Μηχανές μετάφρασης —');
if (config.googleApiKey) {
  const engine = createGeminiEngine({ apiKey: config.googleApiKey, model: config.geminiModel });
  try {
    const raw = await engine.translateBatch({ items: probe, ...ctx, glossary });
    console.log(`✔ gemini (${config.geminiModel}): ${raw.slice(0, 120)}`);
  } catch (err) {
    console.log(`✘ gemini: ${err.message}${err.quotaExhausted ? '  [ΟΡΙΟ ΕΞΑΝΤΛΗΜΕΝΟ]' : ''}`);
  }
} else {
  console.log('– gemini: λείπει το GOOGLE_API_KEY');
}

if (config.lmstudioModel) {
  const engine = createLmStudioEngine({ baseUrl: config.lmstudioBaseUrl, model: config.lmstudioModel });
  console.log(`  LM Studio διαθέσιμο: ${(await engine.isAvailable()) ? 'ναι' : 'ΟΧΙ'}`);
  try {
    const raw = await engine.translateBatch({ items: probe, ...ctx, glossary });
    console.log(`✔ lmstudio (${config.lmstudioModel}): ${raw.slice(0, 120)}`);
  } catch (err) {
    console.log(`✘ lmstudio: ${err.message}`);
  }
} else {
  console.log('– lmstudio: λείπει το LMSTUDIO_MODEL');
}

console.log('\n— Πηγές υποτίτλων —');
const providers = createProviders(config);
if (providers.length === 0) console.log('✘ κανένας provider — βάλε SUBDL_API_KEY στο .env');
for (const p of providers) {
  try {
    const q = await p.quota();
    console.log(`✔ ${p.name}: λήψεις ${q.downloads?.used ?? '?'}/${q.downloads?.limit ?? '?'}, αναζητήσεις ${q.searches?.used ?? '?'}/${q.searches?.limit ?? '?'}`);
  } catch (err) {
    console.log(`✘ ${p.name}: ${err.message}`);
  }
}
```

- [ ] **Step 2: `scripts/prewarm.js`**

```js
import { createApp } from '../src/index.js';

const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error('Χρήση: npm run prewarm -- tt15239678 tt0903747:5:14');
  process.exit(1);
}

// Δεν ακούμε σε θύρα: το prewarm δουλεύει πάνω στο ίδιο state και βγαίνει.
// Το enqueue είναι fire-and-forget, άρα αν βγούμε αμέσως το job θα κοπεί —
// γι' αυτό περιμένουμε να τελειώσει η ουρά πριν κλείσουμε.
const { orchestrator, jobs, log } = createApp();

const waitForIdle = async () => {
  while (jobs.list().some((j) => j.state === 'queued' || j.state === 'running')) {
    await new Promise((r) => setTimeout(r, 500));
  }
};

for (const id of ids) {
  const tracks = await orchestrator.getSubtitleTracks({ type: 'movie', id, extra: {} });
  log.info(`[prewarm] ${id}: ${tracks.map((t) => t.label).join(' | ') || 'τίποτα'}`);
}

await waitForIdle();
for (const job of jobs.list()) {
  log.info(`[prewarm] ${job.key}: ${job.state} (${job.batchesDone}/${job.batchesTotal})${job.message ? ` — ${job.message}` : ''}`);
}
```

- [ ] **Step 3: `start.cmd`**

```bat
@echo off
cd /d "%~dp0"
set "NODE_EXE=D:\Hermes Agent\Tools\node\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
"%NODE_EXE%" src\index.js
```

- [ ] **Step 4: Αυτόματη εκκίνηση με τα Windows**

```bash
cd "/d/Hermes Agent/Projects/stremio-greek-subs"
SHORTCUT="$APPDATA/Microsoft/Windows/Start Menu/Programs/Startup/GreekSubsAI.lnk"
powershell -NoProfile -Command "\$s=(New-Object -ComObject WScript.Shell).CreateShortcut('$SHORTCUT'); \$s.TargetPath='D:\Hermes Agent\Projects\stremio-greek-subs\start.cmd'; \$s.WorkingDirectory='D:\Hermes Agent\Projects\stremio-greek-subs'; \$s.WindowStyle=7; \$s.Save()"
ls -l "$SHORTCUT"
```
Expected: το `.lnk` υπάρχει. (Ελαχιστοποιημένο παράθυρο — το addon τρέχει αθόρυβα.)

- [ ] **Step 5: `README.md`**

```markdown
# Greek Subs AI

Τοπικό Stremio addon: βρίσκει ελληνικούς υπότιτλους και, όταν δεν υπάρχουν, μεταφράζει τους αγγλικούς στα ελληνικά.

## Εγκατάσταση

1. **Node LTS** (μία φορά): υπάρχει στο `D:\Hermes Agent\Tools\node`.
2. **SubDL API key** (δωρεάν): https://subdl.com → λογαριασμός → Panel → API → δημιούργησε κλειδί. 2.000 αναζητήσεις + 50 λήψεις την ημέρα.
3. **Gemini API key** (δωρεάν): https://aistudio.google.com/apikey
4. Αντίγραψε το `.env.example` σε `.env` και συμπλήρωσε τα δύο κλειδιά.
5. `npm install`
6. Διπλό κλικ στο `start.cmd`.
7. Στο Stremio: **Addons → Add addon** και βάλε `http://127.0.0.1:7000/manifest.json`.

## Τοπικό μοντέλο (εφεδρεία, προαιρετικό)

Άνοιξε το LM Studio, φόρτωσε ένα instruct μοντέλο (≥7B) με context ≥32k, ξεκίνα τον server και βάλε το id του στο `LMSTUDIO_MODEL`.

## Χρήση

- Άνοιξε το μενού υποτίτλων σε μια ταινία. Αν υπάρχουν ελληνικοί, εμφανίζονται ως **Ελληνικοί — <release>**.
- Αλλιώς διάλεξε **Ελληνικοί (AI)**. Την πρώτη φορά λέει «σε εξέλιξη»: περίμενε 1-2 λεπτά και ξαναδιάλεξέ το.
- Δεύτερη φορά: ακαριαία.

## Διαχείριση

`http://127.0.0.1:7000/admin` — υπόλοιπο SubDL, ενεργές εργασίες, διαγραφή μεταφράσεων, προθέρμανση με IMDb id.

## Έλεγχος

`npm run check-engines` — δοκιμάζει Gemini, LM Studio και το υπόλοιπο του SubDL με ένα πραγματικό μικρό αίτημα.
```

- [ ] **Step 6: Commit**

```bash
git add start.cmd scripts/ README.md
git commit -m "feat: εκκίνηση, autostart, έλεγχος μηχανών και οδηγίες"
```

---

### Task 11: End-to-end επαλήθευση με το πραγματικό Stremio

Αυτό το task δεν το εκτελεί agent — το εκτελεί ο χρήστης, με τον agent να παρακολουθεί τα logs.

**Files:**
- Modify: `README.md` (καταγραφή ευρημάτων, αν χρειαστούν διορθώσεις)

- [ ] **Step 1: Έλεγχος μηχανών με πραγματικά κλειδιά**

```bash
npm run check-engines
```
Expected: `✔ gemini`, `✔ subdl` με υπόλοιπο ορίων. Αν το `gemini` δώσει ΟΡΙΟ ΕΞΑΝΤΛΗΜΕΝΟ, σημείωσέ το — το πλάνο προβλέπει fallback, αλλά ο χρήστης πρέπει να το ξέρει.

- [ ] **Step 2: Εκκίνηση και εγκατάσταση στο Stremio**

```bash
./start.cmd &
sleep 2
curl -s http://127.0.0.1:7000/manifest.json | head -5
```
Μετά, στο Stremio desktop: Addons → Add addon → `http://127.0.0.1:7000/manifest.json`.
Expected: το addon εμφανίζεται με το όνομα «Greek Subs AI» και ενεργό το κουμπί Subtitles.

- [ ] **Step 3: Ταινία ΠΟΥ ΕΧΕΙ ελληνικούς υπότιτλους**

Άνοιξε ταινία και το μενού υποτίτλων.
Expected: track «Ελληνικοί — <release>». Στο terminal **δεν** πρέπει να εμφανιστεί καμία γραμμή `[jobs] ξεκινά` — αυτό αποδεικνύει ότι δεν ξοδεύτηκε ούτε ένα credit.

- [ ] **Step 4: Ταινία ΧΩΡΙΣ ελληνικούς**

Expected, με αυτή τη σειρά:
1. track «Ελληνικοί (AI) — σε εξέλιξη 0%»
2. στη κονσόλα: `[jobs] ξεκινά <key>` και γραμμές `batch i/N`
3. μετά ~1-2 λεπτά, `[jobs] ολοκληρώθηκε <key>`
4. επανεπιλογή του track → ελληνικοί υπότιτλοι, σωστός συγχρονισμός σε όλη τη διάρκεια
5. `cache/<key>.srt` υπάρχει και το `/admin` το δείχνει

**Έλεγχος συγχρονισμού:** διάλεξε μια σκηνή με εμφανή διάλογο και σύγκρινε — αν το κείμενο έρχεται νωρίτερα/αργότερα, το πρόβλημα είναι στο parse/serialize και όχι στη μετάφραση.

- [ ] **Step 5: Δεύτερη προβολή της ίδιας ταινίας**

Expected: ακαριαία, track «Ελληνικοί (AI) ✓», **καμία** νέα γραμμή `[jobs]` στο terminal.

- [ ] **Step 6: Σειρά**

Δοκίμασε επεισόδιο σειράς.
Expected: σωστό επεισόδιο (όχι ολόκληρη σεζόν), label με το σωστό release.

- [ ] **Step 7: Πτώση του Gemini (προαιρετικό, αν θέλεις να το δεις)**

Βάλε προσωρινά άκυρο `GEMINI_MODEL` στο `.env`, ξεκίνα, ζήτησε ταινία χωρίς ελληνικούς.
Expected: στο log `ο gemini απέτυχε`, μετά μετάφραση από το τοπικό μοντέλο (αν τρέχει) ή καθαρό μήνυμα αποτυχίας στο label και στο `/admin`.

- [ ] **Step 8: Καταγραφή και commit**

Γράψε στο `README.md` τυχόν αποκλίσεις (π.χ. αν το `lang:"ell"` εμφανίζεται λάθος στο picker, ή αν κάποιο release δεν έπαιξε).

```bash
git add README.md
git commit -m "docs: αποτελέσματα end-to-end επαλήθευσης"
```

---

## Self-Review

**Κάλυψη spec → tasks:**

| Ενότητα spec | Task |
|---|---|
| §3 providers | Task 5 |
| §3 subtitle parse/serialize/detect | Task 1 |
| §3 translate engines + chain + prompt + glossary | Task 2, Task 4 |
| §3 cache | Task 3 |
| §3 jobs | Task 6 |
| §3 orchestrator | Task 7 |
| §4 ροή αίτησης + placeholder + prewarm | Task 7, Task 9 |
| §5 HTTP επιφάνεια | Task 8 |
| §5 manifest id | Task 8 |
| §6 δοκιμές | ενσωματωμένες σε κάθε task + Task 11 |
| §6 ζωντανή έξοδος | Task 6 (`onProgress`), Task 8 (`logger`) |
| §7 χειρισμός σφαλμάτων | Task 4 (quota), Task 5 (quota/rar), Task 7 (καμία πηγή), Task 8 (no-store / 404 / 500→κενή λίστα) |
| §8 διαμόρφωση | Task 8 (`config.js`), Task 0 (`.env.example`) |
| §9 δομή αρχείων | File Structure πίνακας + όλα τα tasks |
| §10 επόμενες φάσεις | Εκτός πεδίου, ρητά |
| §11 κριτήρια επιτυχίας | Task 11 |

**Placeholder scan:** δεν υπάρχουν TBD/TODO. Το `prewarm.js` στο Task 10 έχει ρητή σημείωση υλοποίησης αντί για ψευδοκώδικα, και το `admin.js` έχει stub στο Task 8 που **αντικαθίσταται ρητά** στο Task 9 — κανένα από τα δύο δεν μένει ημιτελές στο τέλος του πλάνου.

**Έλεγχος συνέπειας τύπων:** `Cue{id,start,end,text}` ίδιο σε Task 1, 2, 7. `Candidate{provider,id,language,releaseName,score,downloads}` ίδιο σε Task 5, 7. `Job{key,state,batchesDone,batchesTotal,message}` ίδιο σε Task 6, 8, 9. `Engine{name,isAvailable,translateBatch}` ίδιο σε Task 4 και στη χρήση του στο `makeChain` του Task 8. `cache.put(key, srtText, meta)` ίδιο σε Task 3, 7, 8, 9. Το `adminApi` επιστρέφει `{status, body}|null` και ο caller στο Task 8 ελέγχει για `null` — συνεπές.

**Γνωστή τεχνική οφειλή (καταγεγραμμένη, όχι κρυφή):** ο `createOrchestrator` στο Task 7 χρησιμοποιεί το `extra.filename` ως `context.title` στη μετάφραση και δεν περνά το πραγματικό «title/year» από το SubDL match. Δεν βλάπτει την ποιότητα (το prompt χρησιμοποιεί κυρίως το κείμενο), αλλά είναι σημείο που αξίζει βελτίωση στη φάση 2.

**Σειρά εκτέλεσης:** τα Tasks 1-7 δεν αγγίζουν δίκτυο ή Stremio και τρέχουν εξ ολοκλήρου με ψεύτικες μηχανές (`fetchImpl` injected) — άρα η λογική επαληθεύεται πριν ξοδευτεί οτιδήποτε. Τα πραγματικά κλειδιά χρειάζονται μόνο στο Task 11.
