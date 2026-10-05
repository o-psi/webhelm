import React from 'react';
import {ComposerOptions} from './ComposerOptions';

/** Compact presentation only; adapters retain choices, authority and effects. */
export function ComposerConfiguration({context,primary,advanced}:{context?:{summary:React.ReactNode;controls?:React.ReactNode};primary:React.ReactNode;advanced:React.ReactNode}){
    return <div className="composer-configuration">
        {context&&(context.controls?<details className="composer-config-destination"><summary>{context.summary}</summary><div className="composer-config-context">{context.controls}</div></details>:<div className="composer-config-bound">{context.summary}</div>)}
        <ComposerOptions className="composer-config-primary">{primary}</ComposerOptions>
        <details className="composer-config-more"><summary>More options</summary><div className="composer-config-advanced">{advanced}</div></details>
    </div>;
}
