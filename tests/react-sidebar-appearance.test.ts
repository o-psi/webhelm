import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Source contracts complement rendered qualification; they do not assert contrast or pixels.
const css=readFileSync(new URL('../resources/react/style.css',import.meta.url),'utf8');
const app=readFileSync(new URL('../resources/react/App.tsx',import.meta.url),'utf8');
const quietWorkingRules=(source:string)=>source.replace(/\/\*[\s\S]*?\*\//g,'').match(/[^{}]*\.voyage-card\[data-group=working\]\[data-status-tone=active\][^{}]*\{[^{}]*\}/g)?.join('\n')||'';

test('quiet working styles use existing grouping and theme tokens, not whole-control opacity',()=>{
 assert.match(app,/data-group=\{voyageGroup\(voyage,tab&&!tab\.stale\?tab\.decisions\.length:0,pendingReceipts\)\}/);
 const quiet=quietWorkingRules(css);
 assert.match(quiet,/\[data-group=working\]\[data-status-tone=active\]\{--tone:var\(--muted-foreground\)\}/);
 assert.match(quiet,/:not\(\[aria-current=true\]\) \.card-title\{font-weight:400\}/);
 assert.match(quiet,/\.card-status i\{animation:none;border:1px solid currentColor/);
 assert.doesNotMatch(quiet,/opacity\s*:|pointer-events\s*:|display\s*:\s*none/);
 assert.match(css,/\.voyage-card:focus-visible\{outline:2px solid var\(--ring\)/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(css,/\.voyage-card\[aria-current=true\]\{background:var\(--background\);border-color:var\(--border\)/);
});

test('quiet working rule extraction is independent of intervening CSS comments',()=>{
 const rules=[
  '.voyage-card[data-group=working][data-status-tone=active]{--tone:var(--muted-foreground)}',
  '.voyage-card[data-group=working][data-status-tone=active] .card-status i{animation:none;border:1px solid currentColor}',
 ];
 const extracted=quietWorkingRules(rules.join('\n/* unrelated explanation { with braces } */\n'));
 for(const rule of rules)assert.ok(extracted.includes(rule));
 assert.doesNotMatch(extracted,/unrelated explanation/);
 assert.doesNotMatch(quietWorkingRules('.unrelated{opacity:0}\n'+rules.join('\n')),/opacity/);
});

test('original row interaction and reduced-motion contracts remain explicit',()=>{
 assert.match(css,/\.voyage-card:hover\{background:var\(--muted\)/);
 assert.match(css,/\.voyage-card\[aria-current=true\]::before\{content:""/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{\.voyage-card,\.voyage-card::before,\.voyage-card \.card-status i\{animation:none!important;transition:none/);
 assert.match(app,/className="card-vessel" title=\{voyage\.connection\.name\}/);
 assert.match(app,/className="card-title" title=\{voyage\.name\|\|voyage\.session_id\}/);
 assert.match(app,/className="card-status status-label" title=\{\[status\.label,status\.detail\]/);
 assert.match(app,/onContextMenu=/);
 assert.match(app,/event\.key==='ContextMenu'\|\|event\.shiftKey&&event\.key==='F10'/);
});
