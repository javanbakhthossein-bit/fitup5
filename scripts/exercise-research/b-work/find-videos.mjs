// YouTube search-scrape + oEmbed verification pipeline (resumable)
import { EXERCISES } from './exercises.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(DIR, 'videos-map.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Preferred reputable channels (substring, lowercase). Index = priority rank.
const PRIORITY = [
  'alan thrall', 'starting strength', 'athlean', 'jeff nippard', 'renaissance periodization',
  'calgary barbell', 'juggernaut', 'catalyst athletics', 'squat university', 'barbell logic',
  'zack telander', 'torokhtiy', 'crossfit', 'calisthenicmovement', 'fitnessprogramer',
  'clarence', 'all things gym', 'brian alsruhe', 'omar isuf', 'strength side',
  'ewelina', 'fitnessfaq', 'mindful mover', 'cali move', 'fitnessprogramer',
];

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; }
}
function saveState(s) { fs.writeFileSync(STATE, JSON.stringify(s, null, 1)); }

function extractInitialData(html) {
  const marker = 'ytInitialData';
  const i = html.indexOf(marker);
  if (i < 0) return null;
  const start = html.indexOf('{', i);
  if (start < 0) return null;
  // brace matching with string awareness
  let depth = 0, inStr = false, esc = false;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { try { return JSON.parse(html.slice(start, j + 1)); } catch { return null; } } }
  }
  return null;
}

function collectVideoRenderers(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const n of node) collectVideoRenderers(n, out); return out; }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'videoRenderer' && v && v.videoId) {
      const title = v.title?.runs?.[0]?.text || v.title?.simpleText || '';
      const channel = v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || '';
      const len = v.lengthText?.simpleText || '';
      out.push({ videoId: v.videoId, pageTitle: title, channel, len });
    } else collectVideoRenderers(v, out);
  }
  return out;
}

async function ytSearch(query) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en&gl=US&sp=EgIQAQ%253D%253D`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('yt search http ' + res.status);
  const html = await res.text();
  const data = extractInitialData(html);
  if (!data) return [];
  const vids = collectVideoRenderers(data);
  return vids.filter(v => v.videoId && v.videoId.length === 11).slice(0, 8);
}

async function oembed(videoId) {
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const j = await res.json();
    return { videoId, ytTitle: j.title, ytChannel: j.author_name };
  } catch { return null; }
}

function channelScore(ch) {
  const c = (ch || '').toLowerCase();
  for (let i = 0; i < PRIORITY.length; i++) if (c.includes(PRIORITY[i])) return i;
  return 100;
}

const state = loadState();
const onlyArg = process.argv[2] || ''; // optional: comma-separated keys
const only = onlyArg ? new Set(onlyArg.split(',')) : null;
const force = process.argv.includes('--force');
let done = 0, failed = [];

for (const ex of EXERCISES) {
  if (only && !only.has(ex.key)) continue;
  if (!force && state[ex.key]?.chosen) { done++; continue; }
  try {
    const results = await ytSearch(ex.query);
    const candidates = [];
    let verified = 0;
    for (const r of results) {
      if (candidates.some(c => c.videoId === r.videoId)) continue;
      if (verified >= 4 || candidates.length >= 6) break;
      const o = await oembed(r.videoId);
      if (o) {
        verified++;
        candidates.push({ ...r, ...o });
      }
      await new Promise(s => setTimeout(s, 250));
    }
    if (!candidates.length) {
      failed.push({ key: ex.key, reason: 'no oEmbed-verified candidates', results: results.length });
      state[ex.key] = { query: ex.query, candidates: results.map(r => ({ ...r, ok: false })), chosen: null };
    } else {
      candidates.sort((a, b) => channelScore(a.ytChannel) - channelScore(b.ytChannel));
      state[ex.key] = { query: ex.query, candidates, chosen: candidates[0] };
      done++;
    }
    saveState(state);
    const ch = state[ex.key]?.chosen;
    console.log(`${ex.key}: ${ch ? ch.ytChannel + ' | ' + ch.ytTitle.slice(0, 70) + ' | ' + ch.videoId : 'FAILED (cands=' + candidates.length + ', raw=' + results.length + ')'}`);
  } catch (e) {
    failed.push({ key: ex.key, reason: String(e?.message || e) });
    console.log(`${ex.key}: ERROR ${e?.message || e}`);
    saveState(state);
  }
  await new Promise(s => setTimeout(s, 500));
}
console.log(`\nDONE done=${done} failed=${failed.length}`);
if (failed.length) console.log(JSON.stringify(failed, null, 1));
