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

/** Colour of an icon standing in for the status dot. */
export const TONE_ICON: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  brand: "text-primary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-info",
};
