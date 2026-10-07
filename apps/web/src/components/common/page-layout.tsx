import { cn } from "@/lib/utils";

/** Page canvas; the shell owns viewport padding, the page owns its reading width. */
export function PageLayout({
  width = "content",
  className,
  ...props
}: React.ComponentProps<"div"> & {
  width?: "content" | "reading" | "workspace";
}) {
  return (
    <div
      data-page-layout={width}
      data-wide={width === "workspace" ? "" : undefined}
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
