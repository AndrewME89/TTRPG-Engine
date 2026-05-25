import fs from 'node:fs';

for (const dir of ['release', 'dist', 'build', 'coverage']) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`Removed ${dir}/`);
  }
}
