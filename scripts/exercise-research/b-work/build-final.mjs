// Build final groupB-strength.json: merge content + verified videos, validate, dedupe.
import { EXERCISES } from './exercises.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const state = JSON.parse(fs.readFileSync(path.join(DIR, 'videos-map.json'), 'utf8'));
const OUT = path.join(DIR, '..', 'groupB-strength.json');

const EQUIPMENT = new Set(['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'band', 'bench', 'smith', 'medicine_ball', 'other']);
const CATEGORY = new Set(['push', 'pull', 'legs', 'core', 'cardio', 'fullbody']);
const DIFFICULTY = new Set(['beginner', 'intermediate', 'advanced']);
const MUSCLE = new Set(['سینه', 'سرشانه', 'پشت', 'جلو بازو', 'پشت بازو', 'پا', 'باسن', 'ساق', 'شکم', 'کل بدن', 'گردن و کول']);
const DISCIPLINES = new Set(['powerlifting', 'crossfit', 'general', 'fitness', 'calisthenics']);

const seenVideo = new Map(); // videoId -> key
const errors = [];
const final = [];

for (const ex of EXERCISES) {
  const rec = state[ex.key];
  if (!rec?.chosen?.videoId) { errors.push(`${ex.key}: no chosen video`); continue; }
  const { videoId, ytTitle, ytChannel } = rec.chosen;
  if (!ytTitle || !ytChannel) { errors.push(`${ex.key}: missing ytTitle/ytChannel`); continue; }

  // enums
  if (!EQUIPMENT.has(ex.equipment)) errors.push(`${ex.key}: bad equipment ${ex.equipment}`);
  if (!CATEGORY.has(ex.category)) errors.push(`${ex.key}: bad category ${ex.category}`);
  if (!DIFFICULTY.has(ex.difficulty)) errors.push(`${ex.key}: bad difficulty ${ex.difficulty}`);
  if (!MUSCLE.has(ex.muscle)) errors.push(`${ex.key}: bad muscle ${ex.muscle}`);
  for (const m of [ex.muscle, ...ex.secondary]) if (!MUSCLE.has(m)) errors.push(`${ex.key}: bad secondary ${m}`);
  for (const d of ex.disciplines) if (!DISCIPLINES.has(d)) errors.push(`${ex.key}: bad discipline ${d}`);
  if (ex.core && (!ex.description || !ex.tips)) errors.push(`${ex.key}: core without description/tips`);
  if (!ex.core && (ex.description || ex.tips)) errors.push(`${ex.key}: non-core with text`);
  // half-space sanity: name must contain " (English)" and fa must not contain parentheses
  const name = `${ex.fa} (${ex.en})`;
  if (!/[A-Za-z]/.test(ex.en) || /[A-Za-z()]/.test(ex.fa)) errors.push(`${ex.key}: name format issue`);

  // dedupe by videoId
  if (seenVideo.has(videoId)) { errors.push(`${ex.key}: DUPLICATE videoId ${videoId} with ${seenVideo.get(videoId)}`); }
  else seenVideo.set(videoId, ex.key);

  final.push({
    en: ex.en, fa: ex.fa, name,
    muscle: ex.muscle, secondary: ex.secondary, equipment: ex.equipment, category: ex.category,
    pattern: ex.pattern, difficulty: ex.difficulty, core: ex.core, disciplines: ex.disciplines,
    ytVideoId: videoId, ytTitle, ytChannel,
    description: ex.core ? ex.description : '',
    tips: ex.core ? ex.tips : '',
  });
}

if (errors.length) {
  console.log('VALIDATION ERRORS:');
  for (const e of errors) console.log(' -', e);
}
fs.writeFileSync(OUT, JSON.stringify(final, null, 2));
console.log(`\nWROTE ${OUT}`);
console.log(`total=${final.length} core=${final.filter(x => x.core).length} uniqueVideos=${new Set(final.map(x => x.ytVideoId)).size} errors=${errors.length}`);
