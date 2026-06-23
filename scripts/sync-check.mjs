import fs from 'node:fs';

let ok = true;

function check(label, condition, msg) {
  if (!condition) { console.error(`FAIL  ${label}: ${msg}`); ok = false; }
  else console.log(`ok    ${label}`);
}

for (const file of ['main.js', 'styles.css']) {
  const root = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const src  = fs.existsSync(`src/${file}`) ? fs.readFileSync(`src/${file}`, 'utf8') : null;
  if (!root) { check(`root ${file}`, false, 'missing'); continue; }
  if (!src)  { check(`src/${file}`, false, 'missing — run: npm run build'); continue; }
  check(`root vs src/${file} in sync`, root === src, 'files differ — run: npm run build');
}

if (!ok) process.exit(1);
console.log('\nSource files are in sync.');
