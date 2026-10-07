import {Marked, type TokenizerExtension, type Tokens} from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';

const MAX_EXPRESSION = 8192;
const MAX_MATH_BYTES = 32768;
const MAX_EXPRESSIONS = 64;
type MathToken = Tokens.Generic & {formula: string; display: boolean; complete: boolean};
const escape = (text: string) => text.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));

function mathToken(source: string, block: boolean): MathToken | undefined {
    const open = source.startsWith('$$') ? '$$' : source.startsWith('\\[') ? '\\['
        : !block && source.startsWith('\\(') ? '\\(' : !block && source.startsWith('$') ? '$' : null;
    if (!open) return;
    const display = open === '$$' || open === '\\[';
    const close = open === '\\[' ? '\\]' : open === '\\(' ? '\\)' : open;
    if (open === '$' && (!source[1] || /\s|\$/.test(source[1]))) return;
    let end = source.indexOf(close, open.length);
    while (end !== -1) {
        let slashes = 0;
        for (let index = end - 1; index >= 0 && source[index] === '\\'; index--) slashes++;
        if (slashes % 2 === 0 && (open !== '$' || (!/\s/.test(source[end - 1]) && !/[\d$]/.test(source[end + 1] || '')))) break;
        end = source.indexOf(close, end + close.length);
    }
    // A lone dollar stays ordinary prose; unfinished explicit delimiters stay visible while streaming.
    if (open === '$' && (end === -1 || source.slice(1, end).includes('\n'))) return;
    const complete = end !== -1;
    const raw = complete ? source.slice(0, end + close.length) : source.slice(0, display ? undefined : source.indexOf('\n') === -1 ? undefined : source.indexOf('\n'));
    return {type: block ? 'chatMathBlock' : 'chatMathInline', raw,
        formula: complete ? source.slice(open.length, end) : '', display, complete};
}

export function prose(input: string): string {
    const text = input.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '');
    // Unpredictable per-render markers also resist lookalikes assembled from HTML entities.
    const prefix = `HELM_MATH_${crypto.randomUUID().replaceAll('-', '')}_`;
    const fragments: string[] = [];
    let rendered = 0, mathBytes = 0;
    const render = (token: MathToken) => {
        let html = `<span class="math-source">${escape(token.raw)}</span>`;
        const bytes = token.formula.length <= MAX_EXPRESSION ? new TextEncoder().encode(token.formula).length : Infinity;
        if (token.complete && token.formula.length <= MAX_EXPRESSION && bytes <= MAX_EXPRESSION
            && rendered < MAX_EXPRESSIONS && mathBytes + bytes <= MAX_MATH_BYTES) {
            rendered++; mathBytes += bytes;
            try {
                html = `<span class="chat-math${token.display ? ' chat-math-display' : ''}">${katex.renderToString(token.formula, {
                    displayMode: token.display, output: 'htmlAndMathml', throwOnError: true,
                    trust: false, strict: 'error', maxSize: 10, maxExpand: 1000, macros: {},
                })}</span>`;
            } catch { /* Invalid, unsupported or excessive math remains its original readable source. */ }
        }
        const marker = `${prefix}${fragments.length}END`;
        fragments.push(html);
        return token.type === 'chatMathBlock' ? `${marker}\n` : marker;
    };
    const extensions: TokenizerExtension[] = [
        {name: 'chatMathBlock', level: 'block', tokenizer(source) { return mathToken(source, true); }},
        {name: 'chatMathInline', level: 'inline',
            start(source) { return source.search(/\\[([]|\$/); },
            tokenizer(source) { return mathToken(source, false); }},
    ];
    const markdown = new Marked({extensions: extensions.map(extension => ({...extension, renderer: token => render(token as MathToken)}))});
    const clean = DOMPurify.sanitize(markdown.parse(text, {async: false}) as string, {
        ALLOWED_TAGS: ['p','br','strong','em','del','code','pre','blockquote','ul','ol','li','h1','h2','h3','h4','hr','a','table','thead','tbody','tr','th','td'],
        ALLOWED_ATTR: ['href','title'], ALLOW_DATA_ATTR: false,
    });
    // Only generated KaTeX markup crosses this boundary; user HTML keeps the original narrow allowlist.
    return clean.replace(new RegExp(`${prefix}(\\d+)END`, 'g'), (_, index: string) => fragments[Number(index)]);
}
