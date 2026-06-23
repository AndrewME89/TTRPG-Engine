import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Root main.js/styles.css are the SOURCE OF TRUTH.
// src/ is a mirror kept for reference only.
// This script syncs root → src and does a syntax check.

// Syntax check first
try {
  execFileSync(process.execPath, ['--check', 'main.js'], { stdio: 'pipe' });
  console.log('ok    main.js syntax');
} catch (e) {
  console.error('FAIL  main.js syntax:', e.stderr?.toString().trim() || e.message);
  process.exit(1);
}

// Copy root → src (mirror, never overwrite root)
const copies = [
  ['main.js', 'src/main.js'],
  ['styles.css', 'src/styles.css'],
];
for (const [from, to] of copies) {
  if (!fs.existsSync(from)) { console.error(`Source missing: ${from}`); process.exit(1); }
  if (!fs.existsSync(path.dirname(to))) fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`Synced ${from} → ${to}`);
}

if (!fs.existsSync('assets')) fs.mkdirSync('assets', { recursive: true });
console.log('Build complete (root → src synced).');
