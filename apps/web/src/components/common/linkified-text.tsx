// Renders plain text with links turned into <a> tags — for short helper/hint
// strings (e.g. a template field's help text or a required checkbox's
// consent label) where authors paste a raw URL or a markdown-style
// `[label](url)` link. No other markdown or HTML is ever parsed from the
// input — this is intentionally not a full markdown renderer.

const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+)/g;

export function LinkifiedText({ text, className }: { text: string; className?: string }) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const match of text.matchAll(LINK_RE)) {
    const [full, mdLabel, mdHref, bareUrl] = match;
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push(<span key={key++}>{text.slice(lastIndex, index)}</span>);
    const href = mdHref ?? bareUrl;
    parts.push(
      <a key={key++} href={href} target="_blank" rel="noopener noreferrer" className="underline">
        {mdLabel ?? bareUrl}
      </a>,
    );
    lastIndex = index + full.length;
  }
  if (lastIndex < text.length) parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
  return <span className={className}>{parts}</span>;
}
