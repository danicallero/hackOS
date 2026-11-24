import { cn } from "@/lib/utils";

/** Page canvas; the shell owns viewport padding, the page owns its reading width. */
export function PageLayout({
  width = "content",
  stickyChrome = false,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  width?: "content" | "reading" | "workspace";
  /** The page's header and list toolbar stay pinned while it scrolls (see `PageHeader sticky`). */
  stickyChrome?: boolean;
}) {
  return (
    <div
      data-page-layout={width}
      data-wide={width === "workspace" ? "" : undefined}
      data-sticky-chrome={stickyChrome ? "" : undefined}
      className={cn(
        "mx-auto w-full min-w-0 space-y-(--page-section-gap)",
        width === "content" && "max-w-(--page-width-content)",
        width === "reading" && "max-w-(--page-width-reading)",
        className,
      )}
      {...props}
    />
  );
}
