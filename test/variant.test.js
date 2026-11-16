import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('broken variant getters retain component export with an explicit warning', () => {
  const source = readFileSync(new URL('../figma-exporter-plugin/code.js', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('function readVariantProperties('), source.indexOf('// Generate Google Fonts links'));
  const warnings = [];
  const { readVariantProperties, inspectComponentInstance } = vm.runInNewContext(code + '\n({readVariantProperties, inspectComponentInstance})', {sendUI: msg => warnings.push(msg)});
  const node = { id: '1:2', name: 'Broken instance', mainComponent: {id: '3:4', name: 'Button'}, children: [], get variantProperties() { throw new Error('Component set for node has existing errors'); } };
  const component = inspectComponentInstance(node);
  assert.equal(component.masterComponentId, '3:4');
  assert.equal(component.variantProperties, null);
  assert.match(component.variantWarning, /1:2.*existing errors/);
  assert.ok(component.recommendedUsage);
  assert.equal(warnings.length, 1);
  const valid = { Size: 'Small' };
  assert.equal(readVariantProperties({variantProperties: valid}).value, valid);
  assert.equal(readVariantProperties({variantProperties: null}).value, null);
});


test('variant fallback normalizes leading equals, uses main component and rejects ambiguous names', () => {
  const source = readFileSync(new URL('../figma-exporter-plugin/code.js', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('function readVariantProperties('), source.indexOf('// Generate Google Fonts links'));
  const { readVariantProperties, inspectComponentInstance } = vm.runInNewContext(code + '\n({readVariantProperties, inspectComponentInstance})', {sendUI() {}});
  const parent = { type: 'COMPONENT_SET', name: 'Flow' };
  const node = { id: '1:2', name: 'Renamed instance', children: [], mainComponent: { id:'3:4', parent, name: '=Compare=Off, State=Nobody started' }, get variantProperties() { throw new Error('invalid set'); } };
  const recovered = inspectComponentInstance(node);
  assert.equal(recovered.variantProperties.Compare, 'Off');
  assert.equal(recovered.variantProperties.State, 'Nobody started');
  assert.equal(recovered.variantMetadataSource, 'normalized-name');
  assert.equal(recovered.variantRawName, '=Compare=Off, State=Nobody started');
  assert.match(recovered.variantWarning, /invalid set/);
  for (const name of ['A=x, A=y', 'A=', 'A=x=y', '__proto__=bad']) {
    assert.equal(readVariantProperties(node, {name, parent}).value, null, name);
  }
  assert.equal(readVariantProperties(node, {name:'Compare=Off'}).value, null);
  const native = { Compare:'On' };
  assert.equal(readVariantProperties({ variantProperties:native }, node.mainComponent).value, native);
});


test('missing property names require one unambiguous sibling schema and no duplicate combination', () => {
  const source = readFileSync(new URL('../figma-exporter-plugin/code.js', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('function readVariantProperties('), source.indexOf('// Generate Google Fonts links'));
  const { readVariantProperties } = vm.runInNewContext(code + '\n({readVariantProperties})', {sendUI() {}});
  const node = {name:'Instance', id:'i', get variantProperties() {throw new Error('invalid set');}};
  const parent = {type:'COMPONENT_SET', children:[
    {type:'COMPONENT',id:'a',name:'Compare=Off, State=Default'},
    {type:'COMPONENT',id:'b',name:'Compare=On, State=Default'}
  ]};
  const variant = {id:'c',name:'=Compare=Off, Nobody started',parent};
  const result=readVariantProperties(node,variant);
  assert.equal(result.value.State,'Nobody started');
  assert.equal(result.source,'sibling-schema');
  assert.equal(result.normalizedName,'Compare=Off, State=Nobody started');
  assert.equal(readVariantProperties(node,{...variant,name:'=Compare=Off, Default'}).value.State,undefined);
  parent.children[1].name='Compare=On, Status=Default';
  assert.equal(readVariantProperties(node,variant).source,'partial-name');
  parent.children=[{type:'COMPONENT',id:'a',name:'Compare=Off'},{type:'COMPONENT',id:'b',name:'Compare=On'}];
  assert.equal(readVariantProperties(node,variant).source,'partial-name');
});


test('partial metadata keeps valid pairs and labels without inventing State', () => {
 const source = readFileSync(new URL('../figma-exporter-plugin/code.js', import.meta.url), 'utf8');
 const code = source.slice(source.indexOf('function readVariantProperties('), source.indexOf('// Generate Google Fonts links'));
 const messages=[];
 const {inspectComponentInstance} = vm.runInNewContext(code+'\n({inspectComponentInstance})', {sendUI:m=>messages.push(m)});
 for (const [name,label] of [['=Compare=Off, Nobody started','Nobody started'],['=Type=Video, Compare=Off, Nobody played','Nobody played']]) {
  const node={id:'i',name:'Instance',children:[],mainComponent:{id:'m',name,parent:{type:'COMPONENT_SET',name:'Card',children:[]}},get variantProperties(){throw new Error('invalid set');}};
  const result=inspectComponentInstance(node);
  assert.equal(result.variantProperties.Compare,'Off');
  assert.equal(result.variantProperties.State,undefined);
  assert.equal(result.unassignedVariantLabels[0],label);
  assert.equal(result.variantMetadataSource,'partial-name');
  assert.equal(result.variantRawName,name);
  assert.match(result.variantWarning,/metadata incomplete/);
  if(name.includes('Type='))assert.equal(result.variantProperties.Type,'Video');
 }
 assert.equal(messages.length,2);
});
