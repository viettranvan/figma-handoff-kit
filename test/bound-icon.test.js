import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../figma-exporter-plugin/code.js',import.meta.url),'utf8');
function setup(){
 let lookups=0;
 const figma={variables:{getVariableByIdAsync:async id=>{lookups++;return {resolveForConsumer:node=>({value:node.dark?{r:0,g:0,b:0}:{r:1,g:1,b:1}})};}}};
 const helper=vm.runInNewContext(source.slice(source.indexOf('async function boundIconFingerprint('),source.indexOf('async function readOriginalImage('))+';({boundIconFingerprint,observeBoundIcon})',{figma});
 return {...helper,lookups:()=>lookups};
}
const icon=()=>({type:'FRAME',name:'chevron-down',width:16,height:16,relativeTransform:[[1,0,10],[0,1,20]],fills:[{type:'SOLID',blendMode:'NORMAL',color:{r:1,g:1,b:1},boundVariables:{color:{type:'VARIABLE_ALIAS',id:'color'}}}],strokes:[],effects:[],opacity:1,blendMode:'PASS_THROUGH',children:[]});
const context=()=>({boundIconState:{variables:new Map(),outputs:new Map()},profile:{boundIconEligible:0,boundIconUnique:0,boundIconShadowMatches:0,boundIconShadowMismatches:0,boundIconRejections:{}}});
test('fingerprints resolve variables on every consumer and preserve geometry and internal layout',async()=>{
 const h=setup(),ctx=context(),a=icon(),b=icon();b.relativeTransform[0][2]=100;
 const key=await h.boundIconFingerprint(a,ctx);assert.ok(key);assert.equal(key,await h.boundIconFingerprint(b,ctx));assert.equal(h.lookups(),1);
 b.dark=true;assert.notEqual(key,await h.boundIconFingerprint(b,ctx));b.dark=false;b.strokeWeight=2;assert.notEqual(key,await h.boundIconFingerprint(b,ctx));
 assert.equal(await h.boundIconFingerprint({...a,name:'other'},ctx),null);
 assert.equal(await h.boundIconFingerprint({...a,boundVariables:{opacity:{type:'VARIABLE_ALIAS',id:'x'}}},ctx),null);
});
test('shadow validates identical and conflicting native output without returning cached content',()=>{
 const h=setup(),ctx=context();
 h.observeBoundIcon('key','<svg/>',ctx);h.observeBoundIcon('key','<svg/>',ctx);h.observeBoundIcon('key','<svg><path/></svg>',ctx);
 assert.equal(ctx.profile.boundIconUnique,1);assert.equal(ctx.profile.boundIconShadowMatches,1);assert.equal(ctx.profile.boundIconShadowMismatches,1);
 h.observeBoundIcon('unsafe','<svg id="a"/>',ctx);assert.equal(ctx.boundIconState.outputs.has('unsafe'),false);
});

test('enabled reuse skips native calls only for identical resolved input and self-contained prior output',async()=>{
 let renders=0;
 const helpers=vm.runInNewContext(source.slice(source.indexOf('function circleSvgCacheKey('),source.indexOf('// Deep recursive DOM Tree Extractor'))+';({exportSvg})',{figma:{variables:{getVariableByIdAsync:async()=>({resolveForConsumer:n=>({value:n.dark?'black':'white'})})}},measured:async(p,k,fn)=>fn(),decodeUtf8:x=>x});
 const ctx=context();ctx.boundIconState.reuse=true;Object.assign(ctx.profile,{boundIconCacheHits:0,svgRenderCalls:0,svgCacheHits:0});
 const node={...icon(),exportAsync:async()=>{renders++;return '<svg><path/></svg>';}};
 const a=await helpers.exportSvg(node,{},ctx);assert.equal(await helpers.exportSvg({...node,relativeTransform:[[1,0,200],[0,1,300]]},{},ctx),a);
 assert.equal(renders,1);assert.equal(ctx.profile.boundIconCacheHits,1);
 await helpers.exportSvg({...node,dark:true},{},ctx);assert.equal(renders,2);
 const unsafe={...icon(),name:'info-circle',exportAsync:async()=>{renders++;return '<svg id="a"/>';}};
 await helpers.exportSvg(unsafe,{},ctx);await helpers.exportSvg(unsafe,{},ctx);assert.equal(renders,4);
});
