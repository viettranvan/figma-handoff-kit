import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, readFileSync, existsSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json'], { encoding: 'utf8' }));
const archive = resolve(packed.filename);
for (const file of ['bin/figma-export.js', 'figma-exporter-plugin/manifest.json', 'figma-exporter-plugin/code.js', 'figma-exporter-plugin/ui.html']) {
  assert.ok(packed.files.some(entry => entry.path === file), `Missing ${file}`);
}
const temp = realpathSync(mkdtempSync(join(tmpdir(), 'handoff-package-')));
try {
  execFileSync('npm', ['install', '--prefix', temp, '--no-audit', '--no-fund', '--ignore-scripts', archive], { stdio: 'inherit' });
  for (const command of Object.keys(pkg.bin)) {
    const executable = join(temp, 'node_modules', '.bin', command);
    execFileSync(executable, ['--help'], { cwd: temp, stdio: 'pipe' });
    execFileSync(executable, ['start', '--help'], { cwd: temp, stdio: 'pipe' });
    const manifest = execFileSync(executable, ['plugin', '--path'], { cwd: temp, encoding: 'utf8' }).trim();
    assert.ok(existsSync(manifest));
    assert.ok(manifest.startsWith(temp), 'Manifest must belong to the installed archive');
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
console.log(`Verified ${archive}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `archive=${archive}\n`);
