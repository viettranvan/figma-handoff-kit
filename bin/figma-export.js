#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { ensurePortAvailable } from './port.js';
import { addProject, chooseProject, registerProject, showProjects } from './projects.js';
import { createBridge } from './bridge.js';
import { configureFigma, openFigma } from './open-figma.js';
import { help } from './help.js';
import { showPlugin } from './plugin.js';
import { parseExportUrl } from './export-url.js';
import { prepareExport, pairedFileAccess } from './export-session.js';
import { setupUser } from './user-install.js';

const configName = 'figma-export.config.json';
const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a value`);
  return args[index + 1];
}
function findConfig() {
  let dir = process.cwd();
  while (true) {
    const candidate = resolve(dir, configName);
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) return null;
    dir = dirname(dir);
  }
}
try {
  const command = args[0];
  const commands = ['start', 'serve', 'plugin', 'sync', 'init', 'open', 'setup', 'projects', 'export'];
  if (command === '--version') {
    if (args.length !== 1) throw new Error('Usage: figma-handoff --version');
    console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  } else if (command === 'help') {
    if (args.length > 2 || (args[1] && !commands.includes(args[1]))) throw new Error('Usage: figma-handoff help [start|serve|plugin|sync|init|open|setup|projects|export]');
    console.log(help(args[1]));
  } else if (!command || args.includes('--help') || args.includes('-h')) {
    console.log(help(command));
  } else if (command === 'projects') {
    await showProjects(args.slice(1));
  } else if (command === 'setup') {
    setupUser(args.slice(1));
  } else if (command === 'plugin') {
    await showPlugin(args.slice(1));
  } else if (command === 'init') {
    const root = process.cwd();
    const legacy = resolve(root, configName);
    if (existsSync(legacy)) {
      const config = JSON.parse(readFileSync(legacy, 'utf8'));
      registerProject({ root, projectId: config.projectId, outputDir: config.outputDir });
      console.log('Existing configuration registered globally; legacy file was left unchanged.');
    } else {
      const project = await addProject(root, option('--output-dir') ?? (process.stdin.isTTY ? undefined : 'figma/exports'));
      console.log(`Project registered globally.\nExports: ${resolve(root, project.outputDir)}\nRun figma-handoff start to launch the bridge.`);
    }
  } else if (command === 'sync' || command === 'export') {
    const target = command === 'export' ? parseExportUrl(args[1]) : null;
    const profilePath = option('--profile');
    const platform = option('--platform') ?? 'web';
    if (!['web', 'android', 'ios', 'mobile', 'all'].includes(platform)) throw new Error('Platform must be web, android, ios, mobile or all.');
    const scale = Number(option('--scale') || 2);
    if (![1, 2, 3].includes(scale)) throw new Error('Scale must be 1, 2 or 3.');
    const project = await chooseProject(args.includes('--select'));
    const port = Number(process.env.FIGMA_EXPORT_PORT || 3055);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid bridge port.');
    const base = `http://127.0.0.1:${port}`;
    const prepared = target ? await prepareExport({project,port,url:args[1],foreground:args.includes('--foreground')}) : null;
    try {
      const health = await fetch(base+'/health', {signal:AbortSignal.timeout(3000)}).then(r=>r.json());
      if (health.project_id !== project.projectId) throw new Error('Bridge is serving a different project. Run figma-handoff start --select first.');
      if (platform !== 'web' && !health.capabilities?.includes('platform-export-v1')) throw new Error('Restart the bridge with a version that supports platform export.');
      const response = await fetch(base+'/sync/start', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project_id:project.projectId,...(platform !== 'web' ? {platform} : {}),...(target ? {target,scale,force:args.includes('--force'),allowPairedFile:pairedFileAccess(project,target,prepared.status,args.includes('--paired-file'))} : {})}),signal:AbortSignal.timeout(3000)});
      const started = await response.json();
      if (!response.ok) throw new Error(started.error || 'Start failed; update bridge and plugin.');
      if (target && !prepared.status.fileKey && args.includes('--paired-file') && prepared.status.documentId) {
        registerProject({...project,figmaBindings:{...project.figmaBindings,[target.fileKey]:prepared.status.documentId}});
        console.log('Remembered your confirmed URL-to-document mapping for this project on this device.');
      }
      console.log(`${target ? 'Section export' : 'Sync'} requested. Keep Figma and the plugin open.`);
      const exportStartedAt = Date.now();
      const deadline = Date.now()+15*60*1000;
      while (Date.now()<deadline) {
        await new Promise(resolve=>setTimeout(resolve,1000));
        const status = await fetch(base+'/sync/status',{signal:AbortSignal.timeout(3000)}).then(r=>r.json());
        if (status.job?.id !== started.id) throw new Error('Sync session changed');
        if(status.job.state==='error') throw new Error(status.job.error);
        if(status.job.state==='done') {
          if (profilePath) {
            if (!status.job.profile) throw new Error('Export completed but plugin supplied no phase timings; reopen the updated plugin.');
            writeFileSync(resolve(profilePath), JSON.stringify(status.job.profile,null,2)+'\n');
          }
          const stats=status.job.stats || {}; console.log(`Export complete · ${stats.checked || 0} checked · ${stats.saved || 0} saved · ${stats.skipped || 0} skipped · ${((Date.now()-exportStartedAt)/1000).toFixed(1)}s`); break; }
        // A busy/background Figma can delay heartbeats while its export is still running.
        if(!status.connected && status.job.state !== 'running') throw new Error('Plugin disconnected; reopen it before retrying.');
        if(Date.now()+1000>=deadline) throw new Error('Sync timed out; inspect the plugin before retrying.');
      }
    } finally { await prepared?.close(); }
  } else if (command === 'start' || command === 'serve' || command === 'open') {
    const configPath = findConfig();
    let project;
    if (configPath && !args.includes('--select')) {
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      project = registerProject({ root: dirname(configPath), projectId: config.projectId, outputDir: config.outputDir }, { automatic: true });
    } else {
      project = await chooseProject(args.includes('--select'));
    }
    if (command === 'open') {
      if (process.platform !== 'darwin') throw new Error('open currently supports macOS + Figma Desktop only.');
      project = await configureFigma(project, option('--url'));
    }
    const root = project.root;
    const config = project;
    const output = resolve(root, project.outputDir);
    const port = Number(process.env.FIGMA_EXPORT_PORT || 3055);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid bridge port.');
    await ensurePortAvailable(port);
    const server = createBridge({ output, projectId: config.projectId, root });
    server.on('error', error => {
      console.error(error.code === 'EADDRINUSE' ? `Port ${port} became busy. Run figma-handoff start again.` : error.message);
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', async () => {
      console.log(`\n  Figma Handoff Kit  ● Ready\n\n  Project   ${root.split(/[\\/]/).pop()}\n  Output    ./${relative(root, output)}\n  Bridge    http://localhost:${port}\n\n  Keep this terminal running on the same computer as Figma.\n  Exports are saved locally in the selected project.\n  Ctrl+C to stop\n`);
      if (command === 'open') {
        try { await openFigma(project,{foreground:true}); } catch (error) { console.error(`Cannot open Figma Desktop: ${error.message}`); server.close(); process.exitCode = 1; }
      }
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
  } else {
    console.error(`Unknown command: ${command}\nRun figma-handoff --help for usage.`);
    process.exitCode = 1;
  }
} catch (err) { console.error(args[0] === 'sync' && /fetch failed/.test(err.message) ? 'Cannot reach the bridge. Run figma-handoff start for this project, then enable CLI sync in the plugin.' : err.message); process.exitCode = 1; }
