import { createServer as createHttpServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isSafeKey } from './cache.js';
import { listOutput, readOutput } from './output.js';

const MANIFEST = {
  id: 'org.local.greek-subs-auto',
  version: '1.0.0',
  name: 'Ελληνικοί Υπότιτλοι',
  description:
    'Βρίσκει ελληνικούς υπότιτλους. Αν δεν υπάρχουν, μεταφράζει αυτόματα τους αγγλικούς μία φορά και τους κρατά στη μνήμη.',
  resources: ['subtitles'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: [],
  behaviorHints: { configurable: false },
};

function json(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

// Το Content-Disposition δεν δέχεται μη-ASCII (το Node πετάει σφάλμα) και ένα
// εισαγωγικό μένει ανοιχτό αν το όνομα περιέχει απόστροφο. Γι' αυτό: ασφαλές ASCII
// όνομα για όποιον δεν καταλαβαίνει το δεύτερο, και το σωστό όνομα URL-encoded.
function contentDisposition(filename, disposition) {
  const ascii = String(filename)
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(String(filename)).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function sendSubtitle(res, text, { pending = false, name = 'subtitle' } = {}) {
  // Το filenames των Stremio players ταιριάζει σε .srt: δίνουμε και όνομα και
  // σωστό τύπο, αλλιώς κάποιοι players αρνούνται να το φορτώσουν.
  res.writeHead(200, {
    'content-type': 'application/x-subrip; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'content-disposition': contentDisposition(`${name}.srt`, 'inline'),
    'access-control-allow-origin': '*',
    // Έτοιμος υπότιτλος δεν αλλάζει ποτέ -> μένει στον player. Ο δείκτης προόδου
    // αλλάζει σε υπότιτλο, οπότε δεν επιτρέπεται να μείνει στην cache.
    'cache-control': pending ? 'no-store' : 'public, max-age=604800',
  });
  res.end(text);
}

// Όταν ο χρήστης έχει δηλώσει ρητά διεύθυνση (ADDON_BASE_URL), αυτή είναι η
// αλήθεια. Αλλιώς παίρνουμε το Host του αιτήματος: έτσι το addon δουλεύει σε όποια
// θύρα κι αν τρέξει, χωρίς να σερβίρει URLs που δείχνουν αλλού.
function originFor(req, config) {
  if (config.baseUrlExplicit) return config.baseUrl;
  const host = req.headers?.host;
  return host ? `http://${host}` : config.baseUrl;
}

function tailLog(file, lines = 30) {
  if (!file || !existsSync(file)) return [];
  try {
    const size = statSync(file).size;
    // Διαβάζουμε μόνο την ουρά: το αρχείο μεγαλώνει με κάθε μετάφραση και δεν
    // έχει νόημα να φορτώνουμε μεγαβάιτ σε κάθε άνοιγμα του /admin.
    const start = Math.max(0, size - 64 * 1024);
    // Κόβουμε σε επίπεδο bytes και μετά αποκωδικοποιούμε: το slice σε string με
    // offset bytes κόβει στη μέση ελληνικού χαρακτήρα.
    const text = readFileSync(file).subarray(start).toString('utf8');
    return text.split(/\r?\n/).filter(Boolean).slice(-lines);
  } catch {
    return [];
  }
}

function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

function page(config, orchestrator, jobs, cache, logFile, origin, outputFiles = []) {
  const status = orchestrator.status();
  const entries = cache.list().slice(0, 20);
  const pendingJobs = status.jobs.filter((j) => j.state === 'queued' || j.state === 'running');
  const failed = status.jobs.filter((j) => j.state === 'failed');
  const quota = status.translation;

  const rows = entries
    .map((e) => {
      const kind = e.kind === 'ai-translation' ? 'μετάφραση' : e.kind === 'provider' ? 'έτοιμος' : 'πηγή';
      return `<tr><td><code>${e.key}</code></td><td>${kind}</td><td>${e.releaseName ?? '—'}</td><td>${Math.round(
        (e.bytes ?? 0) / 1024,
      )} KB</td></tr>`;
    })
    .join('');

  // Ο φάκελος output/ υπάρχει για έναν λόγο: να ανεβάσει ο χρήστης τα αρχεία σε
  // όποιο site θέλει. Γι' αυτό η λίστα έχει κατέβασμα με ένα κλικ, με το σωστό όνομα.
  const outputRows = outputFiles
    .slice(0, 25)
    .map(
      (f) =>
        `<tr><td><a href="/output/${encodeURIComponent(f.name)}">${esc(f.name)}</a></td><td>${Math.round(
          (f.bytes ?? 0) / 1024,
        )} KB</td><td>${esc(String(f.modified ?? '').slice(0, 16).replace('T', ' '))}</td></tr>`,
    )
    .join('');

  const logLines = tailLog(logFile, 25).map((l) => `<div class="log">${l.replace(/[<>&]/g, '')}</div>`).join('');

  return `<!doctype html>
<html lang="el"><meta charset="utf-8"><title>Ελληνικοί Υπότιτλοι</title>
<style>
  body{font:15px/1.6 system-ui,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#111}
  code{background:#f2f2f2;padding:.1rem .3rem;border-radius:3px}
  table{border-collapse:collapse;width:100%;margin:.5rem 0 1.5rem}
  td,th{border-bottom:1px solid #ddd;padding:.35rem .5rem;text-align:left;font-size:14px}
  .log{font:12px/1.5 ui-monospace,monospace;color:#444;white-space:pre-wrap}
  .box{background:#f6f6f6;border-radius:8px;padding:.8rem 1rem;margin:1rem 0}
  a.install{display:inline-block;background:#2b6cb0;color:#fff;padding:.6rem 1rem;border-radius:6px;text-decoration:none}
</style>
<h1>Ελληνικοί Υπότιτλοι για Stremio</h1>
<div class="box">
  <p><b>Εγκατάσταση:</b> <a class="install" href="stremio://${origin.replace(/^https?:\/\//, '')}/manifest.json">Άνοιγμα στο Stremio</a></p>
  <p>Χειροκίνητα, βάλε αυτό το URL στο Stremio → Πρόσθετα: <code>${origin}/manifest.json</code></p>
  <p><b>Πηγές:</b> ${status.translation.engines.join(', ') || 'καμία'} ·
     <b>Ελληνικοί έτοιμοι:</b> ${entries.filter((e) => e.kind === 'provider').length} ·
     <b>Μεταφράσεις:</b> ${entries.filter((e) => e.kind === 'ai-translation').length}</p>
  <p><b>Σε εξέλιξη:</b> ${pendingJobs.length}${pendingJobs.length ? ` (${pendingJobs.map((j) => j.key).join(', ')})` : ''}
     · <b>Αποτυχίες:</b> ${failed.length}${failed.length ? ` (${failed.map((j) => j.message).join(' | ')})` : ''}</p>
  <p><b>Μηχανές εκτός ορίου:</b> ${quota.exhausted.join(', ') || 'καμία'} · <b>Cache:</b> ${cache.stats().count} αρχεία</p>
  <p><b>Έτοιμα για upload:</b> ${outputFiles.length} αρχεία στο <code>${esc(config.outputDir)}</code></p>
</div>
<h2>Πρόσφατοι υπότιτλοι</h2>
<table><tr><th>Κλειδί</th><th>Είδος</th><th>Πηγή</th><th>Μέγεθος</th></tr>${rows || '<tr><td colspan="4">τίποτα ακόμα</td></tr>'}</table>
<h2>Έτοιμοι για upload <code>output/</code></h2>
<p>Όνομα ίδιο με το αρχείο του βίντεο + <code>-Greek</code>. Πάτησε ένα για κατέβασμα, μετά ανέβασέ το όπου θέλεις.</p>
<table><tr><th>Αρχείο</th><th>Μέγεθος</th><th>Πότε</th></tr>${
    outputRows || '<tr><td colspan="3">τίποτα ακόμα — παίξε κάτι στο Stremio και άνοιξε το μενού υποτίτλων</td></tr>'
  }</table>
<h2>Τελευταίες γραμμές log</h2>
${logLines || '<div class="log">—</div>'}
</html>`;
}

export function createAddonServer({ config, orchestrator, cache, jobs, logFile, log = () => {} }) {
  const server = createHttpServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, config.baseUrl);
    } catch {
      return json(res, 400, { error: 'κακό URL' });
    }

    // Όλα τα /s/ ids είναι «κλειδιά cache». Ό,τι δεν περνά τον έλεγχο δεν αγγίζει
    // τον δίσκο: αλλιώς ένα ../.. στο URL θα διάβαζε αρχεία έξω από τον φάκελο.
    // CORS μόνο εκεί που το χρειάζεται ο player (Stremio Web τρέχει σε browser).
    // Ο πίνακας ελέγχου και το /admin ΔΕΝ το παίρνουν: αλλιώς οποιαδήποτε ιστοσελίδα
    // θα μπορούσε να διαβάσει από το localhost ποιες ταινίες έχει δει ο χρήστης.
    if (url.pathname === '/manifest.json') {
      return json(res, 200, MANIFEST, { 'access-control-allow-origin': '*' });
    }
    if (url.pathname === '/health') return json(res, 200, { ok: true });

    if (url.pathname === '/admin') {
      return json(res, 200, {
        config: {
          baseUrl: config.baseUrl,
          targetLang: config.targetLang,
          providerOrder: config.providerOrder,
          subdlKeyPresent: Boolean(config.subdlApiKey),
          geminiKeyPresent: Boolean(config.geminiApiKey),
          lmstudio: config.lmstudioBaseUrl,
          outputDir: config.outputDir,
        },
        ...orchestrator.status(),
        recent: cache.list().slice(0, 20),
        output: listOutput(config.outputDir, { limit: 50 }),
        logTail: tailLog(logFile, 40),
      });
    }

    if (url.pathname === '/') {
      const html = page(
        config,
        orchestrator,
        jobs,
        cache,
        logFile,
        originFor(req, config),
        listOutput(config.outputDir, { limit: 50 }),
      );
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(html) });
      return res.end(html);
    }

    if (url.pathname.startsWith('/subtitles/')) {
      try {
        const rest = url.pathname.slice('/subtitles/'.length).replace(/\.json$/, '');
        const segments = rest.split('/');
        const type = decodeURIComponent(segments[0] ?? '');
        const id = decodeURIComponent(segments[1] ?? '');
        const extra = new URLSearchParams(segments.slice(2).join('/'));
        const filename = extra.get('filename') ?? undefined;

        const subtitles = (await orchestrator.list({ type, id, filename })).map((s) => ({
          ...s,
          url: `${originFor(req, config)}/s/${s.id}`,
        }));
        log(`[server] ${type}/${id} -> ${subtitles.length} υπότιτλοι${filename ? ` (${filename})` : ''}`);
        // Δεν επιτρέπεται cache στη λίστα: σήμερα μπορεί να είναι «σε εξέλιξη» και
        // αύριο έτοιμος υπότιτλος.
        return json(res, 200, { subtitles }, { 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
      } catch (err) {
        log(`[server] αποτυχία στη λίστα: ${err.message}`);
        // Το Stremio δείχνει «δεν βρέθηκαν υπότιτλοι» αντί για σφάλμα addon.
        return json(res, 200, { subtitles: [] }, { 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
      }
    }

    if (url.pathname.startsWith('/s/')) {
      const key = decodeURIComponent(url.pathname.slice('/s/'.length));
      if (!isSafeKey(key)) {
        log(`[server] απορρίφθηκε ύποπτο κλειδί: ${key.slice(0, 40)}`);
        return json(res, 404, { error: 'άγνωστο αρχείο' });
      }
      const text = await orchestrator.getSubtitle(key);
      if (text == null) return json(res, 404, { error: 'άγνωστο αρχείο' });
      const meta = cache.meta(key) ?? {};
      return sendSubtitle(res, text, {
        pending: orchestrator.isPending(key),
        // Το όνομα που θα σώσει ο player είναι ό,τι ακριβώς θα ανεβάσει ο χρήστης:
        // έτσι δεν χρειάζεται μετονομασία ούτε για τον ίδιο ούτε για όποιον το πάρει.
        name: meta.outputFile ? meta.outputFile.replace(/\.srt$/i, '') : meta.releaseName ? 'greek' : 'subtitle',
      });
    }

    // Κατέβασμα των έτοιμων αρχείων για upload. Το όνομα από το URL δεν χτίζει
    // ποτέ διαδρομή: ψάχνεται κυριολεκτικά στη λίστα του φακέλου output/ (βλ. output.js).
    if (url.pathname.startsWith('/output/')) {
      const name = decodeURIComponent(url.pathname.slice('/output/'.length));
      const file = readOutput(config.outputDir, name);
      if (!file) return json(res, 404, { error: 'άγνωστο αρχείο' });
      res.writeHead(200, {
        'content-type': 'application/x-subrip; charset=utf-8',
        'content-length': file.buffer.length,
        'content-disposition': contentDisposition(file.name, 'attachment'),
      });
      return res.end(file.buffer);
    }

    return json(res, 404, { error: 'άγνωστη διαδρομή' });
  });

  return server;
}
