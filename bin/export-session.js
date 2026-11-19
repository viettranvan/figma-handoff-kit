import { resolve } from 'node:path';
import { createBridge } from './bridge.js';
import { openFigma } from './open-figma.js';

export function pairedFileAccess(project, target, status, explicit = false) {
  return !status.fileKey && (explicit || Boolean(status.documentId && project.figmaBindings?.[target.fileKey] === status.documentId));
}

export async function prepareExport({ project, port, url, launch = openFigma, waitMs = 90000, foreground = false }) {
  const base = `http://127.0.0.1:${port}`;
  let server;
  const close = async () => { if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); } };
  try {
    let health;
    try { health = await fetch(base + '/health', { signal: AbortSignal.timeout(3000) }).then(r => r.json()); }
    catch (error) {
      if (error.cause?.code !== 'ECONNREFUSED') throw new Error(`Cannot inspect port ${port}; ${error.message}`);
      server = createBridge({ output: resolve(project.root, project.outputDir), projectId: project.projectId, root: project.root });
      await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
      health = { project_id: project.projectId, protocol_version: 1 };
      console.log(`Bridge started for ${project.root}`);
    }
    if (health.project_id !== project.projectId || health.protocol_version !== 1) throw new Error('Port is serving another project or incompatible bridge. Stop it or run start --select.');
    let status = await fetch(base + '/sync/status').then(r => r.json());
    const fileKey = new URL(url).pathname.split('/')[2];
    const ready = () => status.connected && (status.fileKey ? status.fileKey === fileKey : !project.figmaBindings?.[fileKey] || status.documentId === project.figmaBindings[fileKey]);
    if (!ready()) {
      if (status.job && ['queued','running'].includes(status.job.state)) throw new Error('An export is already active. Wait for it to finish before opening another file.');
      if (foreground) {
        console.log('Opening Figma and requesting plugin launch…');
        await launch({ ...project, figmaUrl: url }, { foreground:true });
      } else {
        console.log('Background mode: waiting for the plugin to reconnect. No Figma file or menu will be opened.');
      }
      const deadline = Date.now() + waitMs;
      while (!ready() && Date.now() < deadline) {
        await new Promise(done => setTimeout(done, 1000));
        status = await fetch(base + '/sync/status', { signal: AbortSignal.timeout(3000) }).then(r => r.json());
      }
      if (!ready()) throw new Error('Plugin handshake timed out. Open Figma Handoff Kit in the target file yourself, or explicitly use --foreground to permit opening Figma. Background mode never opens files or menus.');
    }
    return { close, status };
  } catch (error) { await close(); throw error; }
}
