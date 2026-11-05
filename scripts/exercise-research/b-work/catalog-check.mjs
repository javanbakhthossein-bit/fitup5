import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

const QUERIES = [
  ['crossfit', 'CrossFit foundational movements list squat front squat overhead squat press deadlift clean'],
  ['crossfit_standards', 'CrossFit Games movement standards wall ball chest-to-bar pull-up thruster muscle-up'],
  ['exrx_squat', 'ExRx barbell back squat front squat exercise directory'],
  ['exrx_deadlift', 'ExRx barbell deadlift stiff leg sumo romanian exercise'],
  ['ms_deadlift', 'Muscle and Strength exercise database deadlift variations romanian sumo stiff leg'],
  ['oly_catalyst', 'Catalyst Athletics olympic weightlifting exercise library clean snatch variations'],
  ['oly_variations', 'olympic weightlifting power snatch hang snatch hang clean power clean push press jerk teaching progression'],
  ['pl_accessories', 'powerlifting accessory exercises list box squat pause squat rack pull floor press close grip bench'],
  ['pl_accessories2', 'glute ham raise hip thrust good morning powerlifting assistance exercises'],
  ['fitnessprogramer', 'FitnessProgramer exercise library barbell exercises guide'],
  ['crossfit_wods_moves', 'crossfit benchmark movements burpee box jump toes to bar double under farmer carry devil press'],
];

const zai = await ZAI.create();
const out = {};
for (const [key, q] of QUERIES) {
  try {
    const res = await zai.functions.invoke('web_search', { query: q, num: 6 });
    out[key] = res.map(r => ({ name: r.name, url: r.url, host: r.host_name, snip: (r.snippet || '').slice(0, 180) }));
    console.log(`\n##### ${key}`);
    for (const r of out[key]) console.log(`- ${r.name} | ${r.url}\n  ${r.snip}`);
  } catch (e) {
    out[key] = { error: String(e?.message || e) };
    console.log(`\n##### ${key} ERROR: ${out[key].error}`);
  }
}
fs.writeFileSync(new URL('./catalog-sources.json', import.meta.url), JSON.stringify(out, null, 2));
console.log('\nSAVED catalog-sources.json');
