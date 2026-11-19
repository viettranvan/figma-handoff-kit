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

test('Desktop launch passes URL as an argument and prioritizes the exact native development plugin', async () => {
 const {openFigma}=await import('../bin/open-figma.js');
 const calls=[];
 await openFigma({figmaUrl:'https://www.figma.com/design/abc/Copy?node-id=1-2'},{foreground:true,run:async(...args)=>{calls.push(args);return {stdout:'launched\n'};}});
 assert.deepEqual(calls[0].slice(0,2),['/usr/bin/open',['-a','Figma','figma://file/abc?node-id=1-2']]);
 const script=calls[1][1][1];assert.equal(script.includes('figma://'),false);
 assert.ok(script.indexOf('menu item "Figma Handoff Kit"') < script.indexOf('keystroke "/"'));
 assert.equal(calls[1][2].timeout,20000);

});

test('foreground launch is explicit and enables Quick Actions fallback', async () => {
 const {openFigma}=await import('../bin/open-figma.js');const calls=[];
 await openFigma({figmaUrl:'https://www.figma.com/design/abc/Copy?node-id=1-2'},{foreground:true,run:async(...args)=>{calls.push(args);return {stdout:'launched'};}});
 assert.equal(calls[0][1].includes('-g'),false);
 assert.ok(calls[1][1][1].includes('to activate'));
 assert.equal(calls[1][1][1].includes('return "background-unavailable"'),false);
});

test('background mode issues no open command, AppleScript, menu action or keystroke', async () => {
 const {openFigma}=await import('../bin/open-figma.js');let commands=0;
 await openFigma({figmaUrl:'https://www.figma.com/design/abc/Copy?node-id=1-2'},{run:async()=>{commands++;return {stdout:''};}});
 assert.equal(commands,0);
});
