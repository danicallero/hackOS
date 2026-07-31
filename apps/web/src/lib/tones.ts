/**
 * Semantic tones shared by badges, stat cards, meters and charts so status
 * colors mean the same thing everywhere. Values reference theme tokens from
 * globals.css — never hardcode a hex in a component; pick a tone.
 */
export type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

export const TONE_BADGE: Record<Tone, string> = {
  // Badge text uses the theme foreground over a low-alpha semantic wash. The
  // tone remains visible in the border/dot while the rendered text/background
  // pair stays readable in both themes (H24/H38/H50). Measured WCAG contrast
  // for foreground over a 10% wash composited on each theme surface is
  // 11.27–11.80:1 in light mode and 5.46–7.18:1 in dark mode.
  neutral: "border-border bg-muted text-foreground",
  brand: "border-primary/30 bg-primary/10 text-foreground",
  success: "border-success/30 bg-success/10 text-foreground",
  warning: "border-warning/40 bg-warning/10 text-foreground",
  danger: "border-destructive/30 bg-destructive/10 text-foreground",
  info: "border-chart-1/40 bg-chart-1/10 text-foreground",
};

export const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  brand: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-chart-1",
};

/** Foreground/fill color for a tone (charts, meters, icons). */
export const TONE_FG: Record<Tone, string> = {
  neutral: "var(--muted-foreground)",
  brand: "var(--primary)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--destructive)",
  info: "var(--chart-1)",
};
