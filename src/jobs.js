// Ουρά με συγχρονισμό 1.
//
// Δύο λόγοι για το ένα-τη-φορά: το τοπικό μοντέλο δεν σηκώνει παράλληλα αιτήματα
// χωρίς να αρχίσει να κόβει τη γενιά, και το SubDL μετράει ημερήσια όρια (50 λήψεις).
// Ταυτόχρονες μεταφράσεις θα έκαιγαν το όριο χωρίς λόγο.
//
// Ένα job ανά κλειδί cache: άνοιγμα του μενού υποτίτλων τρεις φορές δεν ξεκινά τρεις
// μεταφράσεις, και το ίδιο επεισόδιο που βλέπουν δύο άτομα μεταφράζεται μία φορά.
export function createJobQueue({ log = () => {} } = {}) {
  const jobs = new Map();
  const pending = [];
  let running = false;

  async function pump() {
    if (running) return;
    running = true;
    try {
      while (pending.length > 0) {
        const key = pending.shift();
        const job = jobs.get(key);
        if (!job || job.state !== 'queued') continue;

        job.state = 'running';
        job.startedAt = new Date().toISOString();
        log(`[jobs] ξεκινά ${key}`);

        const run = job._run;
        try {
          job.result = await run({
            onProgress: (done, total) => {
              job.batchesDone = done;
              job.batchesTotal = total;
              log(`[jobs] ${key} · batch ${done}/${total}`);
            },
          });
          job.state = 'done';
          log(`[jobs] ολοκληρώθηκε ${key}`);
        } catch (err) {
          // Μια αποτυχημένη μετάφραση δεν πρέπει να ρίξει τη διεργασία ούτε να
          // ακυρώσει τα επόμενα έργα.
          job.state = 'failed';
          job.message = err.message;
          log(`[jobs] απέτυχε ${key}: ${err.message}`);
        } finally {
          job.finishedAt = new Date().toISOString();
          delete job._run;
        }
      }
    } finally {
      running = false;
    }
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
        result: undefined,
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
    // Χωρίς τη συνάρτηση εκτέλεσης: η λίστα σερβίρεται ως JSON από το /admin.
    list() {
      return [...jobs.values()].map(({ _run, ...job }) => ({ ...job }));
    },
  };
}
