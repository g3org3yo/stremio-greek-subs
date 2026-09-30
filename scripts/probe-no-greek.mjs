// Ποια ταινία/επεισόδιο έχει ΑΓΓΛΙΚΟΥΣ αλλά ΟΧΙ ελληνικούς; Χρειάζεται για να
// δοκιμαστεί πραγματικά η διαδρομή της μετάφρασης (όχι μόνο η εύρεση ελληνικών).
import { loadConfig } from '../src/config.js';
import { createProviders } from '../src/providers/index.js';

const config = loadConfig({ env: process.env });
const p = createProviders(config)[0];

const cases = [
  ['ταινία', { imdbId: 'tt15239678', type: 'movie' }],
  ['ταινία', { imdbId: 'tt0107120', type: 'movie' }],
  ['ταινία', { imdbId: 'tt0083658', type: 'movie' }],
  ['σειρά', { imdbId: 'tt0386676', type: 'series', season: '3', episode: '1' }],
  ['σειρά', { imdbId: 'tt0903747', type: 'series', season: '5', episode: '14' }],
  ['σειρά', { imdbId: 'tt0108778', type: 'series', season: '4', episode: '2' }],
  ['σειρά', { imdbId: 'tt0898266', type: 'series', season: '7', episode: '9' }],
  ['σειρά', { imdbId: 'tt1844624', type: 'series', season: '1', episode: '1' }],
];

for (const [kind, args] of cases) {
  const el = await p.search({ ...args, languages: ['el'] });
  const en = await p.search({ ...args, languages: ['en'] });
  console.log(`${args.imdbId} ${args.season ?? ''}:${args.episode ?? ''} (${kind})  el=${el.length} en=${en.length}${el.length === 0 && en.length > 0 ? '   <-- ΥΠΟΨΗΦΙΟ ΓΙΑ ΜΕΤΑΦΡΑΣΗ' : ''}`);
}
