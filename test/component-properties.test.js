import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const s=readFileSync(new URL('../figma-exporter-plugin/code.js',import.meta.url),'utf8');
const { inspectComponentInstance }=vm.runInNewContext(s.slice(s.indexOf('function readVariantProperties('),s.indexOf('// Generate Google Fonts links'))+';({inspectComponentInstance})',{sendUI(){}});
test('official properties retain names, IDs, types, false values and instance swaps',()=>{
 const props={'Show icon#1':{type:'BOOLEAN',value:false},'Label#2':{type:'TEXT',value:'Hello'},Icon:{type:'INSTANCE_SWAP',value:'9:1'},Size:{type:'VARIANT',value:'Small'}};
 const defs={'Show icon#1':{type:'BOOLEAN',defaultValue:true}};
 const node={type:'INSTANCE',id:'i',name:'Button',variantProperties:{Size:'Small'},componentProperties:props,mainComponent:{id:'m',name:'Button',componentPropertyDefinitions:defs},children:[{id:'a',type:'TEXT',name:'Label',characters:'A'},{id:'b',type:'TEXT',name:'Label',characters:'B'}]};
 const result=inspectComponentInstance(node);
 assert.equal(result.componentProperties,props);assert.equal(result.componentPropertyDefinitions,defs);
 assert.equal(result.inferredTextProps.length,2);
 assert.equal(result.inferredTextProps[0].source,'layer-name-inference');
 assert.equal(result.extractedProps,undefined);
 assert.match(result.recommendedUsage,/Confirm code prop names/);
 assert.equal(result.componentProperties['Show icon#1'].value,false);
});
test('unreadable official properties produce warnings without replacing them with guesses',()=>{
 const result=inspectComponentInstance({id:'i',mainComponent:{id:'m',name:'Button'},get componentProperties(){throw new Error('Unavailable');},children:[]});
 assert.equal(result.componentProperties,null);assert.match(result.propertyWarnings[0],/Unavailable/);
});

test('shared metadata cache preserves per-instance properties, variants and text',()=>{
 let reads=0;
 const master={id:'m',name:'Button',description:'Shared',get componentPropertyDefinitions(){reads++;return {Label:{type:'TEXT'}};}};
 const context={componentMetadataCache:new Map(),profile:{componentMs:0,componentMetadataReads:0,componentCacheHits:0}};
 const node=(id,text)=>({id,type:'INSTANCE',name:'Button',mainComponent:master,variantProperties:{Size:text},componentProperties:{Label:{value:text}},children:[{id:id+'text',type:'TEXT',name:'Label',characters:text}]});
 const a=inspectComponentInstance(node('a','A'),context),b=inspectComponentInstance(node('b','B'),context);
 assert.equal(reads,1);assert.equal(context.profile.componentCacheHits,1);assert.equal(context.profile.componentMetadataReads,1);
 assert.equal(a.componentProperties.Label.value,'A');assert.equal(b.componentProperties.Label.value,'B');
 assert.equal(a.inferredTextProps[0].value,'A');assert.equal(b.inferredTextProps[0].value,'B');
 assert.equal(b.variantProperties.Size,'B');
});
