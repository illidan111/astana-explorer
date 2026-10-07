import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const files = ['app.js', 'data.js', 'serve.mjs', 'playwright.config.js'];
let failures = 0;

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], {
    cwd: root,
    encoding: 'utf8'
  });
  if (result.error || result.status !== 0) {
    failures += 1;
    console.error(`Syntax failed: ${file}`);
    console.error(result.error?.message || result.stderr.trim() || `Node exited with ${result.signal || result.status}.`);
  } else {
    console.log(`Syntax OK: ${file}`);
  }
}

process.exitCode = failures ? 1 : 0;
