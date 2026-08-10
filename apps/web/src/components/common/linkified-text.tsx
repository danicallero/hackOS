// Renders plain text with bare URLs turned into links — for short helper/hint
// strings (e.g. a template field's help text) where authors paste a raw URL
// rather than markup. No HTML is ever parsed from the input.

const URL_RE = /(https?:\/\/[^\s<>()]+)/g;

export function LinkifiedText({ text, className }: { text: string; className?: string }) {
  // A capturing group in the split pattern interleaves matched URLs at odd
  // indices with surrounding plain text at even indices.
  const parts = text.split(URL_RE);
  return (
    <span className={className}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are derived from a static split, not reorderable
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline">
            {part}
          </a>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are derived from a static split, not reorderable
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  );
}
