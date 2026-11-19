import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../figma-exporter-plugin/code.js',import.meta.url),'utf8');
const {circleSvgCacheKey,exportSvg}=vm.runInNewContext(source.slice(source.indexOf('function circleSvgCacheKey('),source.indexOf('// Deep recursive DOM Tree Extractor'))+';({circleSvgCacheKey,exportSvg})',{decodeUtf8:x=>x,measured:async(p,k,fn)=>fn()});
const circle=()=>({type:'ELLIPSE',width:6,height:6,opacity:1,isMask:false,blendMode:'PASS_THROUGH',effects:[],strokes:[],dashPattern:[],arcData:{startingAngle:0,endingAngle:2*Math.PI,innerRadius:0},relativeTransform:[[1,0,20],[0,1,30]],fills:[{type:'SOLID',blendMode:'NORMAL',color:{r:1,g:0,b:0},opacity:1}]});
test('only identical supported circle inputs share renders, retaining per-node outputs',async()=>{
 let calls=0;const cache=new Map();const context={circleSvgCache:cache,profile:{svgRenderCalls:0,svgCacheHits:0}};
 const a={...circle(),exportAsync:async()=>{calls++;return '<svg><circle/></svg>';}};
 const b={...a,relativeTransform:[[1,0,70],[0,1,40]]};
 assert.equal(await exportSvg(a,{},context),await exportSvg(b,{},context));assert.equal(calls,1);assert.equal(context.profile.svgCacheHits,1);
 const changed=circle();changed.fills[0].color.b=1;assert.notEqual(circleSvgCacheKey(changed,{}),circleSvgCacheKey(a,{}));
 assert.notEqual(circleSvgCacheKey(a,{tokenReferences:[{property:'fills[0].color',resolvedValue:1}]}),circleSvgCacheKey(a,{tokenReferences:[{property:'fills[0].color',resolvedValue:2}]}));
});
test('unsupported geometry, rendering effects and unresolved metadata bypass cache',()=>{
 for(const patch of [{width:7},{opacity:.5},{effects:[{}]},{strokes:[{}]},{isMask:true},{relativeTransform:[[0,-1,0],[1,0,0]]},{arcData:{startingAngle:1,endingAngle:2,innerRadius:0}},{fills:[{type:'IMAGE'}]}])assert.equal(circleSvgCacheKey({...circle(),...patch},{}),null);
 assert.equal(circleSvgCacheKey(circle(),{tokenWarnings:['missing']}),null);
});
test('failed or context-sensitive SVG exports are never cached',async()=>{
 const context={circleSvgCache:new Map(),profile:{svgRenderCalls:0,svgCacheHits:0}};
 await assert.rejects(exportSvg({...circle(),exportAsync:async()=>{throw new Error('failed');}},{},context));
 await exportSvg({...circle(),exportAsync:async()=>'<svg id="a"/>'},{},context);assert.equal(context.circleSvgCache.size,0);
});

test('float32 full circles qualify while legacy rejection identifies angle precision',()=>{
 const node=circle();node.arcData.endingAngle=Math.fround(2*Math.PI);
 const reasons={};assert.equal(circleSvgCacheKey(node,{},reasons,true),null);assert.equal(reasons['arc-not-full-circle'],1);
 assert.ok(circleSvgCacheKey(node,{}));node.arcData.endingAngle=6;assert.equal(circleSvgCacheKey(node,{}),null);
});
