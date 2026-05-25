import fs from 'node:fs';
import path from 'node:path';

const copies = [
  ['src/main.js', 'main.js'],
  ['src/styles.css', 'styles.css'],
];

for (const [from, to] of copies) {
  if (!fs.existsSync(from)) {
    console.error(`Build source missing: ${from}`);
    process.exit(1);
  }
  fs.copyFileSync(from, to);
  console.log(`Copied ${from} -> ${to}`);
}

if (!fs.existsSync('assets')) fs.mkdirSync('assets', { recursive: true });
console.log('Build complete.');
