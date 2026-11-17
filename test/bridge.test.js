import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../bin/bridge.js';
test('Node bridge preserves identity, checks hashes, writes binary/notes/catalog and rejects mismatched projects', async () => {
 const output = mkdtempSync(join(tmpdir(), 'figma-node-'));
 const server = createBridge({ output, projectId: 'test', root: output });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 const url = `http://127.0.0.1:${server.address().port}`;
 const payload = { project_id: 'test', document: { id: 'file', name: 'Copy' }, node_path: [{ id: '1:2', name: 'Screen' }], content_hash: 'before' };
 const post = async (path, data = payload) => { const response = await fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); return { status: response.status, ...await response.json() }; };
 try {
  assert.equal((await (await fetch(url + '/health')).json()).runtime, 'node');
  const hashed = await post('/check', { ...payload, snapshot: '123456789' });
  assert.equal(hashed.hash, '15e2b0d3c33891ebb0f1ef609ec419420c20e320ce94c65fbc8c3312448eb225');
  assert.equal((await post('/check')).unchanged, false);
  payload.files = [{ name: 'assets/icon.png', type: 'base64', content: Buffer.from('png').toString('base64') }, { name: 'components_used.json', content: JSON.stringify({ Button: { totalUsageCount: 1 } }) }, { name: 'fonts_guide.json', content: JSON.stringify({ fonts: [{ family: 'Inter', weights: [400] }] }) }];
  const saved = await post('/save'); assert.equal(saved.status, 200);
  assert.equal((await post('/check')).unchanged, true);
  payload.document.name = 'Renamed'; payload.node_path[0].name = 'Changed';
  assert.equal((await post('/check')).unchanged, true);
  assert.equal((await post('/save')).saved_to, saved.saved_to);
  payload.content_hash = 'after'; assert.equal((await post('/check')).unchanged, false);
  payload.content_hash = 'before'; unlinkSync(join(saved.saved_to, 'assets/icon.png'));
  assert.equal((await post('/check')).unchanged, false);
  assert.equal((await post('/save-notes', { ...payload, filename: 'flow_notes.md', content: 'Notes' })).status, 200);
  assert.equal(readFileSync(join(saved.saved_to, 'flow_notes.md'), 'utf8'), 'Notes');
  assert.ok(JSON.parse(readFileSync(join(output, 'DESIGN_SYSTEM_CATALOG.json'))).Button);
  assert.match(readFileSync(join(output, 'FONTS_SETUP.md'), 'utf8'), /Inter/);
  assert.equal((await post('/check', { ...payload, project_id: 'wrong' })).status, 400);
  assert.equal((await post('/save', { ...payload, files: [{ name: '../escape', content: 'bad' }] })).status, 400);
 } finally { await new Promise(resolve => server.close(resolve)); rmSync(output, { recursive: true }); }
});

test('same Figma document can export independently to A and B; copied manifests are rejected', async () => {
 const { copyFileSync } = await import('node:fs');
 const dir = mkdtempSync(join(tmpdir(), 'figma-two-destinations-'));
 const a = join(dir, 'A'), b = join(dir, 'B');
 const servers = [createBridge({ output:a, projectId:'A', root:dir }), createBridge({ output:b, projectId:'B', root:dir })];
 try {
  for (const server of servers) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const payload = { document:{id:'same-figma-file',name:'Design'},node_path:[{id:'1:2',name:'Screen'}],snapshot:'same-design' };
  const post = async (index, project, route='/check') => {
   const r = await fetch(`http://127.0.0.1:${servers[index].address().port}${route}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,project_id:project,files:[{name:'spec.json',content:'{}'}]})});
   return { status:r.status,...await r.json() };
  };
  assert.equal((await post(0,'A','/save')).status,200);
  const original = readFileSync(join(a,'export-manifest.json'),'utf8');
  assert.equal((await post(1,'A')).status,400);
  assert.equal((await post(1,'B','/save')).status,200);
  assert.equal(JSON.parse(readFileSync(join(b,'export-manifest.json'))).projectId,'B');
  copyFileSync(join(a,'export-manifest.json'),join(b,'export-manifest.json'));
  const conflict = await post(1,'B');
  assert.match(conflict.error,/Output belongs to another project/);
  assert.equal(readFileSync(join(a,'export-manifest.json'),'utf8'),original);
 } finally {
  for (const server of servers) await new Promise(resolve=>server.close(resolve));
  rmSync(dir,{recursive:true,force:true});
 }
});
