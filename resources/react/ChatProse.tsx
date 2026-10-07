import React, {memo, useMemo} from 'react';
import {prose} from './chat-prose';

export const ChatProse = memo(function ChatProse({text}: {text: string}) {
    const html = useMemo(() => prose(text), [text]);
    return <div className="prose" dangerouslySetInnerHTML={{__html:html}}/>;
});
