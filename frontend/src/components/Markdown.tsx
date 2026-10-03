/**
 * The small Markdown subset the knowledge cards actually use.
 *
 * Counted across `backend/knowledge/`: `##`/`###` headings, `-` lists, `**bold**`, and
 * paragraphs. That is the whole vocabulary, so this renders it directly rather than pulling in
 * a Markdown library and a sanitiser for three features.
 *
 * It never sets `innerHTML`: inline spans are built as React nodes, so card text cannot inject
 * markup even though it arrives over the network.
 */

import type { ReactNode } from 'react';

export function Markdown({ source }: { source: string }) {
  return <div className="col" style={{ gap: 8 }}>{blocks(source)}</div>;
}

function blocks(source: string): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let list: string[] = [];

  const flushList = () => {
    if (!list.length) return;
    out.push(
      <ul key={`ul-${out.length}`} className="body-sm" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {list.map((item, i) => <li key={i} style={{ fontSize: 13, lineHeight: 1.6 }}>{inline(item)}</li>)}
      </ul>,
    );
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);

    if (heading) {
      flushList();
      const level = heading[1].length;
      out.push(
        <div
          key={`h-${out.length}`}
          style={{ font: `600 ${level <= 2 ? 14 : 13}px/1.38 var(--font)`, marginTop: out.length ? 6 : 0 }}
        >
          {inline(heading[2])}
        </div>,
      );
    } else if (bullet) {
      list.push(bullet[1]);
    } else if (!line.trim()) {
      flushList();
    } else {
      flushList();
      out.push(
        <p key={`p-${out.length}`} className="body-sm" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
          {inline(line)}
        </p>,
      );
    }
  }
  flushList();
  return out;
}

/** `**bold**` and `` `code` ``, as React nodes rather than HTML. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const token = m[0];
    if (token.startsWith('**')) {
      out.push(<strong key={`${at}`} className="ink">{token.slice(2, -2)}</strong>);
    } else {
      out.push(
        <code key={`${at}`} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}>
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
