import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
test('selected ZIP starts without crypto.randomUUID in a sandboxed iframe', () => {
 const html = readFileSync(new URL('../figma-exporter-plugin/ui.html', import.meta.url), 'utf8');
 const source = html.slice(html.indexOf('    function startExport('), html.indexOf("    parent.postMessage({pluginMessage:{type:'GET_DOCUMENT'}"));
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
