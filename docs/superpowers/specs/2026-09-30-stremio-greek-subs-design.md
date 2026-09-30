# Greek Subs AI — Stremio addon για ελληνικούς υπότιτλους με αυτόματη μετάφραση

**Ημερομηνία:** 2026-09-30
**Κατάσταση:** εγκεκριμένο σχέδιο, έτοιμο για πλάνο υλοποίησης
**Φάση 1 (αυτό το spec):** μόνο PC, τοπικό addon στο `http://127.0.0.1:7000`

---

## 1. Πρόβλημα & στόχος

Το Stremio δεν έχει πάντα ελληνικούς υπότιτλους για ό,τι βλέπει ο χρήστης. Θέλουμε ένα **τοπικό addon** που:

1. Ψάχνει υπότιτλους για τον τίτλο που παίζει.
2. Προτιμά **πραγματικούς ελληνικούς** όταν υπάρχουν (μηδέν κόστος, καλύτερη ποιότητα).
3. Όταν δεν υπάρχουν, μεταφράζει αυτόματα τους αγγλικούς στα ελληνικά.
4. Κοστίζει πρακτικά **μηδέν**: δωρεάν API για υπότιτλους, δωρεάν tier για μετάφραση, τοπικό LLM ως εφεδρεία.
5. Κάθε ταινία μεταφράζεται **μία φορά** (cache) — μετά είναι ακαριαίο.

### Εκτός πεδίου (σκόπιμα, τώρα)

- Κινητό / tablet / TV (χρειάζεται HTTPS· βλ. §10).
- Μεταγραφή από ήχο (Whisper) όταν δεν υπάρχει υπότιτλος σε καμία γλώσσα.
- Upload υπότιτλων, λογαριασμοί χρηστών, κοινόχρηστη βάση.
- Web UI εγκατάστασης addon (configuration page).

---

## 2. Δεδομένα απόφασης (επαληθευμένα 2026-09-30)

| Θέμα | Εύρημα | Πηγή |
|---|---|---|
| Τοπικό addon σε Stremio desktop | Δουλεύει με `http://127.0.0.1:7000/manifest.json` | stremio-addon-sdk, addons με τοπικό στήσιμο |
| Addon από άλλη συσκευή | **Απαιτείται HTTPS** — μόνο το `localhost` εξαιρείται | Stremio blog / stremio-features#687 |
| SubDL API | Δωρεάν: 2.000 searches + 50 downloads / μέρα | subdl.com/developers |
| SubDL endpoints | `GET /api/v2/subtitles/search`, `GET /api/v2/subtitles/{nId}/download?format=file`, `GET /api/v2/me` (όρια) | subdl.com/developers |
| OpenSubtitles | Δωρεάν λογαριασμός: 20 λήψεις/μέρα (5 χωρίς λογαριασμό) | opensubtitles help center |
| Gemini free tier | Μεταβλητό· μετά τη μείωση του Δεκ. 2025 κυμαίνεται 20–250 RPD ανά μοντέλο | Google AI forum, aifreeapi |
| DeepSeek (δεν χρησιμοποιείται στη φάση 1) | ~1,4–2,8 λεπτά ευρώ ανά ταινία | υπολογισμός: 12k in / 20k out tokens |
| Stremio & κωδικοποίηση | Δυνατότητα εξαναγκασμού μαντέματος encoding μέσω `http://127.0.0.1:11470/subtitles.vtt?from=<url>` | stremio-addon-sdk docs |

**Υπολογισμός μετάφρασης:** ταινία 120' ≈ 1.000 cues ≈ 12k tokens εισόδου, ~20k εξόδου. Με παρτίδες των 60–80 cues → **12–16 requests ανά ταινία**.

Άρα Gemini free tier (ακόμα και στη χειρότερη περίπτωση των ~20 RPD) εξυπηρετεί **1–3 ταινίες/μέρα δωρεάν**· μετά αναλαμβάνει το τοπικό μοντέλο.

---

## 3. Αρχιτεκτονική

Μία Node διεργασία, τρία ανεξάρτητα στρώματα. Κάθε στρώμα έχει στενή διεπαφή και δοκιμάζεται μόνο του.

```
Stremio  ──GET /subtitles/movie/tt15239678.json──▶  express routes (src/index.js)
                                                          │
                                                    orchestrator (src/orchestrator.js)
                                                    ┌─────┼──────────────┐
                                          providers │  cache│   translate │
                                     (SubDL, [OS])  │ (files)│  (chain)   │
                                                    └─────┴──────────────┘
                                                          │
                                            GET /s/<key>.srt  ──▶ Stremio
```

### Στρώματα και διεπαφές

**`src/providers/` — πηγές υποτίτλων**

```js
// κάθε provider υλοποιεί:
{
  name: "subdl",
  isConfigured(): boolean,
  search(query): Promise<Candidate[]>,   // query: {imdbId, type, season, episode, filename, videoHash, languages[]}
  download(candidate): Promise<Buffer>   // επιστρέφει το .srt ως buffer (αποσυμπιέζει zip/rar αν χρειάζεται)
}
// Candidate: { provider, id, language, releaseName, downloads, score, format }
```

- `subdl.js` — πρώτος provider (δωρεάν key, 50 λήψεις/μέρα).
- `opensubtitles.js` — δεύτερος, προαιρετικός, ίδια διεπαφή. Ενεργοποιείται μόνο αν υπάρχει key στο `.env`· χρησιμοποιείται ως fallback όταν το SubDL δεν έχει τίποτα.
- Η σειρά είναι διαμορφώσιμη (`PROVIDER_ORDER`).

**`src/subtitle/` — μορφή αρχείου**

```js
parseSrt(buffer) -> { cues: [{id, start, end, text}], encoding, hadBom, lineEnding }
serializeSrt(cues, opts) -> string   // UTF-8, LF, με BOM
stripTags(text) / keepTags(text)     // διαχωρισμός <i>, {\an8}, SDH σημειώσεων
```

Δέχεται UTF-8, UTF-8 BOM, Windows-1253 (ελληνικά), Windows-1252. Ανίχνευση με `jschardet` + heuristics· στο πρώτο αμφίβολο αρχείο πέφτει στο Stremio-encoding trick (§7).

**`src/translate/` — μηχανές μετάφρασης**

```js
// κάθε engine υλοποιεί:
{
  name: "gemini",
  isAvailable(): Promise<boolean>,
  translateBatch(req): Promise<string[]>   // req: {items: [{id, text}], targetLang, context: {title, year, glossary}}
}
```

- `gemini.js` — primary. `gemini-2.5-flash` μέσω `GOOGLE_API_KEY`.
- `lmstudio.js` — fallback. OpenAI-compatible at `http://127.0.0.1:1234/v1`, μοντέλο από `.env`.
- `chain.js` — δοκιμάζει τους engines με τη σειρά· σε 429/quota/timeout σημειώνει τον engine ως εξαντλημένο **για τη μέρα** (persist με ώρα επαναφοράς) και περνά στον επόμενο. Αν ένα batch αποτύχει σε όλους, το job αποτυγχάνει καθαρά και μένει στο log.
- `prompt.js` — **ένα κοινό prompt** για όλες τις μηχανές (ώστε η ποιότητα να είναι συγκρίσιμη και η αλλαγή να γίνεται σε ένα σημείο). Απαιτεί **JSON εξόδου** `[{id, text}]` — τα timestamps δεν περνούν ποτέ από το μοντέλο.
- `glossary.js` — όροι/ονόματα από `glossary.json` που διορθώνει ο χρήστης. Το περιεχόμενο του glossary μπαίνει στο cache key (αλλαγή → νέα μετάφραση).

Κανόνες prompt (συνοπτικά): μετέφρασε φυσικά ελληνικά κινηματογραφικού τόνου· μη συνενώνεις/σπάσεις cues· κράτα τις παύλες `-` και τα `<i>`· μη μεταφράζεις κύρια ονόματα εκτός αν το glossary το ορίζει· μη προσθέτεις εξηγήσεις· επέστρεψε **μόνο** το JSON.

**`src/cache.js` — αποθήκευση**

- Κλειδί: `sha1(sourceHash + "|" + targetLang + "|" + glossaryVersion)`. **Ο engine ΔΕΝ μπαίνει στο κλειδί** — αλλιώς μια αποτυχία του Gemini και η επανάληψη με το τοπικό θα δημιουργούσε διπλή μετάφραση του ίδιου αρχείου. Ποιος engine το έφτιαξε πάει στα metadata.
- Για «ξανακάν' το καλύτερα»: διαγραφή της εγγραφής από το `/admin` + prewarm. Δεν χρειάζεται δεύτερο κλειδί.
- `sourceHash`: sha1 του αρχικού αρχείου υποτίτλου (σταθερό ανά περιεχόμενο, όχι ανά ταινία) — ώστε δύο διαφορετικά releases της ίδιας ταινίας να μην ξαναμεταφράζονται αν κατεβάσουν το ίδιο αρχείο.
- Αποθηκεύει `<key>.srt` (UTF-8, έτοιμο για σερβίρισμα) + `<key>.json` (metadata: τίτλος, provider, engine, χρόνος, tokens, κόστος).
- **Αρχεία συστήματος, όχι βάση** — ο φάκελος είναι ο ίδιος ο δείκτης. Λόγος: μηδέν εξαρτήσεις, ο χρήστης μπορεί να διαγράψει/αντιγράψει αρχεία χειροκίνητα, και το `/admin` απλώς κάνει `readdir`.

**`src/jobs.js` — ουρά**

- In-memory ουρά με συγχρονισμό 1 (μία μετάφραση τη φορά — το τοπικό μοντέλο δεν σηκώνει παραπάνω, και το SubDL έχει όρια).
- Κατάσταση ανά job: `queued | running | done | failed`, πρόοδος `batch i/N`, μήνυμα σφάλματος.
- **Dedupe:** άνοιγμα του μενού υποτίτλων 3 φορές δεν φτιάχνει 3 jobs — κλειδί job = κλειδί cache, ένα job ανά υπότιτλο.
- Μετά το τέλος, γράφει το cache και **αντικαθιστά το placeholder** (ώστε όποιος ξαναδιαλέξει το track να δει τα πραγματικά ελληνικά).
- **HTTP caching:** όσο εκκρεμεί, το `/s/<key>.srt` απαντά με `Cache-Control: no-store` (αλλιώς ο player κρατάει το placeholder). Όταν ολοκληρωθεί, `Cache-Control: public, max-age=86400`. Το `label` του track αλλάζει σε «Ελληνικοί (AI) ✓» για να φαίνεται πότε να το ξαναδιαλέξει.
- Αν το addon κλείσει στη μέση, το επόμενο αίτημα ξαναρχίζει το job (τα έτοιμα batches μένουν σε `.partial`).

**`src/orchestrator.js`**

Η μόνη μονάδα που ξέρει τη σειρά: cache → ελληνικοί υπάρχοντες → αγγλικοί + μετάφραση. Επιστρέφει τη λίστα tracks στο Stremio. Δεν ξέρει HTTP ούτε SRT μορφή.

---

## 4. Ροή αίτησης (βήμα-βήμα)

1. Stremio: `GET /subtitles/movie/tt15239678.json` (με `extra`: `videoHash`, `filename`).
2. **Cache lookup.** Χτύπημα → επιστροφή ενός track «Ελληνικοί (AI)» που δείχνει στο `/s/<key>.srt`. Ακαριαίο.
3. **SubDL search `languages=el`.** Υπάρχει candidate με καλό score → κατεβάζει, ελέγχει ότι είναι όντως ελληνικά (όχι κενό/λάθος γλώσσα), σερβίρει ως «**Ελληνικοί (SubDL)**». Μηδέν κόστος.
4. **SubDL search `languages=en`** (ή στη `SOURCE_LANGS` λίστα). Το SubDL **δεν δέχεται video hash** — για ακριβές ταίριασμα release χρησιμοποιείται το `GET /api/v2/files/search?filename=<filename>&languages=en` (Drop & Match), που γυρίζει `match_score` 0–1 ανά υπότιτλο· όριο εμπιστοσύνης **≥0,8**.
   - Υπάρχει `filename` στο `extra` → `files/search`.
   - Δεν υπάρχει → `subtitles/search?imdb_id=<id>` και επιλογή με περισσότερες λήψεις.
   - Το `extra` (`filename`, `videoHash`, `season`, `episode`) μπορεί να λείπει σε κάποιους clients — ο κώδικας δουλεύει και χωρίς αυτό.
5. Κατεβάζει, κάνει parse, φτιάχνει batches των 60–80 cues.
6. **Job στην ουρά:** μετάφραση batch-by-batch με chain (Gemini → τοπικό).
7. **Άμεση απάντηση στο Stremio** με:
   - «Ελληνικοί (SubDL)» — αν υπήρχαν στο βήμα 3
   - «Ελληνικοί (AI) — μετάφραση σε εξέλιξη 0%» → placeholder SRT
   - «English» (ή οι πηγές) → οι αυθεντικοί υπότιτλοι, για χειροκίνητη επιλογή
8. Όταν τελειώσει το job, το `/s/<key>.srt` σερβίρει το πραγματικό αρχείο. Ο χρήστης ξαναδιαλέγει το track και βλέπει ελληνικά.

**Γιατί placeholder και όχι αναμονή:** το Stremio κόβει τα αργά addon requests. Δεν μπλοκάρουμε ποτέ την απάντηση πάνω από ~3 δευτερόλεπτα· η μετάφραση τρέχει στο παρασκήνιο και είναι μία φορά.

**Prewarm:** στο `/admin` υπάρχει πεδίο για IMDb id → ξεκινά το job πριν κάτσει να δει. Αυτό είναι και ο τρόπος να μεταφραστεί μια ολόκληρη σεζόν σε ησυχία.

---

## 5. HTTP επιφάνεια

| Μέθοδος | Διαδρομή | Τι κάνει |
|---|---|---|
| GET | `/manifest.json` | Manifest: `resources:["subtitles"]`, `types:["movie","series"]`, `idPrefixes:["tt"]`, `catalogs:[]` |
| GET | `/subtitles/:type/:id.json` | Ο handler· απαντά με λίστα tracks |
| GET | `/s/:key.srt` | Σερβίρει έτοιμο υπότιτλο (UTF-8, `text/plain; charset=utf-8`) |
| GET | `/admin` | Σελίδα: cache, όρια SubDL, ετοιμότητα Gemini/LM Studio, ενεργά jobs, log ουράς, κουμπί prewarm, διαγραφή cache |
| GET | `/health` | `{ok, engines:{gemini:bool, lmstudio:bool}, queue:{...}}` |

`/admin` και `/health` ακούν **μόνο σε `127.0.0.1`** ακόμα και όταν το addon δεθεί σε `0.0.0.0` (φάση 2) — δεν εκτίθενται στο δίκτυο.

**Manifest id:** `gr.greeksubs.ai` (μοναδικό, σταθερό· δεν αλλάζει γιατί σπάει τις εγκαταστάσεις).

**Κωδικοί γλώσσας — προσοχή, είναι διαφορετικοί:** το SubDL θέλει **ISO 639-1** (`languages=el`), το Stremio απάντηση θέλει **ISO 639-2** (`lang:"ell"`). Αν το `lang` δεν είναι έγκυρος κωδικός, το Stremio τυπώνει το κείμενο αυτούσιο — άρα δίνουμε και σωστό `label`. Επαληθεύεται στο χειροκίνητο E2E.

---

## 6. Δοκιμές

**Unit (χωρίς δίκτυο):**
- `parseSrt`/`serializeSrt`: round-trip χωρίς απώλεια· UTF-8 BOM· CRLF· Windows-1253· κενά cues· cues με `<i>`· SDH με αγκύλες.
- Batch splitting: ίδιος αριθμός cues, ίδια σειρά, ίδια `id`· cue με 3 γραμμές δεν σπάει σε 2 batches.
- Cache key: ίδιο περιεχόμενο → ίδιο κλειδί· αλλαγή glossary/engine → νέο κλειδί.
- Chain fallback: Gemini επιστρέφει 429 → καλείται το επόμενο· όλοι αποτυγχάνουν → το job αποτυγχάνει με καθαρό μήνυμα.
- Κατασκευή prompt: τα `<i>` και οι παύλες διατηρούνται, τα ονόματα του glossary δεν μεταφράζονται.

**Integration (HTTP mocked, fixtures ηχογραφημένα από πραγματικές απαντήσεις):**
- SubDL adapter: parse πραγματικής απάντησης search· λήψη zip με 1 και με πολλά αρχεία· 429/quota σφάλμα.
- `GET /subtitles/movie/tt15239678.json` με μοκ providers/engines → σωστό σχήμα, σωστός αριθμός tracks, `lang:"ell"`.
- `<key>.srt` σερβίρεται μετά το πέρας του job· πριν, σερβίρει το placeholder.

**Χειροκίνητο E2E (ο χρήστης):**
1. Ταινία που έχει ελληνικούς στο SubDL → track «Ελληνικοί (SubDL)», ΚΑΝΕΝΑ αίτημα σε μοντέλο (επαληθεύεται από το log).
2. Ταινία χωρίς ελληνικούς → placeholder → μετά ~1' ελληνικά χωρίς σφάλμα συγχρονισμού.
3. Ίδια ταινία δεύτερη φορά → ακαριαία, χωρίς νέα κλήση.
4. Σειρά: `tt0903747:5:14` → σωστό επεισόδιο, όχι ολόκληρη η σεζόν.
5. Ο κωδικός `lang:"ell"` εμφανίζεται στο picker ως «Ελληνικά» και όχι σκέτο «ell» (επιβεβαιώνει ότι είναι έγκυρο ISO 639-2).
6. Επιλογή του placeholder, αναμονή, επανεπιλογή του ίδιου track → πραγματικά ελληνικά (επιβεβαιώνει ότι το `no-store` δουλεύει).

**Ζωντανή έξοδος:** κάθε batch τυπώνει γραμμή προόδου (`[job 3] 4/14 batches · gemini · 2.1k tokens · 18s`). Το `/admin` δείχνει το ίδιο. Ο χρήστης θέλει να βλέπει τι γίνεται, όχι σιωπή.

---

## 7. Χειρισμός σφαλμάτων

| Κατάσταση | Συμπεριφορά |
|---|---|
| SubDL quota (50 λήψεις/μέρα) | Το `/admin` δείχνει υπόλοιπο από `GET /api/v2/me`· αν πέσει, περνά στον επόμενο provider. Το track λέει «όριο SubDL — δοκίμασε αύριο». |
| Gemini 429 / όριο | Ο engine σημειώνεται εξαντλημένος μέχρι την επόμενη μέρα και η μετάφραση συνεχίζει τοπικά. |
| LM Studio δεν τρέχει | Το placeholder λέει «Το τοπικό μοντέλο είναι κλειστό» με την εντολή `lms server start`. Το `/admin` το δείχνει κόκκινο. |
| Καμία πηγή υποτίτλων | Κενή λίστα + καταγραφή. Δεν πετάει σφάλμα στο Stremio. |
| Λάθος κωδικοποίηση | Πρώτα heuristics· αν αποτύχει, το `url` γίνεται `http://127.0.0.1:11470/subtitles.vtt?from=<url>` για να μαντέψει το encoding το Stremio. |
| Batch αποτυγχάνει σε όλους τους engines | Job → `failed`, κρατά τα έτοιμα batches σε `.partial`, το `/admin` έχει κουμπί «συνέχισε από εκεί που έμεινε». |
| Το addon κλείνει στη μέση | Στο επόμενο αίτημα το job ξαναρχίζει από τα έτοιμα batches. |
| Λάθος ταινία/episode match | Το track δείχνει πάντα το `releaseName` της πηγής, ώστε ο χρήστης να ελέγχει με μια ματιά. |

---

## 8. Διαμόρφωση (`.env` στο project, δεν μπαίνει στο git)

```
PORT=7000
SUBDL_API_KEY=
OPENSUBTITLES_API_KEY=          # προαιρετικό, για fallback provider
GOOGLE_API_KEY=                 # υπάρχει ήδη στο μηχάνημα
GEMINI_MODEL=gemini-2.5-flash
LMSTUDIO_BASE_URL=http://127.0.0.1:1234/v1
LMSTUDIO_MODEL=                 # συμπληρώνεται από τα διαθέσιμα μοντέλα
TARGET_LANG=el
SOURCE_LANGS=en
PROVIDER_ORDER=subdl,opensubtitles
ENGINE_ORDER=gemini,lmstudio
BATCH_SIZE=70
CACHE_DIR=./cache
GLOSSARY_FILE=./glossary.json
LOG_LEVEL=info
```

Χειροκίνητο βήμα του χρήστη: δωρεάν λογαριασμός SubDL → API key. Όλα τα υπόλοιπα τα προσπερνά το addon αν λείπουν.

---

## 9. Δομή αρχείων

```
stremio-greek-subs/
├─ docs/superpowers/specs/2026-09-30-stremio-greek-subs-design.md
├─ src/
│  ├─ index.js           # express + routes + binding
│  ├─ orchestrator.js    # η σειρά: cache → el → en+translate
│  ├─ config.js
│  ├─ cache.js
│  ├─ jobs.js
│  ├─ logger.js          # ζωντανή πρόοδος, αρχείο + κονσόλα
│  ├─ admin/             # /admin σελίδα + /health
│  ├─ providers/{subdl.js, opensubtitles.js, index.js}
│  ├─ subtitle/{parse.js, serialize.js, detect.js, batch.js}
│  └─ translate/{chain.js, prompt.js, glossary.js, gemini.js, lmstudio.js}
├─ test/                 # unit + integration με fixtures
├─ scripts/{check-engines.js, prewarm.js}
├─ start.cmd             # ξεκίνημα + εγγραφή στα Windows startup
├─ glossary.json
└─ .env.example
```

---

## 10. Επόμενες φάσεις (δεν υλοποιούνται τώρα)

1. **Κινητό/tablet** — Tailscale στο PC + κινητό, `tailscale serve` για πραγματικό HTTPS πιστοποιητικό· τότε το addon δένεται και σε `0.0.0.0` με `/admin` κλειδωμένο σε localhost.
2. **Μεταγραφή από ήχο** — αν δεν υπάρχει υπότιτλος σε καμία γλώσσα, τοπικό Whisper (faster-whisper) πάνω στο αρχείο. Καλύπτει το κενό εντελώς.
3. **DeepSeek ως τρίτος engine** — ~2 λεπτά/ταινία, για ταινίες που θέλει ποιότητα χωρίς αναμονή.
4. **Πολλαπλά επίπεδα ποιότητας** — «γρήγορη» (ένα πέρασμα) και «προσεγμένη» (δεύτερο πέρασμα διόρθωσης).

---

## 11. Κριτήρια επιτυχίας

- Εγκαθίσταται στο τοπικό Stremio με ένα `manifest.json` URL και δεν χρειάζεται συντήρηση.
- Ταινία με υπάρχοντες ελληνικούς → σωστοί υπότιτλοι, **μηδέν** κλήση σε μοντέλο.
- Ταινία χωρίς ελληνικούς → ελληνικοί υπότιτλοι σε ≤2 λεπτά συνολικά με Gemini, με σωστό συγχρονισμό (καμία μετατόπιση).
- Δεύτερη προβολή → ακαριαία.
- Κόστος: **0€** στο σύνηθες σενάριο· όταν πέσει το δωρεάν όριο, συνεχίζει δωρεάν τοπικά χωρίς χειροκίνητη παρέμβαση.
