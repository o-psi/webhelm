import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ComposerSurface} from '../resources/react/ComposerSurface';
import {InlineGoalControls} from '../resources/react/InlineGoalControls';

test('new and existing adapters share one collapsed surface without default receipt/configuration boilerplate',()=>{
 const render=()=>renderToStaticMarkup(React.createElement(ComposerSurface,{configuration:React.createElement('p',null,'Private configuration'),recovery:React.createElement('p',null,'Receipt details'),toolbar:React.createElement('button',{type:'submit'},'Send')},React.createElement('textarea',{'aria-label':'Message'})));
 assert.equal(render(),render());
 const html=render();assert.match(html,/Configure/);assert.match(html,/Review pending work/);
 assert.doesNotMatch(html,/Private configuration|Receipt details|role="dialog"/);
 assert.equal((html.match(/type="submit"/g)||[]).length,1);
});
test('paused goal review has explicit finite-limit consent and never applies during render',()=>{
 let effects=0;
 const html=renderToStaticMarkup(React.createElement(InlineGoalControls,{objective:'A private objective',onApply:async()=>{effects++;},onClose(){}}));
 assert.equal(effects,0);assert.match(html,/Resume requires separate automatic-continuation consent/);
 assert.match(html,/type="checkbox"/);assert.match(html,/disabled=""/);assert.doesNotMatch(html,/role="dialog"/);
});


test('current goal clear and resume require distinct consent rather than a shared checkbox',()=>{
 const html=renderToStaticMarkup(React.createElement(InlineGoalControls,{current:{id:'g',objective:'Existing',status:'paused',usage:{runs:1},limits:{runs:3,tokens:100,elapsed_ms:1000,no_progress_runs:2}},onAction:async()=>assert.fail('render cannot act'),onApply:async()=>assert.fail('status cannot apply'),onClose(){}}));
 assert.match(html,/clearing this exact goal/);assert.match(html,/authorize automatic continuation/);
 assert.doesNotMatch(html,/>Save paused goal</);
 assert.equal((html.match(/type="checkbox"/g)||[]).length,4);
});
