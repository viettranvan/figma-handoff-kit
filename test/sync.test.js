import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBridge} from '../bin/bridge.js';
test('sync requires pairing and dispatches each job once with a completion result',async()=>{
 const output=mkdtempSync(join(tmpdir(),'sync-'));
 const server=createBridge({output,root:output,projectId:'test'});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const post=async(path,body={})=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project_id:'test',...body})});return {status:r.status,...await r.json()};};
 try{
 assert.equal((await post('/sync/start')).status,400);
 const pair=await post('/sync/pair',{documentId:'copy'});
 const auth={documentId:'copy',token:pair.token};
 assert.equal((await post('/sync/pair',{documentId:'copy'})).status,400);
 const start=await post('/sync/start');assert.equal(start.state,'queued');
 assert.equal((await post('/sync/poll',{...auth,token:'bad'})).status,400);
 assert.equal((await post('/sync/poll',auth)).job.id,start.id);
 assert.equal((await post('/sync/poll',auth)).job,null);
 assert.equal((await post('/sync/start')).status,400);
 await post('/sync/result',{...auth,jobId:start.id,stats:{checked:2,saved:1,skipped:1}});
 const result=await fetch(base+'/sync/status').then(r=>r.json());assert.equal(result.job.state,'done');
 await post('/sync/unpair',auth);
 assert.equal((await post('/sync/start')).status,400);
 assert.equal((await post('/sync/poll',auth)).status,400);
 }finally{await new Promise(r=>server.close(r));rmSync(output,{recursive:true});}
});
