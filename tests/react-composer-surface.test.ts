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
 assert.equal(effects,0);assert.match(html,/Automatic continuation is not authorized/);
 assert.match(html,/type="checkbox"/);assert.match(html,/disabled=""/);assert.doesNotMatch(html,/role="dialog"/);
});
