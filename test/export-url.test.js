import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseExportUrl} from '../bin/export-url.js';
test('Figma link parsing validates origin and requires an explicit node',()=>{
 assert.deepEqual(parseExportUrl('https://www.figma.com/design/JcCgMP1p3FbThizuJtXSPm/Design?node-id=11965-185124&t=abc'),{fileKey:'JcCgMP1p3FbThizuJtXSPm',nodeId:'11965:185124'});
 for(const url of ['https://evil.com/design/key?node-id=1-2','https://figma.com/design/key','http://figma.com/design/key?node-id=1-2','https://figma.com/design/key?node-id=bad'])assert.throws(()=>parseExportUrl(url));
});
