// Γιατί ο orchestrator βλέπει 0 αποτελέσματα ενώ η απευθείας κλήση βλέπει 10;
import { loadConfig } from '../src/config.js';
import { createProviders } from '../src/providers/index.js';

const config = loadConfig({ env: process.env });
const providers = createProviders(config);
const p = providers[0];
console.log('provider:', p.name, '| minMatchScore:', config.subdlMinMatchScore, '| targetLang:', config.targetLang, '| sourceLangs:', config.sourceLangs);

const cases = [
  { label: 'όπως ο orchestrator (el)', args: { imdbId: 'tt15239678', type: 'movie', season: null, episode: null, filename: undefined, languages: ['el'] } },
  { label: 'όπως ο orchestrator (en)', args: { imdbId: 'tt15239678', type: 'movie', season: null, episode: null, filename: undefined, languages: ['en'] } },
  { label: 'χειροκίνητα en+el', args: { imdbId: 'tt15239678', type: 'movie', season: null, episode: null, filename: undefined, languages: ['en', 'el'] } },
];
for (const c of cases) {
  try {
    const found = await p.search(c.args);
    console.log(`${c.label}: ${found.length} -> ${found.slice(0, 4).map((x) => `${x.language}/${x.releaseName.slice(0, 28)}`).join(', ')}`);
  } catch (err) {
    console.log(`${c.label}: ΣΦΑΛΜΑ ${err.message}`);
  }
}
