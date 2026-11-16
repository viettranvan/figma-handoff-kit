import { createServer } from 'node:net';
import { execFileSync } from 'node:child_process';
import { select, confirm, isCancel, note } from '@clack/prompts';
import { setTimeout as delay } from 'node:timers/promises';

export function portBusy(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', err => err.code === 'EADDRINUSE' ? resolve(true) : reject(err));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(() => resolve(false)));
  });
}
export function listeners(port) {
  try {
    if (process.platform === 'win32') {
      const script = `Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Get-Process -Id $_ | Select-Object Id,ProcessName } | ConvertTo-Json -Compress`;
      const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 3000 }).trim();
      return raw ? [JSON.parse(raw)].flat().map(p => ({ pid: p.Id, name: p.ProcessName })) : [];
    }
    const output = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpct'], { encoding: 'utf8', timeout: 3000 });
    const result = [];
    for (const line of output.split('\n')) {
      if (line.startsWith('p')) result.push({ pid: Number(line.slice(1)), name: 'unknown' });
      if (line.startsWith('c') && result.length) result.at(-1).name = line.slice(1);
    }
    return result.filter((p, i) => result.findIndex(q => q.pid === p.pid) === i);
  } catch { return []; }
}
export async function ensurePortAvailable(port) {
  if (!await portBusy(port)) return;
  const owners = listeners(port);
  if (process.stdin.isTTY && process.stdout.isTTY) {
    note(owners.map(p => `${p.name} · PID ${p.pid}`).join("\n") || "Unknown process", `Port ${port} is in use`);
  } else {
    console.error(`Port ${port} is already in use.`);
  }
  if (!process.stdin.isTTY || !owners.length) {
    throw new Error(owners.length ? 'Run serve in an interactive terminal to choose Stop or Exit.' : 'Cannot identify the listener; no process was stopped.');
  }
  const action = await select({
    message: 'How would you like to continue?',
    initialValue: 'exit',
    options: [
      { value: 'stop', label: 'Stop listener and start bridge', hint: `Free port ${port}` },
      { value: 'exit', label: 'Exit', hint: 'Keep existing service running' }
    ]
  });
  if (isCancel(action) || action !== 'stop') throw new Error('Exited; existing service was left running.');
  const approved = await confirm({
    message: `Stop ${owners.map(p => `${p.name} (PID ${p.pid})`).join(', ')}? This may stop another application.`,
    initialValue: false
  });
  if (isCancel(approved) || !approved) throw new Error('Cancelled; existing service was left running.');
    const current = listeners(port);
    if (JSON.stringify(current) !== JSON.stringify(owners)) throw new Error('Listener changed; run serve again. No process was stopped.');
    for (const owner of owners) {
      if (owner.pid === process.pid || owner.pid <= 1) throw new Error('Refusing to stop this process.');
      process.kill(owner.pid, 'SIGTERM');
      if (process.platform !== 'win32') {
        try { process.kill(owner.pid, 'SIGCONT'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    }
    for (let attempt = 0; attempt < 50; attempt++) {
      if (!await portBusy(port)) return;
      await delay(100);
    }
    throw new Error(`Port ${port} is still busy after 5 seconds; no force kill was attempted.`);

}
