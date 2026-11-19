import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../figma-exporter-plugin/code.js',import.meta.url),'utf8');
function targetResolver(lookup){
 let now=0;
 const ctx={figma:{getNodeByIdAsync:lookup},Date:{now:()=>now},setTimeout:fn=>{now+=500;fn();}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function waitForExportTarget('),source.indexOf('figma.ui.onmessage =')),ctx);
 return ctx.waitForExportTarget;
}
test('target loading retries missing nodes until ready without rendering or loading all pages',async()=>{
 let calls=0;const node={id:'1:2',type:'SECTION'};
 const resolve=targetResolver(async id=>{assert.equal(id,'1:2');return ++calls<3?null:node;});
 assert.equal(await resolve('1:2',2000),node);assert.equal(calls,3);
});
test('missing targets have a bounded timeout; unsupported nodes fail immediately',async()=>{
 await assert.rejects(targetResolver(async()=>null)('1:2',1000),/unavailable after waiting/);
 await assert.rejects(targetResolver(async()=>({type:'TEXT'}))('1:2'),/not an exportable/);
});
