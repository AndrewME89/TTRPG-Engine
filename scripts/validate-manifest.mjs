import fs from 'node:fs';

const manifestPath = 'manifest.json';
if (!fs.existsSync(manifestPath)) {
  console.error('Missing manifest.json');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const required = ['id', 'name', 'version', 'minAppVersion', 'description', 'author', 'isDesktopOnly'];
const missing = required.filter((key) => manifest[key] === undefined || manifest[key] === null || manifest[key] === '');

if (missing.length) {
  console.error(`manifest.json is missing required value(s): ${missing.join(', ')}`);
  process.exit(1);
}

if (!/^[a-z0-9-]+$/.test(manifest.id)) {
  console.error('manifest.id should be lowercase kebab-case, e.g. ttrpg-engine');
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+/.test(manifest.version)) {
  console.error('manifest.version should be semver-like, e.g. 2.1.0');
  process.exit(1);
}

console.log(`Manifest OK: ${manifest.name} ${manifest.version}`);
