import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testsDir = join(__dirname, '..', 'tests');

const files = readdirSync(testsDir)
  .filter(f => f.endsWith('.test.js'))
  .sort();

let passed = 0, failed = 0;
const failures = [];

for (const file of files) {
  const result = spawnSync(process.execPath, [join(testsDir, file)], { stdio: 'inherit' });
  if (result.status === 0) {
    passed++;
  } else {
    failed++;
    failures.push(file);
  }
}

console.log(`\n══════════════════════════════════════════`);
console.log(`Test suite complete: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log(`Failed files:`);
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
}
