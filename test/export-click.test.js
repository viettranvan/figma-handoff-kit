import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
test('selected ZIP starts without crypto.randomUUID in a sandboxed iframe', () => {
 const html = readFileSync(new URL('../figma-exporter-plugin/ui.html', import.meta.url), 'utf8');
 const source = html.slice(html.indexOf('    async function startExport('), html.indexOf("    parent.postMessage({pluginMessage:{type:'GET_DOCUMENT'}"));
 const messages = [];
 const context = { btnExport:{disabled:false}, isExporting:false, activeRunId:null, delivery:'zip', exportDelivery:null, zipFiles:new Map(),zipURL:null,
 document:{getElementById:()=>({hidden:false,checked:false}),querySelector:()=>({value:'2'})},stats:{}, phase:'ready',
 renderProgress(){},setControlsDisabled(){},getSelectedScope:()=> 'selection',addLog(){}, projectId:null,exportProjectId:null,
 parent:{postMessage:msg=>messages.push(msg)},Date,Math };
 vm.createContext(context);vm.runInContext(source,context);
 context.btnExport.onclick({isTrusted:true});
 assert.equal(messages.length,1);
 assert.equal(messages[0].pluginMessage.scope,'selection');
 assert.equal(messages[0].pluginMessage.type,'START_EXPORT');
 assert.ok(messages[0].pluginMessage.runId);
 context.btnExport.onclick({isTrusted:true});
 assert.equal(messages.length,1);
});

test('switching bridges refreshes destination and requires confirmation before export', async () => {
 const html = readFileSync(new URL('../figma-exporter-plugin/ui.html', import.meta.url), 'utf8');
 const source = html.slice(html.indexOf('    async function startExport('), html.indexOf("    parent.postMessage({pluginMessage:{type:'GET_DOCUMENT'}"));
 const messages = [], logs = [];
 const context = { btnExport:{disabled:false}, isExporting:false, activeRunId:null, delivery:'local', exportDelivery:null, zipFiles:new Map(),zipURL:null,
 document:{getElementById:()=>({hidden:false,checked:false}),querySelector:()=>({value:'2'})},stats:{}, phase:'ready',
 renderProgress(){},setControlsDisabled(){},getSelectedScope:()=> 'selection',addLog: text => logs.push(text), words:(vi,en)=>en,
 projectId:'A',exportProjectId:null,isServerOnline:true,
 parent:{postMessage:msg=>messages.push(msg)},Date,Math };
 vm.createContext(context);
 context.checkServer = async () => { context.projectId='B';context.btnExport.disabled=false; };
 vm.runInContext(source,context);
 await context.startExport();
 assert.equal(messages.length,0);
 assert.match(logs[0],/Destination project changed/);
 await context.startExport();
 assert.equal(messages.length,1);
 assert.equal(context.exportProjectId,'B');
});

test('change check reports actual bridge rejection instead of recommending an upgrade', async () => {
 const html = readFileSync(new URL('../figma-exporter-plugin/ui.html', import.meta.url), 'utf8');
 const block = html.slice(html.indexOf('          if (!response.ok) {'), html.indexOf('          const result = await response.json();', html.indexOf('          if (!response.ok) {')));
 const check = vm.runInNewContext('(async () => {' + block + '})', { response:{ok:false,status:400,json:async()=>({error:'Project changed; reconnect plugin before exporting'})},words:(vi,en)=>en });
 await assert.rejects(check(),/HTTP 400.*Project changed/);
});
