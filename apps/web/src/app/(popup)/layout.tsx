import { AuthGuard } from "@/components/layout/auth-guard";

/**
 * Bare shell for standalone windows opened out of the main app (currently
 * just the review composer popup) — no sidebar, no top bar, so the window
 * itself is the whole surface. Still behind `AuthGuard`: a popup URL is a
 * real, bookmarkable route and must not skip the session check.
 */
export default function PopupLayout({ children }: { children: React.ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>;
}
