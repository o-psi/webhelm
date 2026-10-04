import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Source contracts complement rendered qualification; they do not assert contrast or pixels.
const css=readFileSync(new URL('../resources/react/style.css',import.meta.url),'utf8');
const app=readFileSync(new URL('../resources/react/App.tsx',import.meta.url),'utf8');
test('quiet working styles use existing grouping and theme tokens, not whole-control opacity',()=>{
 assert.match(app,/data-group=\{voyageGroup\(voyage,tab&&!tab\.stale\?tab\.decisions\.length:0,pendingReceipts\)\}/);
 const quiet=css.slice(css.indexOf('/* Quiet background work'));
 assert.match(quiet,/\[data-group=working\]\[data-status-tone=active\]\{--tone:var\(--muted-foreground\)\}/);
 assert.match(quiet,/:not\(\[aria-current=true\]\) \.card-title\{font-weight:400\}/);
 assert.match(quiet,/\.card-status i\{animation:none;border:1px solid currentColor/);
 assert.doesNotMatch(quiet,/opacity\s*:|pointer-events\s*:|display\s*:\s*none/);
 assert.match(css,/\.voyage-card:focus-visible\{outline:2px solid var\(--ring\)/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(css,/\.voyage-card\[aria-current=true\]\{background:var\(--background\);border-color:var\(--border\)/);
});
