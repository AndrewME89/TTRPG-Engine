import fs from 'node:fs';

const next = process.argv[2];
if (!next) {
  console.error('Usage: node scripts/version-bump.mjs 2.1.1');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
manifest.version = next;
fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = next;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

let versions = {};
if (fs.existsSync('versions.json')) versions = JSON.parse(fs.readFileSync('versions.json', 'utf8'));
versions[next] = manifest.minAppVersion;
fs.writeFileSync('versions.json', JSON.stringify(versions, null, 2) + '\n');

console.log(`Version bumped to ${next}`);
