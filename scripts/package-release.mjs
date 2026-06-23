import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const releaseDir = 'release';
const stageDir = path.join(releaseDir, manifest.id);
const zipPath = path.join(releaseDir, `${manifest.id}-${manifest.version}-manual-install.zip`);

// Run build first to ensure root → src sync is current
try {
  execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
} catch (err) {
  console.error('Build failed — aborting release packaging.');
  process.exit(1);
}

fs.rmSync(releaseDir, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });

// Also include src/ so sync-check passes after unzip
const srcDir = 'src';
if (!fs.existsSync(srcDir)) { fs.mkdirSync(srcDir, { recursive: true }); }

for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  fs.copyFileSync(file, path.join(stageDir, file));
}

if (fs.existsSync('assets')) {
  fs.cpSync('assets', path.join(stageDir, 'assets'), { recursive: true });
}

// Include src/ so npm run sync-check passes after unzip
if (fs.existsSync('src')) {
  fs.cpSync('src', path.join(stageDir, 'src'), { recursive: true });
}

if (fs.existsSync('data')) {
  fs.cpSync('data', path.join(stageDir, 'data'), { recursive: true });
} else {
  console.warn('Warning: data/ folder not found — reference data will not be included in release.');
}

try {
  execFileSync('zip', ['-r', path.basename(zipPath), manifest.id], { cwd: releaseDir, stdio: 'inherit' });
} catch (err) {
  console.error('Could not create ZIP. Make sure the zip command is available, or manually zip release/ttrpg-engine/.');
  process.exit(1);
}

console.log(`Created ${zipPath}`);
