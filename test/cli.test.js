import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const cli = fileURLToPath(new URL('../bin/figma-export.js', import.meta.url));
test('global init stores paths outside repo, preserves identity and rejects traversal', () => {
 const dir = mkdtempSync(join(tmpdir(), 'figma-cli-'));
 try {
  const registry = join(dir, 'state', 'projects.json');
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, env: { ...process.env, FIGMA_EXPORT_REGISTRY: registry }, encoding: 'utf8' });
  assert.equal(run('init', '--output-dir', '../escape').status, 1);
  assert.equal(run('init', '--output-dir', 'docs/figma').status, 0);
  assert.equal(existsSync(join(dir, 'figma-export.config.json')), false);
  const first = JSON.parse(readFileSync(registry)).projects[0];
  assert.equal(first.outputDir, 'docs/figma');
  assert.equal(run('init', '--output-dir', 'docs/figma').status, 0);
  assert.equal(JSON.parse(readFileSync(registry)).projects[0].projectId, first.projectId);
 } finally { rmSync(dir, { recursive: true }); }
});

test('help is detailed and subcommand help has no filesystem or server side effects', () => {
 const dir = mkdtempSync(join(tmpdir(), 'figma-help-'));
 try {
  for (const args of [['--help'], ['-h'], ['init', '--help'], ['serve', '--help']]) {
   const result = spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', timeout: 3000 });
   assert.equal(result.status, 0, result.stderr);
   assert.match(result.stdout, /USAGE/);
   assert.match(result.stdout, /EXAMPLES|QUICK START/);
  }
  assert.equal(existsSync(join(dir, 'figma/exports')), false);
 } finally { rmSync(dir, { recursive: true }); }
});
