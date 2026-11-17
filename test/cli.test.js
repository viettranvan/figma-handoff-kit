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
  for (const args of [['--help'], ['-h'], ['init', '--help'], ['serve', '--help'], ['start', '--help']]) {
   const result = spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', timeout: 3000 });
   assert.equal(result.status, 0, result.stderr);
   assert.match(result.stdout, /USAGE/);
   assert.match(result.stdout, /EXAMPLES|QUICK START/);
  }
  assert.equal(existsSync(join(dir, 'figma/exports')), false);
 } finally { rmSync(dir, { recursive: true }); }
});

test('start and serve both launch the bridge for a registered project', async () => {
 const { spawn } = await import('node:child_process');
 const { createServer } = await import('node:net');
 const dir = mkdtempSync(join(tmpdir(), 'figma-start-'));
 const env = { ...process.env, FIGMA_EXPORT_REGISTRY: join(dir, 'projects.json') };
 try {
  assert.equal(spawnSync(process.execPath, [cli, 'init'], { cwd: dir, env }).status, 0);
  for (const command of ['start', 'serve']) {
   const probe = createServer();
   await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
   const port = probe.address().port;
   await new Promise(resolve => probe.close(resolve));
   const child = spawn(process.execPath, [cli, command], { cwd: dir, env: { ...env, FIGMA_EXPORT_PORT: String(port) } });
   const closed = new Promise(resolve => child.once('close', resolve));
   try {
    await new Promise((resolve, reject) => {
     const timer = setTimeout(() => reject(new Error('Bridge did not start')), 5000);
     let output = '';
     child.stdout.on('data', data => { output += data; if (output.includes('Ready')) { clearTimeout(timer); resolve(); } });
     child.once('error', error => { clearTimeout(timer); reject(error); });
     child.once('exit', code => { clearTimeout(timer); reject(new Error(`Bridge exited: ${code}`)); });
    });
    const health = await fetch(`http://127.0.0.1:${port}/health`).then(r => r.json());
    assert.equal(health.project_id, JSON.parse(readFileSync(env.FIGMA_EXPORT_REGISTRY)).projects[0].projectId);
   } finally { child.kill('SIGTERM'); await closed; }
  }
 } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('help and version work outside projects without creating state', () => {
 const dir = mkdtempSync(join(tmpdir(), 'figma-info-'));
 const registry = join(dir, 'projects.json');
 const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, env: { ...process.env, FIGMA_EXPORT_REGISTRY: registry }, encoding: 'utf8', timeout: 3000 });
 try {
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
  assert.equal(run('--version').stdout.trim(), version);
  assert.equal(run('--version').status, 0);
  assert.match(run('help').stdout, /QUICK START/);
  for (const command of ['start', 'serve', 'plugin', 'sync', 'init', 'open']) {
   assert.equal(run('help', command).status, 0);
   assert.equal(run('help', command).stdout, run(command, '--help').stdout);
  }
  assert.equal(run('help', 'unknown').status, 1);
  assert.equal(run('help', 'start', 'extra').status, 1);
  assert.equal(existsSync(registry), false);
 } finally { rmSync(dir, { recursive: true, force: true }); }
});
