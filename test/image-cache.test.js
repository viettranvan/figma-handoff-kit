import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../figma-exporter-plugin/code.js',import.meta.url),'utf8');
function setup(getImage){return vm.runInNewContext(source.slice(source.indexOf('async function readOriginalImage('),source.indexOf('async function exportSvg('))+';readOriginalImage',{figma:{getImageByHash:getImage},measured:async(p,k,fn)=>fn(),imageFormat:()=>({extension:'jpg',name:'JPEG'}),bufferToBase64:bytes=>Buffer.from(bytes).toString('base64')});}
test('original images are read once across consumers/screens with no crop data in cache',async()=>{
 let bytes=0,sizes=0;const read=setup(()=>({getBytesAsync:async()=>{bytes++;return new Uint8Array([1,2,3]);},getSizeAsync:async()=>{sizes++;return {width:20,height:30};}}));
 const imageContext={};const a={imageContext,profile:{imageSourceReads:0,imageCacheHits:0}},b={imageContext,profile:{imageSourceReads:0,imageCacheHits:0}};
 assert.equal(await read('hash',a),await read('hash',b));assert.equal(bytes,1);assert.equal(sizes,1);assert.equal(b.profile.imageCacheHits,1);
 assert.equal(imageContext.originalImageCache.has('hash'),true);assert.equal(imageContext.originalImageCache.get('hash').crop,undefined);
 await read('different',a);assert.equal(bytes,2);
});
test('failed image reads retry; oversized sources do not enter the bounded cache',async()=>{
 let tries=0;const read=setup(()=>({getBytesAsync:async()=>{if(++tries===1)throw new Error('offline');return new Uint8Array([1]);},getSizeAsync:async()=>({width:1,height:1})}));const ctx={};
 await assert.rejects(read('hash',ctx),/offline/);await read('hash',ctx);assert.equal(tries,2);
 const huge=vm.runInNewContext(source.slice(source.indexOf('async function readOriginalImage('),source.indexOf('async function exportSvg('))+';readOriginalImage',{figma:{getImageByHash:()=>({getBytesAsync:async()=>new Uint8Array([1]),getSizeAsync:async()=>({width:1,height:1})})},measured:async(p,k,f)=>f(),imageFormat:()=>({}),bufferToBase64:()=> 'a'.repeat(17*1024*1024)});
 const context={};await huge('big',context);assert.equal(context.originalImageCache.size,0);
});
