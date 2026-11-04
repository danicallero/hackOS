/**
 * Semantic tones shared by badges, stat cards, meters and charts so status
 * colors mean the same thing everywhere. Values reference theme tokens from
 * globals.css — never hardcode a hex in a component; pick a tone.
 */
export type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

export const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  brand: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
};
