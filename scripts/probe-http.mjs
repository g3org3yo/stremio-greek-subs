// Έλεγχος του ζωντανού addon πάνω από HTTP (ό,τι θα δει το Stremio).
const BASE = 'http://127.0.0.1:7000';
const get = async (path, raw = false) => {
  const res = await fetch(BASE + path);
  const body = raw ? Buffer.from(await res.arrayBuffer()) : await res.text();
  return { status: res.status, type: res.headers.get('content-type'), cors: res.headers.get('access-control-allow-origin'), body };
};

const man = await get('/manifest.json');
const m = JSON.parse(man.body);
console.log(`1) /manifest.json  ${man.status}  ${man.type}  cors=${man.cors}`);
console.log(`   id=${m.id} v${m.version} «${m.name}» resources=${m.resources} types=${m.types} idPrefixes=${m.idPrefixes} configurable=${m.behaviorHints?.configurable ?? false}`);

const subs = await get('/subtitles/movie/tt15239678.json');
const list = JSON.parse(subs.body);
console.log(`2) /subtitles/movie/tt15239678.json  ${subs.status}  cors=${subs.cors}  ${list.subtitles.length} υπότιτλοι`);
for (const s of list.subtitles) console.log(`   ${s.id.slice(0, 14)}… «${s.lang}» ${s.title?.slice(0, 60) ?? ''}`);
console.log(`   url=${list.subtitles[0].url}`);

const srt = await get(list.subtitles[0].url.replace(BASE, ''), true);
const bom = srt.body.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
const text = srt.body.toString('utf8');
const cues = text.split(/\r?\n\r?\n/).filter((b) => b.includes('-->')).length;
console.log(`3) ${list.subtitles[0].url.replace(BASE, '')}  ${srt.status}  ${srt.type}  BOM=${bom}  ${cues} cues  ${srt.body.length} bytes`);
console.log(`   ${text.split(/\r?\n/).slice(1, 3).join(' · ').slice(0, 110)}`);

const tr = await get('/subtitles/series/tt0386676:3:1.json');
const trl = JSON.parse(tr.body);
console.log(`4) /subtitles/series/tt0386676:3:1.json  ${tr.status}  ${trl.subtitles.length} υπότιτλοι: ${trl.subtitles.map((s) => s.id.slice(0, 20)).join(', ')}`);

const home = await get('/');
const admin = await get('/admin');
console.log(`5) /  ${home.status}  cors=${home.cors}  κουμπί stremio://=${home.body.includes('stremio://')}`);
console.log(`6) /admin  ${admin.status}  cors=${admin.cors}`);
const bad = await get('/s/..%2f..%2fpackage.json');
console.log(`7) /s/..%2f..%2fpackage.json  ${bad.status} (αναμενόμενο 4xx/5xx χωρίς διαρροή αρχείου)  ${bad.body.slice(0, 60)}`);
