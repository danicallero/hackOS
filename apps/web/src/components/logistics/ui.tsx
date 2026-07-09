import { XIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";

/** Turn an unknown thrown value into a message, preferring ApiError copy. */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/** Labelled form field wrapper used across the logistics stations. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/** Inline error banner shown under a scanner/form action. */
export function InlineError({ message }: { message: string }) {
  return (
    <div className="border-destructive/40 bg-destructive/10 text-destructive flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
      <XIcon className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
