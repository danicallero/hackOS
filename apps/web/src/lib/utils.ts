import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge the theme radius tokens so `rounded-control` and
// `rounded-button` override each other instead of coexisting.
const twMerge = extendTailwindMerge({
  extend: { theme: { radius: ["button", "control", "surface", "overlay", "frame"] } },
});

/** Merge Tailwind class lists, letting later classes win conflicts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
