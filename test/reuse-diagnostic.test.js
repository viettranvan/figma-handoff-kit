import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../figma-exporter-plugin/code.js',import.meta.url),'utf8');
const {recordReuseDiagnostic:record,finishReuseDiagnostic:finish}=vm.runInNewContext(source.slice(source.indexOf('function recordReuseDiagnostic('),source.indexOf('// Deep recursive DOM Tree Extractor'))+';({recordReuseDiagnostic,finishReuseDiagnostic})');
test('diagnostic counts equivalent output/context without merging nodes or overriding values',()=>{
 const context={profile:{}};const a={type:'INSTANCE',name:'Button',width:10,height:20,children:[]};const item={component:{isSharedComponent:true,masterComponentId:'master',componentProperties:{text:{value:'A'}},inferredTextProps:[]},tokenReferences:[{property:'fills',resolvedValue:'red'}]};
 const before=JSON.stringify(item);
 record(a,item,{color:'red',display:'flex'},context);record({...a,name:'Other'},item,{display:'flex',color:'red'},context);
 record(a,{...item,tokenReferences:[{property:'fills',resolvedValue:'blue'}]},{color:'red',display:'flex'},context);
 finish(context);assert.equal(context.profile.reuseDiagnostic.css.repeatedUsages,2);assert.equal(context.profile.reuseDiagnostic.component.repeatedUsages,1);assert.equal(JSON.stringify(item),before);assert.equal(context.reuseDiagnosticMaps,undefined);
});
test('diagnostic distinguishes layout context and caps retained groups',()=>{
 const c={profile:{}};for(let i=0;i<4100;i++)record({type:'TEXT',name:'text',width:i,height:10},{},{color:'red'},c,{width:i});finish(c);
 assert.equal(c.profile.reuseDiagnostic.css.groups,4096);assert.equal(c.profile.reuseDiagnostic.droppedGroups,4);
});
