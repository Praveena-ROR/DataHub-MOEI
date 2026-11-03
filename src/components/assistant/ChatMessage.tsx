import { Fragment, type ReactNode } from 'react';
import avatar from '../../assets/business-division-assistant.png';
import type { ChatMessage as Message } from '../../data/assistant.ts';

const timeOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

/** The assistant's avatar: the supplied artwork, scaled without cropping. */
export function AssistantAvatar({ size }: { size: number }) {
  return <img className="assistant-avatar" src={avatar} width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
}

/**
 * Inline Markdown used by agent replies: **bold**, *italic*, `code` and
 * [links](https://…). Built as React nodes; nothing is inserted as HTML, and
 * only http(s) links are made clickable.
 */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${m.index}`;
    if (m[1] !== undefined) out.push(<strong key={key}>{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<em key={key}>{m[2]}</em>);
    else if (m[3] !== undefined) out.push(<code key={key}>{m[3]}</code>);
    else out.push(<a key={key} href={m[5]} target="_blank" rel="noopener noreferrer">{m[4]}</a>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Paragraphs, line breaks and "-" / "1." lists from a Markdown reply. */
function MarkdownText({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, b) => {
        const lines = block.split('\n');
        const bullet = lines.every((l) => /^\s*[-*•]\s+/.test(l));
        const numbered = lines.every((l) => /^\s*\d+[.)]\s+/.test(l));
        if (bullet || numbered) {
          const items = lines.map((l, i) => <li key={i}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''), `${b}-${i}`)}</li>);
          return numbered ? <ol key={b}>{items}</ol> : <ul key={b}>{items}</ul>;
        }
        return (
          <p key={b}>
            {lines.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{inline(l, `${b}-${i}`)}</Fragment>)}
          </p>
        );
      })}
    </>
  );
}

/** Under a user message: whether the agent received it and whether it answered. */
const DELIVERY_LABELS = { 'not-sent': 'Not sent', 'no-reply': 'Sent · no reply' } as const;

export function ChatMessage({ message }: { message: Message }) {
  const mine = message.role === 'user';
  const failed = message.delivery === 'not-sent' || message.delivery === 'no-reply' ? message.delivery : null;
  return (
    <div className={`chat-msg ${mine ? 'chat-msg-user' : 'chat-msg-assistant'}${failed ? ` chat-msg-${failed}` : ''}`}>
      {!mine && <AssistantAvatar size={28} />}
      <div className="chat-msg-body">
        <div className="chat-bubble">
          <span className="visually-hidden">{mine ? 'You said:' : 'Assistant said:'}</span>
          {mine ? message.text : <MarkdownText text={message.text} />}
        </div>
        <div className="chat-msg-meta">{failed ? `${timeOf(message.at)} · ${DELIVERY_LABELS[failed]}` : timeOf(message.at)}</div>
      </div>
    </div>
  );
}
