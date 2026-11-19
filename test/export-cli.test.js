import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,realpathSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

test('URL CLI waits through delayed heartbeat, completes and reuses explicit document confirmation',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'export-cli-')));const registry=join(root,'registry.json');
 writeFileSync(registry,JSON.stringify({version:1,projects:[{root,projectId:'test',outputDir:'exports'}]}));
 let current=null,polls=0;const requests=[];
 const server=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/health')return res.end(JSON.stringify({project_id:'test',protocol_version:1}));
  if(req.url==='/sync/status'){
   if(current)polls++;
   return res.end(JSON.stringify({connected:!current,fileKey:null,documentId:'doc',job:current?{id:'job',state:polls<2?'running':'done',stats:{checked:7,saved:7,skipped:0},profile:{engineRevision:'test',screens:[{nodeId:'1:2',tokenMs:3}]}}:null}));
  }
  if(req.url==='/sync/start'){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   current=JSON.parse(Buffer.concat(chunks));requests.push(current);polls=0;
   return res.end(JSON.stringify({id:'job',state:'queued'}));
  }
  res.writeHead(404);res.end('{}');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const run=extra=>new Promise((done,reject)=>{
  const child=spawn(process.execPath,[fileURLToPath(new URL('../bin/figma-export.js',import.meta.url)),'export','https://www.figma.com/design/file/Design?node-id=1-2','--force','--scale','3',...extra],{cwd:root,env:{...process.env,FIGMA_EXPORT_REGISTRY:registry,FIGMA_EXPORT_PORT:String(server.address().port)}});
  let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);child.on('error',reject);child.on('exit',code=>done({code,output}));
 });
 try{
  const first=await run(['--paired-file']);assert.equal(first.code,0,first.output);assert.match(first.output,/7 saved · 0 skipped/);
  assert.equal(requests[0].force,true);assert.equal(requests[0].scale,3);assert.deepEqual(requests[0].target,{fileKey:'file',nodeId:'1:2'});
  assert.equal(JSON.parse(readFileSync(registry,'utf8')).projects[0].figmaBindings.file,'doc');
  current=null;const second=await run(['--profile',join(root,'profile.json')]);assert.equal(second.code,0,second.output);assert.equal(requests[1].allowPairedFile,true);
  assert.equal(JSON.parse(readFileSync(join(root,'profile.json'),'utf8')).screens[0].tokenMs,3);
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/health`)).status,200);
 }finally{await new Promise(r=>server.close(r));rmSync(root,{recursive:true,force:true});}
});
