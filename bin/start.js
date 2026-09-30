#!/usr/bin/env node
// Εκκίνηση του addon: `npm start` ή `node bin/start.js`.
//
// Δεν έχει νόημα να μπει σε daemon/service για τη φάση 1: ο χρήστης βλέπει ζωντανά
// τι μεταφράζεται και σταματά με Ctrl+C.
import { start } from '../src/index.js';

const app = await start();

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (stopping) process.exit(0);
    stopping = true;
    app.log(`[stop] τερματισμός (${signal}) — περιμένω να κλείσει ο server`);
    await app.close();
    process.exit(0);
  });
}
