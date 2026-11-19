import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createBridge } from '../bin/bridge.js';
import { prepareExport } from '../bin/export-session.js';
const listen = server => new Promise(done => server.listen(0,'127.0.0.1',done));
const close = server => new Promise(done => server.close(done));
const url = 'https://www.figma.com/design/file/Design?node-id=1-2';

test('export starts its bridge, requests launch, waits for actual pairing and closes its own server', async () => {
 const root=mkdtempSync(join(tmpdir(),'auto-export-'));
 const probe=createServer();await listen(probe);const port=probe.address().port;await close(probe);
 const base=`http://127.0.0.1:${port}`;let launches=0;
 try {
  const session=await prepareExport({project:{root,projectId:'test',outputDir:'exports'},port,url,foreground:true,launch:async project=>{
   launches++;assert.equal(project.figmaUrl,url);
   assert.equal((await fetch(base+'/health').then(r=>r.json())).project_id,'test');
   await fetch(base+'/sync/pair',{method:'POST',body:JSON.stringify({project_id:'test',documentId:'doc',fileKey:'file',targetExport:true})});
  }});
  assert.equal(launches,1);await session.close();await assert.rejects(fetch(base+'/health'));
 } finally {rmSync(root,{recursive:true,force:true});}
});

test('existing paired bridge is reused and never closed; foreign project is rejected without launching', async () => {
 const root=mkdtempSync(join(tmpdir(),'reuse-export-'));
 const server=createBridge({root,output:join(root,'exports'),projectId:'test'});await listen(server);
 const port=server.address().port,base=`http://127.0.0.1:${port}`;
 let launches=0;const launch=async()=>{launches++;};
 try {
  await fetch(base+'/sync/pair',{method:'POST',body:JSON.stringify({project_id:'test',documentId:'doc',fileKey:'file'})});
  const session=await prepareExport({project:{root,projectId:'test'},port,url,launch});
  await session.close();assert.equal((await fetch(base+'/health')).status,200);assert.equal(launches,0);
  await assert.rejects(prepareExport({project:{root,projectId:'other'},port,url,launch}),/another project/);
  assert.equal(launches,0);
 } finally {await close(server);rmSync(root,{recursive:true,force:true});}
});

test('launch without plugin handshake times out and cleans up owned bridge', async () => {
 const root=mkdtempSync(join(tmpdir(),'no-plugin-'));const probe=createServer();await listen(probe);const port=probe.address().port;await close(probe);
 try {
  await assert.rejects(prepareExport({project:{root,projectId:'test',outputDir:'exports'},port,url,foreground:true,waitMs:0,launch:async()=>{}}),/handshake timed out/);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));
 } finally {rmSync(root,{recursive:true,force:true});}
});

test('fileKey fallback needs explicit confirmation or the exact remembered URL/document pair', async () => {
 const { pairedFileAccess }=await import('../bin/export-session.js');
 const project={figmaBindings:{file:'doc'}},target={fileKey:'file'};
 assert.equal(pairedFileAccess(project,target,{documentId:'doc'}),true);
 assert.equal(pairedFileAccess(project,target,{documentId:'different'}),false);
 assert.equal(pairedFileAccess(project,{fileKey:'other'},{documentId:'doc'}),false);
 assert.equal(pairedFileAccess({},target,{documentId:'doc'},true),true);
 assert.equal(pairedFileAccess(project,target,{documentId:'doc',fileKey:'wrong'},true),false);
 assert.equal(pairedFileAccess(project,target,{}),false);
});

test('background mode never launches Figma even when no plugin is connected', async () => {
 const root=mkdtempSync(join(tmpdir(),'background-export-'));const probe=createServer();await listen(probe);const port=probe.address().port;await close(probe);
 let launches=0;
 try {
  await assert.rejects(prepareExport({project:{root,projectId:'test',outputDir:'exports'},port,url,waitMs:0,launch:async()=>{launches++;}}),/Background mode never opens files or menus/);
  assert.equal(launches,0);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));
 } finally {rmSync(root,{recursive:true,force:true});}
});
