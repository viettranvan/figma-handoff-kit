import { test } from 'node:test';
import assert from 'node:assert/strict';
import { figmaLink } from '../bin/open-figma.js';
test('Figma URL accepts sections and rejects other hosts/protocols', () => {
 assert.equal(new URL(figmaLink('https://www.figma.com/design/abc/Copy?node-id=1-2')).searchParams.get('node-id'),'1-2');
 for (const input of ['file:///tmp/file','https://evil.com/design/abc/Copy','https://figma.com.evil.com/design/abc','https://www.figma.com/community/plugin/abc']) assert.throws(()=>figmaLink(input));
});

test('Desktop deep link uses file scheme and preserves section selection', async () => {
 const { desktopLink } = await import('../bin/open-figma.js');
 assert.equal(desktopLink('https://www.figma.com/design/abc/Copy?node-id=1-2'), 'figma://file/abc?node-id=1-2');
});
