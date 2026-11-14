// KURA OPS — the entrypoint (Node 22, standard library only). The game is the
// static files in this directory's game/ folder: ES modules the browser loads
// with three.js 0.187.0 from the import map, no build step, no network. This
// program hands the game in: it copies game/ and screenshots/ from beside this
// file to /output and writes /output/dossier.json, the summary the judge reads,
// with the vendored make.fun library.
//
// Entry for the threejs-fps-02 bounty ("Make the best three.js tactical FPS",
// $1,000, opened 15 Nov 2026 04:30 WIB, deadline 17 Nov 2026 04:30 WIB).
// Rebuilt in this session from the threejs-fps-01 game with real gameplay
// changes: a round-by-round hare difficulty ramp, the Perisai Tempurung shield
// pickup at mid, and a polished HUD (shield chip + planted-pod timer label).
//
// Play it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps: only text_max_bytes shapes the bytes; the others refuse
// an entry the scorer would refuse (more than 4 screenshots or one over 256 KiB;
// more than 993 files in game/ or 48 MiB of game files in all, since game/ counts
// beside /output's own 1000-entry cap with screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, game_max_files: 993, game_max_bytes: 50331648 }),
);

// Post-build verification, so a bad bundle fails here with a plain message
// instead of reaching the scorer: the dossier must parse, the screenshots
// must exist and be within the cap, and game/ must stay within its caps.
const dossier = JSON.parse(readFileSync(join(out, 'dossier.json'), 'utf8'));
const shots = readdirSync(join(out, 'screenshots')).filter((f) => /\.(jpe?g|png)$/i.test(f));
if (shots.length === 0) throw new Error('verification: screenshots/ holds no image');
let shotBytes = 0;
for (const f of shots) {
  const size = statSync(join(out, 'screenshots', f)).size;
  if (size > 262144) throw new Error(`verification: screenshot ${f} is ${size} bytes, over the 256 KiB cap`);
  shotBytes += size;
}
let gameFiles = 0;
let gameBytes = 0;
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else { gameFiles += 1; gameBytes += statSync(p).size; }
  }
};
walk(join(out, 'game'));
if (gameFiles > 993) throw new Error(`verification: game/ holds ${gameFiles} files, over the 993 cap`);
if (gameBytes > 50331648) throw new Error(`verification: game/ is ${gameBytes} bytes, over the 48 MiB cap`);
console.log(
  `KURA OPS -02 bundle OK: dossier ${statSync(join(out, 'dossier.json')).size} bytes, ` +
  `${shots.length} screenshot(s) ${shotBytes} bytes, game/ ${gameFiles} files ${gameBytes} bytes.`,
);
