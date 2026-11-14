// KURA OPS — the entrypoint (Node 22, standard library only). The game is
// the static files in this directory's game/ folder: ES modules the browser
// loads with three.js 0.187.0 from the import map, no build step, no network.
// This program hands the game in: it copies game/ and screenshots/ from
// beside this file to /output and writes /output/dossier.json, the summary
// the judge reads, with the vendored make.fun library.
//
// Entry for the threejs-fps-02 bounty ("Make the best three.js tactical FPS",
// $1,000, opened 15 Nov 2026 04:30 WIB, deadline 17 Nov 2026 04:30 WIB).
// Rewritten in a fresh session after the bounty opened, so the thinking in
// this session reproduces the game code: a round-based tactical FPS with a
// Perisai Tempurung shield pickup at mid, a hare difficulty ramp that
// tightens a runaway match, and a polished HUD (shield chip + planted-pod
// timer label + shield/pod dots on the minimap).
//
// Play it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's own caps, passed to buildDossier: only text_max_bytes shapes
// the bytes; the others refuse an entry the scorer would refuse (more than 4
// screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of
// game files in all, since game/ counts beside /output's own 1000-entry cap
// with screenshots/ and dossier.json).
const DOSSIER_OPTIONS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};
const SHOT_PATTERN = /\.(jpe?g|png)$/i;

function copyBundle() {
  mkdirSync(out, { recursive: true });
  cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
  mkdirSync(join(out, 'screenshots'), { recursive: true });
  if (existsSync(join(here, 'screenshots'))) {
    cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
  }
}

function listShots() {
  return readdirSync(join(out, 'screenshots')).filter((f) => SHOT_PATTERN.test(f));
}

// Walk game/ once, counting files and bytes for the caps.
function measureGame() {
  let files = 0;
  let bytes = 0;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else {
        files += 1;
        bytes += statSync(p).size;
      }
    }
  };
  walk(join(out, 'game'));
  return { files, bytes };
}

// Read a JPEG or PNG's pixel size from its own header bytes (no dependency):
// PNG keeps width/height at the start of IHDR; JPEG in the first SOF0/SOF2
// segment (height first, then width, both big-endian).
function imageSize(buf: Buffer): { width: number; height: number } {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if (marker === 0xc0 || marker === 0xc2) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  throw new Error('verification: cannot read image dimensions (not JPEG/PNG)');
}

// Post-build verification, so a bad bundle fails here with a plain message
// instead of reaching the scorer: the dossier must parse and stay within its
// caps (1.5 MiB total, 163,840 bytes of text), the screenshots must exist,
// stay within their caps (at most 4, each under 256 KiB, long side at most
// 1280 px, short side at least 480 px) and match the sha256 the dossier
// records for them, game/index.html must stay under 1 MiB, and game/ must
// stay within its caps.
function verifyBundle() {
  const dossierPath = join(out, 'dossier.json');
  const dossierBytes = statSync(dossierPath).size;
  if (dossierBytes > 1572864) throw new Error(`verification: dossier is ${dossierBytes} bytes, over the 1.5 MiB cap`);
  const dossier = JSON.parse(readFileSync(dossierPath, 'utf8'));
  const textBytes = Buffer.byteLength(dossier.text ?? '', 'utf8');
  if (textBytes > 163840) throw new Error(`verification: dossier text is ${textBytes} bytes, over the 163,840 cap`);
  const shots = listShots();
  if (shots.length === 0) throw new Error('verification: screenshots/ holds no image');
  if (shots.length > 4) throw new Error(`verification: screenshots/ holds ${shots.length} images, over the 4 cap`);
  let shotBytes = 0;
  for (const f of shots) {
    const buf = readFileSync(join(out, 'screenshots', f));
    if (buf.length > 262144) throw new Error(`verification: screenshot ${f} is ${buf.length} bytes, over the 256 KiB cap`);
    const { width, height } = imageSize(buf);
    const long = Math.max(width, height);
    const short = Math.min(width, height);
    if (long > 1280) throw new Error(`verification: screenshot ${f} is ${width}x${height}, long side over 1280`);
    if (short < 480) throw new Error(`verification: screenshot ${f} is ${width}x${height}, short side under 480`);
    shotBytes += buf.length;
    // The dossier must describe the very files it ships: its sha256 per image
    // has to match the screenshot on disk, or the judge reads a different still.
    const entry = (dossier.images ?? []).find((im: { name: string }) => im.name === f);
    if (!entry) throw new Error(`verification: dossier has no image entry for ${f}`);
    const actual = createHash('sha256').update(buf).digest('hex');
    if (entry.sha256 !== actual) throw new Error(`verification: dossier sha256 for ${f} does not match the file`);
  }
  const indexBytes = statSync(join(out, 'game', 'index.html')).size;
  if (indexBytes > 1048576) throw new Error(`verification: game/index.html is ${indexBytes} bytes, over the 1 MiB cap`);
  const game = measureGame();
  if (game.files > 993) throw new Error(`verification: game/ holds ${game.files} files, over the 993 cap`);
  if (game.bytes > 50331648) throw new Error(`verification: game/ is ${game.bytes} bytes, over the 48 MiB cap`);
  console.log(
    `KURA OPS -02 bundle OK: dossier ${dossierBytes} bytes (text ${textBytes}), ` +
    `${shots.length} screenshot(s) ${shotBytes} bytes, game/ ${game.files} files ${game.bytes} bytes.`,
  );
}

copyBundle();
writeFileSync(join(out, 'dossier.json'), buildDossier(out, DOSSIER_OPTIONS));
verifyBundle();
