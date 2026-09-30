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
  assert.equal(queue.get('k1').result, 'αποτέλεσμα');
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
  await wait(150);
  assert.deepEqual(order, ['start-a', 'end-a', 'start-b', 'end-b']);
});

test('μετά την ολοκλήρωση, νέο enqueue στο ίδιο κλειδί ξεκινά νέα εργασία', async () => {
  const queue = createJobQueue({ log: () => {} });
  let runs = 0;
  const run = async () => {
    runs += 1;
  };
  const first = queue.enqueue('k1', run);
  await wait(20);
  const second = queue.enqueue('k1', run);
  await wait(20);
  assert.notEqual(first, second);
  assert.equal(second.state, 'done');
  assert.equal(runs, 2);
});

test('list: επιστρέφει θέσεις χωρίς την εσωτερική συνάρτηση και αντέχει αντικείμενα', async () => {
  const queue = createJobQueue({ log: () => {} });
  queue.enqueue('k1', async () => {
    await wait(10);
  });
  await wait(60);
  const jobs = queue.list();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].state, 'done');
  assert.equal(jobs[0]._run, undefined);
  assert.ok(jobs[0].startedAt && jobs[0].finishedAt);
  assert.doesNotThrow(() => JSON.stringify(jobs), 'χωρίς _run, η λίστα είναι σειριοποιήσιμη');
});

test('get: άγνωστο κλειδί -> null', () => {
  const queue = createJobQueue({ log: () => {} });
  assert.equal(queue.get('άγνωστο'), null);
});

test('καταγραφή: κάθε batch και κάθε φάση αφήνει γραμμή στο log', async () => {
  const logs = [];
  const queue = createJobQueue({ log: (m) => logs.push(m) });
  queue.enqueue('k1', async ({ onProgress }) => {
    onProgress(1, 2);
    onProgress(2, 2);
  });
  await wait(40);
  assert.ok(logs.some((l) => /ξεκινά k1/.test(l)));
  assert.ok(logs.some((l) => /batch 1\/2/.test(l)));
  assert.ok(logs.some((l) => /batch 2\/2/.test(l)));
  assert.ok(logs.some((l) => /ολοκληρώθηκε k1/.test(l)));
});

test('αποτυχία ενός job δεν σταματά την ουρά', async () => {
  const queue = createJobQueue({ log: () => {} });
  queue.enqueue('a', async () => {
    throw new Error('σκάει');
  });
  const b = queue.enqueue('b', async () => 'εντάξει');
  await wait(60);
  assert.equal(queue.get('a').state, 'failed');
  assert.equal(b.state, 'done');
});
