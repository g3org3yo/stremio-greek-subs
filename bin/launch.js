#!/usr/bin/env node
// Φιλική εκκίνηση για διπλό κλικ (βλ. Start-Addon.cmd):
//  - αν ο server τρέχει ήδη, απλώς ανοίγει τη σελίδα — δεν πειράζει τίποτα,
//  - αλλιώς τον ξεκινά, περιμένει να απαντήσει και μετά ανοίγει τη σελίδα.
// Έτσι το ίδιο κουμπί δουλεύει και ως «άνοιξέ το» και ως «ξεκίνησέ το».
import { spawn } from 'node:child_process';
import { start } from '../src/index.js';

const ORIGIN =
  process.env.ADDON_BASE_URL ||
  `http://${process.env.BIND_HOST || '127.0.0.1'}:${process.env.PORT || 7000}`;

async function isUp(timeoutMs = 800) {
  const abort = AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetch(`${ORIGIN}/manifest.json`, { signal: abort });
    return res.ok;
  } catch {
    return false;
  }
}

// Το «start» είναι εντολή του cmd, όχι πρόγραμμα — γι' αυτό περνάει από cmd.
function openBrowser(url) {
  if (process.env.NO_OPEN === '1') {
    console.log(`(δοκιμή: δεν ανοίγω browser για ${url})`);
    return;
  }
  try {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } catch (err) {
    console.log(`Άνοιξε τη σελίδα μόνος σου: ${url} (${err.message})`);
  }
}

if (await isUp()) {
  console.log(`Ο server τρέχει ήδη στο ${ORIGIN} — ανοίγω τη σελίδα.`);
  openBrowser(ORIGIN);
  process.exit(0);
}

let app;
try {
  app = await start();
} catch (err) {
  if (err.code === 'EADDRINUSE') {
    // Κάποιος άλλος τον πρόλαβε στο μεταξύ: μια χαρά, απλώς άνοιξε τη σελίδα.
    console.log(`Η θύρα χρησιμοποιείται ήδη — ανοίγω τη σελίδα στο ${ORIGIN}.`);
    openBrowser(ORIGIN);
    process.exit(0);
  }
  console.error(`\nΟ server δεν ξεκίνησε: ${err.message}\n`);
  process.exit(1);
}

console.log('\n' + '='.repeat(60));
console.log(' Ο server τρέχει. ΜΗΝ κλείσεις αυτό το παράθυρο.');
console.log(' Για να το σταματήσεις: Ctrl+C ή κλείσιμο του παραθύρου.');
console.log('='.repeat(60) + '\n');

openBrowser(app.origin);

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (stopping) process.exit(0);
    stopping = true;
    app.log('[stop] τερματισμός — περιμένω να κλείσει ο server');
    await app.close();
    process.exit(0);
  });
}
