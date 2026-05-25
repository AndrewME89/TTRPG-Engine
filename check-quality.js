#!/usr/bin/env node
// Quality gate for the TTRPG Engine Tile Map Builder upgrade.
// Run: node check-quality.js
// Exit 0 = pass, Exit 1 = fail.

const fs = require('fs');
const path = require('path');

const MAIN = path.join(__dirname, 'main.js');
const CSS  = path.join(__dirname, 'styles.css');

if (!fs.existsSync(MAIN)) { console.error('ERROR: main.js not found'); process.exit(1); }
if (!fs.existsSync(CSS))  { console.error('ERROR: styles.css not found'); process.exit(1); }

const src = fs.readFileSync(MAIN, 'utf8');
const css = fs.readFileSync(CSS, 'utf8');

let failures = 0;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  failures++;
}

function pass(msg) {
  console.log(`PASS: ${msg}`);
}

function check(condition, passMsg, failMsg) {
  if (condition) pass(passMsg); else fail(failMsg);
}

// ── Banned patterns (legacy procedural map generator) ─────────────────────
check(!src.includes('Generate SVG Map'),     'No "Generate SVG Map" button present',     '"Generate SVG Map" still appears — remove the old procedural generator');
check(!src.includes('Regenerate SVG Map'),   'No "Regenerate SVG Map" button present',   '"Regenerate SVG Map" still appears — remove the old procedural generator');
check(!src.includes('generateSvgMap'),       'No generateSvgMap() function present',     'generateSvgMap() still present — remove the old procedural generator function');
check(!src.includes('renderSvgMapSection'),  'No renderSvgMapSection() present',         'renderSvgMapSection() still present — remove it');

// ── TILE_ASSETS usage constraint ──────────────────────────────────────────
// TILE_ASSETS must exist only as a legacy const/fallback, not as the primary palette source.
// The primary source must be loadTileAssets / scanPluginTileAssets.
check(src.includes('scanPluginTileAssets'),  'scanPluginTileAssets() is defined',         'scanPluginTileAssets() not found — asset scanner missing');
check(src.includes('loadTileAssets'),        'loadTileAssets() is defined',               'loadTileAssets() not found — async loader missing');
check(src.includes('fallbackEmojiTileAssets'), 'fallbackEmojiTileAssets() is defined',  'fallbackEmojiTileAssets() not found — sync fallback missing');

// TILE_ASSETS must still exist for backward compat, but the palette must NOT iterate it directly
// renderTileMapBuilder comes AFTER renderGeography in the file
const tmStart = src.indexOf('function renderTileMapBuilder');
// Find end: next top-level function definition after renderTileMapBuilder
const tmEnd = src.indexOf('\nfunction ', tmStart + 1);
const paletteSection = src.slice(tmStart, tmEnd > tmStart ? tmEnd : src.length);
check(!paletteSection.includes('TILE_ASSETS.forEach'), 'Palette does not iterate TILE_ASSETS directly', 'Palette still iterates TILE_ASSETS.forEach — switch to tileAssets variable from loadTileAssets()');
check(paletteSection.includes('tileAssets'), 'Palette uses tileAssets variable', 'Palette does not use tileAssets variable from loadTileAssets()');

// ── Footprint-aware tile placement ────────────────────────────────────────
check(paletteSection.includes('widthCells'), 'widthCells used in tile placement', 'widthCells not found in renderTileMapBuilder — footprint sizing missing');
check(paletteSection.includes('heightCells'), 'heightCells used in tile placement', 'heightCells not found in renderTileMapBuilder — footprint sizing missing');
// Ensure new tiles don't hardcode w:GRID,h:GRID without footprint multiplication
const hardcodeW = /w\s*:\s*GRID\s*,\s*h\s*:\s*GRID/.test(paletteSection);
check(!hardcodeW, 'Tile placement does not hardcode w:GRID,h:GRID', 'Tile placement hardcodes w:GRID,h:GRID without footprint — use widthCells*GRID');

// ── Image support in palette ──────────────────────────────────────────────
check(paletteSection.includes('te-palette-thumb'), 'Palette renders image thumbnails (.te-palette-thumb)', 'te-palette-thumb not used in palette — emoji-only palette');
check(paletteSection.includes('<img') || paletteSection.includes("ce(tileBtn, 'img'"), 'Palette creates <img> elements for real assets', 'No <img> creation in palette — only emoji fallback');

// ── Asset root referenced ─────────────────────────────────────────────────
check(src.includes('TILE_ASSET_ROOT'), 'TILE_ASSET_ROOT constant is defined', 'TILE_ASSET_ROOT not found — asset root path missing');
check(paletteSection.includes('TILE_ASSET_ROOT') || src.includes("assetRoot: TILE_ASSET_ROOT"), 'TILE_ASSET_ROOT is wired into map state or scanner', 'TILE_ASSET_ROOT not referenced in tile map context');

// ── object-fit: contain in CSS ────────────────────────────────────────────
check(css.includes('object-fit:contain'), 'CSS uses object-fit:contain for tile images', 'object-fit:contain missing from styles.css — tile images may distort');

// ── te-tile-img class in CSS ──────────────────────────────────────────────
check(css.includes('.te-tile-img'), '.te-tile-img CSS rule present', '.te-tile-img CSS rule missing');

// ── Canvas is fixed size (not percentage or min-height only) ─────────────
const canvasRule = css.includes('.te-map-canvas {') || css.includes('.te-map-canvas{');
check(canvasRule, '.te-map-canvas CSS rule present', '.te-map-canvas CSS rule missing');
check(css.includes('width:1800px') || css.includes('width: 1800px'), 'Canvas uses fixed 1800px width', 'Canvas does not use fixed 1800px width — scrollable canvas may be broken');

// ── Missing asset indicator ───────────────────────────────────────────────
check(src.includes('is-missing-asset'), 'Missing asset indicator (.is-missing-asset) used', '.is-missing-asset not used — broken tiles have no visual indicator');

// ── Saved maps section in renderGeography ────────────────────────────────
const geoStart = src.indexOf('function renderGeography');
const geoSection = src.slice(geoStart, src.indexOf('const regionFields', geoStart));
check(geoSection.includes('Saved Maps'), '"Saved Maps" section exists in renderGeography', '"Saved Maps" section missing from renderGeography');
check(geoSection.includes('Open in Builder') || geoSection.includes('tileLayout'), 'Saved maps have a load/open action', 'No "Open in Builder" action on saved map cards');

// ── runDiagnostics includes tile checks ───────────────────────────────────
const diagStart = src.indexOf('async function runDiagnostics');
const diagSection = src.slice(diagStart, src.indexOf('// ── Entity picker helpers', diagStart));
check(diagSection.includes('TILE_ASSET_ROOT') || diagSection.includes('tile asset'), 'runDiagnostics checks tile asset health', 'runDiagnostics does not check tile assets');
check(diagSection.includes('scanPluginTileAssets') || diagSection.includes('assetFolderExists'), 'runDiagnostics scans for tile assets', 'runDiagnostics does not scan for tile assets');

// ── Summary ───────────────────────────────────────────────────────────────
console.log('');
if (failures === 0) {
  console.log(`✅  All quality checks passed.`);
} else {
  console.log(`❌  ${failures} check(s) failed.`);
  process.exit(1);
}
