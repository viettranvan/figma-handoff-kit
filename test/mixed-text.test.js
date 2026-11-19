import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('mixed text exports serializable typography and preserves styled ranges', () => {
  const code = readFileSync(new URL('../figma-exporter-plugin/code.js', import.meta.url), 'utf8');
  const block = code.slice(code.indexOf('  // 3. TEXT & TYPOGRAPHY'), code.indexOf('  try {\n    await measured(context.profile,'));
  const mixed = Symbol('mixed');
  const runs = [{ start: 0, end: 2, characters: 'Hi', fontName: { family: 'Inter', style: 'Semi Bold' }, fontSize: 20, lineHeight: { unit: 'AUTO' }, letterSpacing: { unit: 'PIXELS', value: 0 } }];
  const context = { fontsUsed: {}, designTokens: { typography: {} } };
  const nodeItem = {};
  vm.runInNewContext(block, {
    fontWeightNumber: vm.runInNewContext(code.slice(code.indexOf('function fontWeightNumber('), code.indexOf('// Semantic HTML')) + ';fontWeightNumber'), recordFontUsage: vm.runInNewContext(code.slice(code.indexOf('function recordFontUsage('), code.indexOf('// Preserve Figma identities')) + ';recordFontUsage'), figma: { mixed }, context, nodeItem, computedCss: {},
    node: { type: 'TEXT', characters: 'Hi', fontName: mixed, fontSize: mixed, lineHeight: mixed, letterSpacing: mixed, getStyledTextSegments: () => runs }
  });
  assert.equal(nodeItem.typography.fontSize, 'mixed');
  assert.equal(nodeItem.typography.lineHeight, 'mixed');
  assert.deepEqual(nodeItem.textRuns, runs);
  assert.equal(context.fontsUsed.Inter['600'].normal, true);
  assert.doesNotThrow(() => JSON.stringify(context));
  assert.ok(Object.keys(context.designTokens.typography).length);
});
