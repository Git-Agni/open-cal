import { Fragment } from "react";

/**
 * Description text with links. Understands `[label](https://...)` and bare https:// links;
 * newlines stay newlines (the parent keeps `white-space: pre-line`). Never renders HTML from
 * the text.
 */

const TOKEN = /\[([^\]\n]{1,120})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,!?;:'"])/g;

export function RichText({ text, className }: { text: string; className?: string }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    const href = m[2] ?? m[3];
    const label = m[1] ?? m[3].replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    out.push(
      <a key={i} href={href} target="_blank" rel="noopener noreferrer">
        {label}
      </a>,
    );
    last = i + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <span className={className}>{out.map((x, i) => <Fragment key={i}>{x}</Fragment>)}</span>;
}
