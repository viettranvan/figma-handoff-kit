import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function userInstallPaths(home = homedir()) {
  const prefix = join(home, '.local', 'share', 'figma-handoff-kit');
  return { prefix, bin: join(home, '.local', 'bin'), packageDir: join(prefix, 'node_modules', 'figma-handoff-kit') };
}
const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";

// Explicit per-command prefix: never change npm's global prefix or nvm settings.
export function installForUser({ home = homedir(), packageSpec = 'figma-handoff-kit@latest', run = execFileSync, platform = process.platform } = {}) {
  if (platform === 'win32') throw new Error('User installation currently supports macOS/Linux. On Windows, keep using npm install -g figma-handoff-kit.');
  const paths = userInstallPaths(home);
  if (packageSpec === 'figma-handoff-kit@latest') {
    const version = JSON.parse(run('npm', ['view', 'figma-handoff-kit@latest', 'version', '--json', '--prefer-online'], { encoding: 'utf8' }));
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a stable npm version');
    const currentFile = join(paths.packageDir, 'package.json');
    if (existsSync(currentFile)) {
      const current = JSON.parse(readFileSync(currentFile, 'utf8')).version;
      const difference = version.split('.').map((part, i) => Number(part) - Number(current.split('.')[i])).find(value => value !== 0);
      if (difference < 0) throw new Error(`Registry latest (${version}) is older than installed ${current}. No downgrade performed.`);
    }
    packageSpec = `figma-handoff-kit@${version}`;
  }
  const commands = ['figma-handoff', 'figma-export'];
  // Do not overwrite unrelated commands in the user's shared bin directory.
  for (const command of commands) {
    const path = join(paths.bin, command);
    if (existsSync(path) || (() => { try { lstatSync(path); return true; } catch { return false; } })()) {
      if (lstatSync(path).isSymbolicLink() || !readFileSync(path, 'utf8').includes('# Figma Handoff Kit user launcher')) {
        throw new Error(`Existing command is not a Figma Handoff Kit user launcher: ${path}. Resolve it before setup.`);
      }
    }
  }
  mkdirSync(paths.prefix, { recursive: true });
  run('npm', ['install', '--prefix', paths.prefix, '--prefer-online', '--no-audit', '--no-fund', '--ignore-scripts', packageSpec], { cwd: paths.prefix, stdio: 'inherit' });
  const pkg = JSON.parse(readFileSync(join(paths.packageDir, 'package.json'), 'utf8'));
  if (pkg.name !== 'figma-handoff-kit') throw new Error('Installed package identity mismatch');
  for (const file of ['bin/figma-export.js', 'figma-exporter-plugin/manifest.json', 'figma-exporter-plugin/code.js', 'figma-exporter-plugin/ui.html']) {
    if (!existsSync(join(paths.packageDir, file))) throw new Error(`Installed package is missing ${file}`);
  }
  mkdirSync(paths.bin, { recursive: true });
  const target = resolve(paths.packageDir, 'bin/figma-export.js');
  const launcher = `#!/bin/sh\n# Figma Handoff Kit user launcher\nexec node ${quote(target)} "$@"\n`;
  for (const command of commands) {
    const path = join(paths.bin, command);
    writeFileSync(path + '.tmp', launcher, { mode: 0o755 });
    renameSync(path + '.tmp', path);
  }
  return { ...paths, version: pkg.version, manifest: join(paths.packageDir, 'figma-exporter-plugin/manifest.json') };
}

export function setupUser(args) {
  if (args.length) throw new Error('Usage: figma-handoff setup');
  const installed = installForUser();
  console.log(`Installed figma-handoff-kit ${installed.version}\nManifest: ${installed.manifest}\n\nEnsure this comes AFTER nvm initialization in your shell profile:\n  export PATH="$HOME/.local/bin:$PATH"\nThen open a new terminal (or export PATH now) and run:\n  figma-handoff --version\n  figma-handoff plugin --open\n\nRe-import this manifest once after migrating from npm global.\nFuture updates: figma-handoff setup\nRestart the bridge and reopen the Figma plugin after updating.\nNode.js >=20 must remain available in PATH. Project registration and exports are preserved.`);
}
