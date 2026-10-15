/**
 * H16: project descriptions imported from the previous submission platform arrive with their section
 * headings flattened into one line ("## Inspiration Diariamente…"). These
 * helpers restore readable markdown for detail views and a plain summary for
 * lists.
 */
const SUBMISSION_HEADINGS = [
  "Inspiration",
  "What it does",
  "How we built it",
  "How I built it",
  "Challenges we ran into",
  "Challenges I ran into",
  "Accomplishments that we're proud of",
  "Accomplishments that I'm proud of",
  "What we learned",
  "What I learned",
  "Built with",
];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Put every `## Heading` on its own line, splitting the known section titles from their text. */
export function normalizeProjectMarkdown(text: string, projectName?: string): string {
  if (/\n\s*#{1,6}\s/.test(text) || !/(^|\s)#{2,3}\s/.test(text)) return text.trim();
  const titles = [
    ...SUBMISSION_HEADINGS,
    ...(projectName ? [`What's next for ${projectName}`] : []),
    "What's next",
  ].map(escapeRegExp);
  const known = new RegExp(`^(${titles.join("|")})\\b\\s*`, "i");
  return text
    .split(/\s*#{2,3}\s+/)
    .map((part, index) => {
      if (index === 0) return part.trim();
      const match = part.match(known);
      // An unknown heading cannot be told apart from its text: keep it as a paragraph.
      if (!match) return part.trim();
      return `## ${match[1]}\n\n${part.slice(match[0].length).trim()}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

/** Plain text for a clamped summary: no headings, emphasis, links or list markers. */
export function projectSummary(text: string | null | undefined, projectName?: string): string {
  if (!text) return "";
  return normalizeProjectMarkdown(text, projectName)
    .split("\n")
    .filter((line) => !/^\s*#{1,6}\s/.test(line))
    .join(" ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>]+/g, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
