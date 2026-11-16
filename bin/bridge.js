import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, realpathSync, lstatSync } from 'node:fs';
import { resolve, relative, dirname, basename, isAbsolute, sep } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
const hash = data => createHash('sha256').update(data).digest('hex');
const sanitize = name => { const value = String(name).replace(/[\\/*?:"<>|]/g, '_').trim(); if (['', '.', '..'].includes(value)) return 'unnamed'; let prefix = ''; for (const char of value) { if (Buffer.byteLength(prefix + char) > 120) return prefix + '--' + hash(value).slice(0, 12); prefix += char; } return value; };
const load = (path, fallback) => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
const atomic = (path, value) => { writeFileSync(path + '.tmp', JSON.stringify(value, null, 2)); renameSync(path + '.tmp', path); };
export function createBridge({ output, projectId, root }) {
  output = resolve(output);
  mkdirSync(output, { recursive: true });
  output = realpathSync(output);
  function safe(base, path) {
    const dest = resolve(base, path);
    const rel = relative(base, dest);
    if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw new Error('Invalid export path');
    let cursor = base;
    for (const part of rel.split(sep)) {
      cursor = resolve(cursor, part);
      if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error('Symlink export paths are not allowed');
    }
    return dest;
  }
  function target(payload) {
    if (payload.project_id !== projectId) throw new Error('Project changed; reconnect plugin before exporting');
    if (!payload.document?.id || !Array.isArray(payload.node_path) || !payload.node_path.length) throw new Error('Document identity and node_path are required');
    const file = safe(output, 'export-manifest.json');
    const manifest = load(file, { version: 1, projectId, documents: {} });
    if (manifest.projectId !== projectId) throw new Error('Output belongs to another project');
    const id = String(payload.document.id);
    if (['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('Invalid document ID');
    const doc = manifest.documents[id] ??= { path: `${sanitize(payload.document.name || 'Figma')}--${hash(id).slice(0, 12)}`, nodes: {} };
    doc.name = payload.document.name;
    let parts = [doc.path];
    let parentId = null;
    for (const node of payload.node_path) {
      const nodeId = String(node.id);
      if (!node.id || ['__proto__', 'constructor', 'prototype'].includes(nodeId)) throw new Error('Invalid node ID');
      let entry = doc.nodes[nodeId];
      if (!entry) {
        parts.push(`${sanitize(node.name)}--${hash(nodeId).slice(0, 12)}`);
        entry = doc.nodes[nodeId] = { path: parts.join('/') };
      } else parts = entry.path.split('/');
      Object.assign(entry, { name: node.name, parentId });
      parentId = nodeId;
    }
    const dest = safe(output, parts.join('/'));
    atomic(file, manifest);
    return dest;
  }
  function unchanged(payload, dest) {
    try {
      const state = load(safe(dest, '.export-checkpoint.json'), null);
      return Boolean(payload.content_hash && state?.hash === payload.content_hash && state.files?.length && state.files.every(f => hash(readFileSync(safe(dest, f.name))) === f.hash));
    } catch { return false; }
  }
  function guides(dest, files) {
    const components = files.find(f => f.name === 'components_used.json');
    if (components) {
      const path = safe(output, 'DESIGN_SYSTEM_CATALOG.json');
      const catalog = load(path, {});
      for (const [name, data] of Object.entries(JSON.parse(components.content))) {
        if (['__proto__', 'constructor', 'prototype'].includes(name)) continue;
        const entry = catalog[name] ??= { componentSet: name, description: data.description || 'Shared Design System Component', totalUsageCount: 0, variantsEncountered: [], screensUsedIn: [], sampleSnippets: [], reuseRules: data.reuseRules || `Always reuse <${name}>. Do not create duplicate markup.` };
        entry.totalUsageCount += data.totalUsageCount ?? 1;
        const screen = relative(output, dest).split(sep).join('/');
        if (!entry.screensUsedIn.includes(screen)) entry.screensUsedIn.push(screen);
        for (const variant of data.variantsEncountered || []) {
          const prior = entry.variantsEncountered.find(v => JSON.stringify(v.properties) === JSON.stringify(variant.properties));
          if (prior) prior.count = (prior.count || 0) + (variant.count || 1); else entry.variantsEncountered.push(variant);
        }
        for (const sample of data.sampleUsages || []) if (sample.recommendedSnippet && !entry.sampleSnippets.includes(sample.recommendedSnippet)) entry.sampleSnippets.push(sample.recommendedSnippet);
      }
      atomic(path, catalog);
      const lines = ['# Project Design System & Component Reuse Guide', '', '> Consult this catalog and reuse existing components before implementing screens.', '', '| Component | Usage | Screens |', '| --- | --- | --- |'];
      const entries = Object.entries(catalog).sort((a,b) => b[1].totalUsageCount - a[1].totalUsageCount);
      for (const [name, item] of entries) lines.push(`| ${name} | ${item.totalUsageCount} | ${item.screensUsedIn.length} |`);
      for (const [name, item] of entries) lines.push('', `## ${name}`, item.description, '', item.reuseRules, '', '### Screens', ...item.screensUsedIn.map(p => `- ${p}`), '', '### Variants', '```json', JSON.stringify(item.variantsEncountered, null, 2), '```', '', '### Recommended snippets', '```jsx', ...item.sampleSnippets.slice(0,3), '```');
      writeFileSync(safe(output, 'DESIGN_SYSTEM_GUIDE.md'), lines.join('\n') + '\n');
    }
    const fonts = files.find(f => f.name === 'fonts_guide.json');
    if (fonts) {
      const f = JSON.parse(fonts.content);
      writeFileSync(safe(output, 'FONTS_SETUP.md'), ['# Project Fonts & Typography Setup', '', ...(f.fonts || []).map(font => `- ${font.family}: ${(font.weights || []).join(', ')}`), '', '## HTML', '```html', f.htmlLinkTag || '', '```', '', '## CSS', '```css', f.cssImportRule || '', `:root { --font-sans: ${f.cssFontFamilyStack || 'sans-serif'}; }`, 'body { font-family: var(--font-sans); }', '```', '', '## Tailwind', '```javascript', `module.exports = { theme: { extend: { fontFamily: { sans: [${f.cssFontFamilyStack || '"sans-serif"'}] } } } };`, '```'].join('\n'));
    }
  }
  let queue = Promise.resolve();
  let session = null;
  let job = null;
  return createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Type', 'application/json');
    const send = (status, value) => { res.writeHead(status); res.end(JSON.stringify(value)); };
    if (req.method === 'OPTIONS') return send(204, {});
    if (req.method === 'GET' && ['/', '/health'].includes(req.url)) return send(200, { status: 'ok', exports_dir: output, project_id: projectId, project_name: basename(root), project_root: root, runtime: 'node', protocol_version: 1 });
    if (req.method === 'GET' && req.url === '/sync/status') return send(200, { job, connected: !!session && Date.now() - session.seen < 10000 });
    if (req.method !== 'POST'  || !['/check', '/save', '/save-notes', '/sync/pair', '/sync/poll', '/sync/start', '/sync/result', '/sync/unpair'].includes(req.url)) return send(404, { error: 'Not found' });
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 128 * 1024 * 1024) throw new Error('Upload exceeds 128 MiB'); chunks.push(chunk); }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (req.url.startsWith('/sync/')) {
        if (payload.project_id !== projectId) throw new Error('Wrong project');
        if (req.url === '/sync/start') {
          if (req.headers.origin) throw new Error('Sync must be requested by the local CLI');
          if (!session || Date.now() - session.seen > 10000) throw new Error('Open the plugin, choose Save to project and enable CLI sync first.');
          if (job && ['queued','running'].includes(job.state)) throw new Error('A sync is already running');
          job = { id: randomUUID(), state:'queued', documentId:session.documentId, createdAt:Date.now() };
          return send(200, job);
        }
        if (req.url === '/sync/pair') {
          if (!payload.documentId) throw new Error('Document ID required');
          if (session && Date.now()-session.seen < 10000) throw new Error('Another Figma document is paired; disable it first.');
          session = { documentId:payload.documentId, token:randomUUID(), seen:Date.now() };
          return send(200, { token:session.token });
        }
        if (!session || session.token !== payload.token || session.documentId !== payload.documentId) throw new Error('Pairing expired; enable CLI sync again.');
        if (req.url === '/sync/unpair') {
          session = null;
          if (job && ['queued', 'running'].includes(job.state)) {
            job.state = 'error'; job.error = 'CLI sync was disabled in the plugin; an export already started may still finish.';
          }
          return send(200, { success: true });
        }
        session.seen = Date.now();
        if (req.url === '/sync/poll') {
          if (job?.state === 'queued') { job.state='running'; return send(200,{ job }); }
          return send(200,{ job:null });
        }
        if (req.url === '/sync/result') {
          if (!job || job.id !== payload.jobId) throw new Error('Unknown sync');
          job.state = payload.error ? 'error' : 'done'; job.error = payload.error; job.stats = payload.stats;
          return send(200,{success:true});
        }
      }
      const task = queue.then(() => {
        const dest = target(payload);
        if (req.url === '/check') {
          if (typeof payload.snapshot === 'string') payload.content_hash = hash(payload.snapshot);
          return { unchanged: unchanged(payload, dest), hash: payload.content_hash };
        }
        mkdirSync(dest, { recursive: true });
        if (req.url === '/save-notes') {
          const file = safe(dest, sanitize(payload.filename || 'flow_notes.md'));
          writeFileSync(file, payload.content || ''); return { success: true, file };
        }
        if (!Array.isArray(payload.files) || !payload.files.length) throw new Error('No files provided');
        const state = safe(dest, '.export-checkpoint.json');
        if (existsSync(state)) unlinkSync(state);
        const records = [];
        for (const file of payload.files) {
          if (file.name.startsWith('/') || file.name.split('/').some(p => ['.', '..'].includes(p))) throw new Error('Invalid filename');
          const path = safe(dest, file.name.split('/').filter(Boolean).map(sanitize).join('/'));
          if (path === state) throw new Error('Reserved checkpoint filename');
          mkdirSync(dirname(path), { recursive: true });
          const content = file.type === 'base64' ? Buffer.from(file.content, 'base64') : Buffer.from(file.content, 'utf8');
          writeFileSync(path, content);
          records.push({ name: relative(dest, path).split(sep).join('/'), hash: hash(content) });
        }
        guides(dest, payload.files);
        if (payload.content_hash) atomic(state, { hash: payload.content_hash, files: records });
        console.log(`  Saved ${relative(output, dest)} (${records.length} files)`);
        return { success: true, saved_to: dest, files: records.map(f => f.name) };
      });
      queue = task.catch(() => {});
      send(200, await task);
    } catch (error) { send(400, { success: false, error: error.message }); }
  });
}
