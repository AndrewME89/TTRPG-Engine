import fs from 'node:fs';

const requiredFiles = ['main.js', 'manifest.json', 'styles.css'];
let ok = true;

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) {
    console.error(`Missing release file: ${file}`);
    ok = false;
    continue;
  }
  const size = fs.statSync(file).size;
  if (size <= 0) {
    console.error(`Release file is empty: ${file}`);
    ok = false;
  }
}

if (!ok) process.exit(1);
console.log('Release files OK: main.js, manifest.json, styles.css');
