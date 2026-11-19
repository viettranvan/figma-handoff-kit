import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const html=readFileSync(new URL('../figma-exporter-plugin/ui.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('    async function checkServer()'),html.indexOf('    function renderStatus()'));
function setup(){
 const elements=new Map(); const radios=[{value:'zip',checked:true},{value:'local',checked:false}];
 const context={delivery:'zip',deliveryChosenByUser:false,isExporting:false,isServerOnline:false,projectId:null,syncToken:null,BRIDGE_URL:'http://localhost:3055',AbortSignal,
 document:{getElementById:id=>{if(!elements.has(id))elements.set(id,{checked:false});return elements.get(id);},querySelector:()=>({hidden:false}),querySelectorAll:()=>radios},
 translate:x=>x,words:(vi,en)=>en,renderDelivery(){},renderCliState(){},updateButtonState(){},serverBadge:{},
 fetch:async()=>({ok:true,json:async()=>({protocol_version:1,project_id:'A',exports_dir:'/A'})})};
 vm.createContext(context);vm.runInContext(source,context);return {context,radios,elements};
}
test('compatible bridge prefers project without enabling CLI permission',async()=>{
 const {context,radios,elements}=setup();await context.checkServer();
 assert.equal(context.delivery,'local');assert.equal(radios[1].checked,true);
 assert.equal(context.syncToken,null);assert.ok(!elements.get('allow-sync')?.checked);
});
test('user ZIP choice and active exports are preserved during connection checks',async()=>{
 const {context}=setup();context.deliveryChosenByUser=true;await context.checkServer();assert.equal(context.delivery,'zip');
 context.deliveryChosenByUser=false;context.isExporting=true;await context.checkServer();assert.equal(context.delivery,'zip');
});
test('unavailable or incompatible bridge keeps ZIP; later connection can select local',async()=>{
 const {context}=setup();context.fetch=async()=>{throw new Error('offline');};await context.checkServer();assert.equal(context.delivery,'zip');
 context.fetch=async()=>({ok:true,json:async()=>({protocol_version:2})});await context.checkServer();assert.equal(context.delivery,'zip');
 context.fetch=async()=>({ok:true,json:async()=>({protocol_version:1,project_id:'B'})});await context.checkServer();assert.equal(context.delivery,'local');
});
