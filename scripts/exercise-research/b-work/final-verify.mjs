// Final gate: re-verify every video in the OUTPUT file via oEmbed; confirm title/channel consistency + ZWNJ usage.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, '..', 'groupB-strength.json');
const data = JSON.parse(fs.readFileSync(OUT, 'utf8'));

let ok = 0, bad = [];
let zwnjCount = 0;
for (const ex of data) {
  const zwnj = [...(ex.fa + ex.name + ex.description + ex.tips)].filter(c => c.codePointAt(0) === 0x200C).length;
  if (ex.core) { if (zwnj === 0) bad.push(`${ex.en}: core text has no ZWNJ`); zwnjCount += zwnj; }
  const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ex.ytVideoId}&format=json`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) { bad.push(`${ex.en}: oEmbed ${r.status} for ${ex.ytVideoId}`); continue; }
  const j = await r.json();
  if (j.title !== ex.ytTitle || j.author_name !== ex.ytChannel) {
    bad.push(`${ex.en}: MISMATCH file("${ex.ytTitle}"|${ex.ytChannel}) vs oEmbed("${j.title}"|${j.author_name})`);
  } else ok++;
  await new Promise(s => setTimeout(s, 150));
}
console.log(`oEmbed re-verified: ${ok}/${data.length}`);
console.log(`ZWNJ total occurrences: ${zwnjCount}`);
if (bad.length) { console.log('PROBLEMS:'); bad.forEach(b => console.log(' -', b)); process.exit(1); }
console.log('ALL CHECKS PASSED');
