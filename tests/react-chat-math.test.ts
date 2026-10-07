import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import DOMPurify from 'dompurify';
import {prose} from '../resources/react/chat-prose';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {Conversation} from '../resources/react/App';

function rendered(source: string) {
    const dom = new JSDOM('<body></body>');
    const sanitize = DOMPurify.sanitize;
    DOMPurify.sanitize = DOMPurify(dom.window as any).sanitize;
    try { dom.window.document.body.innerHTML = prose(source); }
    finally { DOMPurify.sanitize = sanitize; }
    return dom;
}

test('chat renders inline and display mathematics with accessible source and ordinary Markdown', () => {
    const dom = rendered(String.raw`**Energy**: \(E = mc^2\), $x_i$.

\[\frac{a}{b} = \sqrt{c}\]

$$\begin{pmatrix}1 & 2\\3 & 4\end{pmatrix}$$`);
    try {
        assert.equal(dom.window.document.querySelector('strong')?.textContent, 'Energy');
        assert.equal(dom.window.document.querySelectorAll('.katex').length, 4);
        assert.equal(dom.window.document.querySelectorAll('.chat-math-display').length, 2);
        assert.equal(dom.window.document.querySelectorAll('math').length, 4);
        assert.equal(dom.window.document.querySelector('annotation')?.textContent, 'E = mc^2');
    } finally { dom.window.close(); }
});

test('code, prices, escaped dollars and raw HTML do not acquire math or privileges', () => {
    const source = String.raw`Prices $3/month or $30/year. Escaped \$x\$.

Inline code: `;
    const dom = rendered(source + '`\\(x\\) $y$`\n\n```latex\n\\[x\\]\n$$y$$\n```\n<img src="https://evil.invalid/x" onerror="alert(1)"><span class="katex" style="color:red">Fake</span><script>alert(1)</script>');
    try {
        assert.equal(dom.window.document.querySelectorAll('.katex').length, 0);
        assert.match(dom.window.document.body.textContent!, /Prices \$3\/month or \$30\/year/);
        assert.match(dom.window.document.querySelector('code')?.textContent!, /\\\(x\\\) \$y\$/);
        assert.equal(dom.window.document.querySelectorAll('img,script,[style],[onerror]').length, 0);
    } finally { dom.window.close(); }
});

test('streaming incomplete delimiters and invalid math remain source and complete on the next render', () => {
    for (const source of [String.raw`Before \(\frac{a}{`, String.raw`\[x`, '$$x', String.raw`\(\notACommand{x}\)`, String.raw`\(\def\a{\a}\a\)`]) {
        const dom = rendered(source);
        try {
            assert.equal(dom.window.document.querySelectorAll('.katex').length, 0);
            assert.equal(dom.window.document.body.textContent?.trim(), source);
        } finally { dom.window.close(); }
    }
    const dom = rendered(String.raw`Before \(\frac{a}{b}\)`);
    try { assert.equal(dom.window.document.querySelectorAll('.katex').length, 1); }
    finally { dom.window.close(); }
});

test('math cannot enable external assets, links, HTML attributes or shared macros', () => {
    const dom = rendered(String.raw`\(\includegraphics{https://evil.invalid/a}\) \(\href{javascript:alert(1)}{x}\) \(\htmlStyle{position:fixed}{x}\)
\(\gdef\foo{x}\foo\) \(\foo\)`);
    try {
        assert.equal(dom.window.document.querySelectorAll('img,a,script,iframe').length, 0);
        assert.equal(dom.window.document.querySelector('.math-source:last-child')?.textContent, String.raw`\(\foo\)`);
        assert.equal(dom.window.document.querySelectorAll('[style*="position"],[id],[data-evil]').length, 0);
    } finally { dom.window.close(); }
});

test('math input, macro work, layout and count are bounded without losing original content', () => {
    const oversized = '\\(' + 'x'.repeat(8193) + '\\)';
    const source = oversized + ' ' + Array.from({length:70}, () => '\\(x\\)').join(' ');
    const dom = rendered(source);
    try {
        assert.equal(dom.window.document.querySelectorAll('.katex').length, 64);
        assert.equal(dom.window.document.querySelectorAll('.math-source').length, 7);
        assert.match(dom.window.document.body.textContent!, /x{8193}/);
    } finally { dom.window.close(); }
    const small = rendered(String.raw`\(\rule{100000em}{100000em}\)`);
    try {
        assert.doesNotMatch(Array.from(small.window.document.querySelectorAll('[style]')).map(element => element.getAttribute('style')).join(' '), /100000em/);
        assert.equal(small.window.document.querySelector('mspace')?.getAttribute('width'), '10em');
    }
    finally { small.window.close(); }
});

test('aggregate math budget and UTF-8 expression bounds preserve refused source', () => {
    const formula = String.raw`\text{${'a'.repeat(8000)}}`;
    const dom = rendered(Array.from({length:5}, () => `\\(${formula}\\)`).join('\n'));
    try {
        assert.equal(dom.window.document.querySelectorAll('.katex').length, 4);
        assert.equal(dom.window.document.querySelectorAll('.math-source').length, 1);
    } finally { dom.window.close(); }
    const unicode = '\\(' + 'é'.repeat(5000) + '\\)';
    const refused = rendered(unicode);
    try {
        assert.equal(refused.window.document.querySelectorAll('.katex').length, 0);
        assert.equal(refused.window.document.querySelector('.math-source')?.textContent, unicode);
    } finally { refused.window.close(); }
});

test('user marker lookalikes and escaped closing delimiters do not corrupt math or sanitized prose', () => {
    const dom = rendered(String.raw`HELM_MATH_0_0END <a href="javascript:alert(1)">unsafe</a> \(x + \text{a \\) b}\)`);
    try {
        assert.match(dom.window.document.body.textContent!, /HELM_MATH_0_0END/);
        assert.equal(dom.window.document.querySelector('a')?.hasAttribute('href'), false);
        assert.equal(dom.window.document.querySelectorAll('.katex').length, 1);
    } finally { dom.window.close(); }
});

test('actual conversation renders both roles and live math while copy retains canonical LaTeX', async () => {
    const dom = new JSDOM('<div id="mount"></div>', {url:'https://helm.test/', pretendToBeVisual:true});
    const saved = {window:globalThis.window, document:globalThis.document, requestAnimationFrame:globalThis.requestAnimationFrame};
    Object.defineProperty(dom.window, 'matchMedia', {value:()=>({matches:false,addEventListener(){},removeEventListener(){}})});
    Object.assign(globalThis, {window:dom.window, document:dom.window.document, requestAnimationFrame:(fn:FrameRequestCallback)=>fn(0), IS_REACT_ACT_ENVIRONMENT:true});
    const sanitize = DOMPurify.sanitize;
    DOMPurify.sanitize = DOMPurify(dom.window as any).sanitize;
    const clipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');
    let copied = '';
    Object.defineProperty(globalThis.navigator, 'clipboard', {configurable:true,value:{writeText:async(text:string)=>{copied=text;}}});
    const root = createRoot(document.querySelector('#mount')!);
    const original = String.raw`Energy: \(E=mc^2\)`;
    const tab:any = {key:'t',title:'Math voyage',draft:'',pictures:[],decisions:[],snapshot:{messages:[
        {role:'user',message_index:0,content:String.raw`Explain \(x^2\)`},
        {role:'assistant',message_index:1,content:original},
    ],run:{run_id:'run',state:'running',stream_reconciled:true,live_text:String.raw`\(\frac{a}{`}}};
    const workspace:any = {actionable:()=>false,permitted:()=>false,pending:()=>[]};
    const render = () => root.render(React.createElement(Conversation,{tab,workspace,active:false,onSettings:()=>{}}));
    try {
        await React.act(async()=>render());
        assert.equal(document.querySelectorAll('.message.user .katex').length, 1);
        assert.equal(document.querySelectorAll('.message.assistant .katex').length, 1);
        assert.equal(document.querySelector('.live .math-source')?.textContent, String.raw`\(\frac{a}{`);
        await React.act(async()=>{tab.snapshot.run.live_text=String.raw`\(\frac{a}{b}\)`;render();});
        assert.equal(document.querySelectorAll('.live .katex').length, 1);
        await React.act(async()=>document.querySelector<HTMLButtonElement>('button[aria-label="Copy response"]')!.click());
        assert.equal(copied, original);
        assert.equal(tab.snapshot.messages[1].content, original);
    } finally {
        await React.act(async()=>root.unmount());
        Object.assign(globalThis,saved); DOMPurify.sanitize=sanitize;
        if(clipboard)Object.defineProperty(globalThis.navigator,'clipboard',clipboard);else delete (globalThis.navigator as any).clipboard;
        dom.window.close();
    }
});
