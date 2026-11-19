import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const html=readFileSync(new URL('../figma-exporter-plugin/ui.html',import.meta.url),'utf8');
function setup() {
 const calls=[],messages=[],checkbox={checked:false};let poll;
 const context={syncToken:null,documentId:'doc',documentFileKey:null,documentEngineRevision:'css-prefetch-v1',syncJob:null,pendingCompletion:null,trustedProjects:new Set(),projectId:'A',delivery:'local',isServerOnline:true,isExporting:false,stats:{checked:7,saved:7,skipped:0},
  document:{getElementById:()=>checkbox},words:(_vi,en)=>en,parent:{postMessage:msg=>messages.push(msg)},addLog(){},toast(){},
  syncRequest:async(route,body)=>{calls.push({route,body});return route==='/sync/pair'?{token:'token'}:{job:null};},startExport:async()=>{},setInterval:fn=>{poll=fn;}};
 vm.createContext(context);
 vm.runInContext(html.slice(html.indexOf('    let cliProblem ='),html.indexOf('    let delivery =')),context);
 vm.runInContext(html.slice(html.indexOf('    let syncPolling=false;'),html.indexOf('  </script>')),context);
 return {context,calls,messages,checkbox,poll:()=>poll()};
}
test('only remembered current project auto-pairs; ZIP choice prevents pairing',async()=>{
 const {context,calls,checkbox,poll}=setup();await poll();assert.equal(calls.length,0);
 context.trustedProjects.add('B');await poll();assert.equal(calls.length,0);
 context.trustedProjects.add('A');context.delivery='zip';await poll();assert.equal(calls.length,0);
 context.delivery='local';await poll();assert.equal(context.syncToken,'token');assert.equal(checkbox.checked,true);
 assert.deepEqual(calls.map(c=>c.route),['/sync/pair','/sync/poll']);
});
test('revoking permission removes remembered project and unpairs',async()=>{
 const {context,calls,messages,poll}=setup();context.trustedProjects.add('A');context.syncToken='token';
 await context.disableSync();await poll();assert.equal(context.syncToken,null);assert.equal(context.trustedProjects.has('A'),false);
 assert.equal(calls[0].route,'/sync/unpair');assert.equal(messages[0].pluginMessage.enabled,false);
});
test('completion survives transient failure and is retried; heartbeat failure preserves session',async()=>{
 const {context,poll}=setup();context.syncToken='token';context.syncJob='job';let failures=1;const results=[];
 context.syncRequest=async(route,body)=>{if(failures-- > 0)throw new Error('timeout');results.push({route,body});return {job:null};};
 await context.finishSync(undefined,{screens:[{tokenMs:3}]});assert.equal(context.pendingCompletion.jobId,'job');await poll();assert.equal(context.pendingCompletion,null);
 assert.equal(results[0].body.stats.saved,7);assert.equal(results[0].body.profile.screens[0].tokenMs,3);
 context.syncRequest=async()=>{throw new Error('timeout');};await poll();assert.equal(context.syncToken,'token');
});


test('pairing conflict keeps consent checked and shows the recovery state', async () => {
 const {context,checkbox,poll}=setup();
 context.trustedProjects.add('A');
 context.syncRequest=async()=>{throw Object.assign(new Error('A previous CLI session for this document is still active.'),{status:400});};
 await poll();
 assert.equal(checkbox.checked,true);
 assert.match(checkbox.textContent,/previous CLI session/);
 assert.equal(context.syncToken,null);
});
