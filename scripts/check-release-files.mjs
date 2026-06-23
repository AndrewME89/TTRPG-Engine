import fs from 'node:fs';
import path from 'node:path';

let ok = true;

function check(label, condition, errorMsg) {
  if (!condition) { console.error(`FAIL  ${label}: ${errorMsg}`); ok = false; }
  else console.log(`ok    ${label}`);
}

// ── Required plugin files ──────────────────────────────────────────────────────
for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  const exists = fs.existsSync(file);
  const size   = exists ? fs.statSync(file).size : 0;
  check(file, exists && size > 0, exists ? 'file is empty' : 'file missing');
}

// ── Manifest shape ─────────────────────────────────────────────────────────────
try {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  check('manifest.id',          !!manifest.id,          'missing id');
  check('manifest.version',     !!manifest.version,     'missing version');
  check('manifest.minAppVersion', !!manifest.minAppVersion, 'missing minAppVersion');
  check('manifest.name',        !!manifest.name,        'missing name');
} catch (e) {
  console.error('FAIL  manifest.json: could not parse JSON —', e.message);
  ok = false;
}

// ── versions.json ──────────────────────────────────────────────────────────────
check('versions.json', fs.existsSync('versions.json'), 'file missing');

// ── Reference data files ───────────────────────────────────────────────────────
const dataFiles = ['actions.json','backgrounds.json','conditions.json','deities.json',
  'equipment.json','feats.json','languages.json','objects.json','races.json',
  'rewards.json','senses.json','skills.json','spells.json','traps.json','vehicles.json'];
const dataDir = 'data';
if (!fs.existsSync(dataDir)) {
  console.error('FAIL  data/ folder: missing — reference data will not load');
  ok = false;
} else {
  for (const df of dataFiles) {
    const dp = path.join(dataDir, df);
    const exists = fs.existsSync(dp);
    const size = exists ? fs.statSync(dp).size : 0;
    check(`data/${df}`, exists && size > 0, exists ? 'file is empty' : 'file missing');
  }
}

// ── Asset folder and structure ─────────────────────────────────────────────────
const assetRoot = path.join('assets', 'tile-map');
check('assets/tile-map folder',  fs.existsSync(assetRoot), 'assets/tile-map/ not found');
check('assets/tile-map/README.md', fs.existsSync(path.join(assetRoot, 'README.md')), 'README.md missing from tile-map assets');

const expectedCategories = ['terrain', 'buildings', 'interiors', 'dungeons', 'props', 'tokens', 'vegetation', 'roads', 'water'];
for (const cat of expectedCategories) {
  check(`assets/tile-map/${cat}/`, fs.existsSync(path.join(assetRoot, cat)), `category subfolder missing`);
}

// ── Tile image asset count ─────────────────────────────────────────────────────
const IMAGE_EXTS = new Set(['.png','.jpg','.jpeg','.webp','.gif','.svg']);
function countImages(dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { n += countImages(path.join(dir, entry.name)); }
    else if (IMAGE_EXTS.has(path.extname(entry.name).toLowerCase())) n++;
  }
  return n;
}
const imgCount = countImages(assetRoot);
if (imgCount === 0) {
  console.warn('WARN  tile-map images: 0 image files found — plugin will use emoji fallback tiles only. Add .png/.jpg/.webp files to assets/tile-map/ for production image tiles.');
} else {
  console.log(`ok    tile-map images: ${imgCount} image file(s) found`);
}

// ── Syntax check on main.js ───────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
try {
  execFileSync(process.execPath, ['--check', 'main.js'], { stdio: 'pipe' });
  console.log('ok    main.js syntax');
} catch (e) {
  console.error('FAIL  main.js syntax:', e.stderr?.toString().trim() || e.message);
  ok = false;
}

if (!ok) {
  console.error('\nRelease check FAILED — fix the issues above before packaging.');
  process.exit(1);
}
console.log('\nAll release checks passed.');
