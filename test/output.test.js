import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findOutput, listOutput, outputName, readOutput, videoBaseName, writeOutput } from '../src/output.js';

// Το παράδειγμα του χρήστη: ό,τι κατέβηκε από torrent, με -Greek στο τέλος.
const YTS = 'Teenage.Sex.And.Death.At.Camp.Miasma.2026.1080p.WEBRip.x264.AAC-[YTS.GG - YTS.BZ]';

function tmp() {
  return mkdtempSync(join(tmpdir(), 'grout-'));
}

test('το όνομα του υπότιτλου ακολουθεί το όνομα του βίντεο, με κατάληξη -Greek', () => {
  assert.equal(outputName({ videoFileName: `${YTS}.mp4` }), `${YTS}-Greek.srt`);
});

test('κρατάει το όνομα αυτούσιο: τελείες, αγκύλες, παύλες, ομάδες', () => {
  assert.equal(
    outputName({ videoFileName: 'The.Movie.2025.1080p.BluRay.x265-GROUP[Subs].mkv' }),
    'The.Movie.2025.1080p.BluRay.x265-GROUP[Subs]-Greek.srt',
  );
});

test('πετάει τη διαδρομή (Windows και POSIX) και μόνο γνωστές καταλήξεις', () => {
  assert.equal(outputName({ videoFileName: 'C:\\Λήψεις\\Dune.Part.Two.2024.2160p.mkv' }), 'Dune.Part.Two.2024.2160p-Greek.srt');
  assert.equal(outputName({ videoFileName: '/media/films/Dune.Part.Two.2024.mkv' }), 'Dune.Part.Two.2024-Greek.srt');
  // Το «x264» είναι μέρος του τίτλου, όχι τύπος αρχείου.
  assert.equal(outputName({ videoFileName: 'Movie.2024.x264' }), 'Movie.2024.x264-Greek.srt');
  assert.equal(outputName({ videoFileName: 'Movie.2024.AAC.avi' }), 'Movie.2024.AAC-Greek.srt');
});

test('δεν διπλώνει το -Greek, όποια μορφή κι αν το έφερε', () => {
  assert.equal(outputName({ videoFileName: 'Movie.2024-Greek.mkv' }), 'Movie.2024-Greek.srt');
  assert.equal(outputName({ videoFileName: 'Movie.2024-GREEK.mp4' }), 'Movie.2024-Greek.srt');
  assert.equal(outputName({ releaseName: 'Movie.2024.1080p.Greek.srt' }), 'Movie.2024.1080p-Greek.srt');
});

test('ελληνικό όνομα αρχείου περνά αυτούσιο (το NTFS το επιτρέπει)', () => {
  assert.equal(outputName({ videoFileName: 'Ταινία.2026.1080p.mkv' }), 'Ταινία.2026.1080p-Greek.srt');
});

test('χαρακτήρες που απαγορεύονται στα Windows καθαρίζονται', () => {
  assert.equal(outputName({ videoFileName: 'Bad:Name?<x>.mp4' }), 'Bad.Name.x-Greek.srt');
  assert.equal(outputName({ videoFileName: 'Ταινία|2*"εκδ".mkv' }), 'Ταινία.2.εκδ-Greek.srt');
});

test('ονόματα-συσκευές των Windows δεν βγαίνουν ποτέ ως αρχείο', () => {
  assert.equal(outputName({ videoFileName: 'CON.mp4' }), '_CON-Greek.srt');
  assert.equal(outputName({ videoFileName: 'lpt1.2024.mkv' }), '_lpt1.2024-Greek.srt');
});

test('πολύ μακρύ όνομα κόβεται, αλλά η κατάληξη μένει', () => {
  const name = outputName({ videoFileName: `${'A'.repeat(220)}.mkv` });
  assert.ok(name.length <= 160, `περίμενε <= 160, πήρε ${name.length}`);
  assert.ok(name.endsWith('-Greek.srt'));
});

test('χωρίς όνομα βίντεο: το όνομα του release, αλλιώς imdb id + επεισόδιο', () => {
  assert.equal(outputName({ releaseName: 'Some.Movie.2023.1080p.WEB-DL.EN.srt' }), 'Some.Movie.2023.1080p.WEB-DL.EN-Greek.srt');
  assert.equal(outputName({ imdbId: 'tt15239678' }), 'tt15239678-Greek.srt');
  assert.equal(outputName({ imdbId: 'tt0903747', season: '5', episode: '14' }), 'tt0903747-S05E14-Greek.srt');
  assert.equal(outputName({ imdbId: 'tt0903747', season: '5' }), 'tt0903747-S05-Greek.srt');
  assert.equal(outputName({}), 'subtitle-Greek.srt');
});

test('το όνομα του βίντεο υπερισχύει των εφεδρειών', () => {
  assert.equal(
    outputName({ videoFileName: 'Real.File.2026.1080p.mkv', releaseName: 'Other.Release', imdbId: 'tt1' }),
    'Real.File.2026.1080p-Greek.srt',
  );
});

test('videoBaseName: κενό ή σκέτη διαδρομή -> null', () => {
  assert.equal(videoBaseName(''), null);
  assert.equal(videoBaseName('   '), null);
  assert.equal(videoBaseName(null), null);
  assert.equal(videoBaseName('C:\\Λήψεις\\'), null);
});

test('writeOutput: γράφει, δεν ξαναγράφει ίδιο περιεχόμενο, ενημερώνει όταν αλλάξει', () => {
  const dir = join(tmp(), 'output');
  const first = writeOutput(dir, 'Movie-Greek.srt', 'Γεια 1');
  assert.equal(first.written, true);
  assert.equal(readFileSync(join(dir, 'Movie-Greek.srt'), 'utf8'), 'Γεια 1');

  // Παλιά ημερομηνία: αν ξαναγραφόταν, θα άλλαζε.
  const old = new Date('2020-01-01T00:00:00Z');
  utimesSync(join(dir, 'Movie-Greek.srt'), old, old);
  const again = writeOutput(dir, 'Movie-Greek.srt', 'Γεια 1');
  assert.equal(again.written, false, 'ίδιο περιεχόμενο = καμία εγγραφή');
  assert.equal(statSync(join(dir, 'Movie-Greek.srt')).mtime.toISOString(), old.toISOString());

  const changed = writeOutput(dir, 'Movie-Greek.srt', 'Γεια 2');
  assert.equal(changed.written, true);
  assert.equal(readFileSync(join(dir, 'Movie-Greek.srt'), 'utf8'), 'Γεια 2');
  rmSync(dir, { recursive: true, force: true });
});

test('writeOutput: χωρίς φάκελο output δεν γράφει πουθενά', () => {
  assert.equal(writeOutput(null, 'x-Greek.srt', 'a'), null);
  assert.equal(writeOutput('', 'x-Greek.srt', 'a'), null);
});

test('listOutput: νεότερα πρώτα, μόνο αρχεία υποτίτλων', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'old-Greek.srt'), 'a');
  writeFileSync(join(dir, 'notes.txt'), 'b');
  writeFileSync(join(dir, 'new-Greek.srt'), 'c');
  const past = new Date('2020-01-01T00:00:00Z');
  utimesSync(join(dir, 'old-Greek.srt'), past, past);

  const files = listOutput(dir);
  assert.deepEqual(
    files.map((f) => f.name),
    ['new-Greek.srt', 'old-Greek.srt'],
    'το .txt δεν είναι υπότιτλος',
  );
  assert.equal(listOutput(dir, { limit: 1 }).length, 1);
  assert.deepEqual(listOutput(join(dir, 'λείπει')), []);
  rmSync(dir, { recursive: true, force: true });
});

test('δεν βγαίνει ποτέ από τον φάκελο output', () => {
  const root = tmp();
  const dir = join(root, 'output');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, '.env'), 'SECRET=1');
  writeFileSync(join(dir, 'real-Greek.srt'), 'a');

  assert.equal(findOutput(dir, '../.env'), null);
  assert.equal(readOutput(dir, '../.env'), null);
  assert.equal(readOutput(dir, '..\\..\\.env'), null);
  assert.equal(readOutput(dir, join(root, '.env')), null);
  assert.equal(readOutput(dir, 'λείπει-Greek.srt'), null);
  assert.ok(readOutput(dir, 'real-Greek.srt').buffer.length > 0);
  rmSync(root, { recursive: true, force: true });
});
