"use client";

import { useEffect, useRef, useState } from "react";
import { ActionGroup } from "@/components/common/action-group";
import { PageTitle } from "@/components/common/page-title";
import { cn } from "@/lib/utils";

/**
 * Title-first page hierarchy for authenticated screens. Descriptions are for
 * exceptional policy or risk copy; actions expose their priority explicitly.
 */
export function PageHeader({
  context,
  leading,
  title,
  tabTitle,
  state,
  meta,
  description,
  primaryAction,
  secondaryActions,
  actions,
  nav,
  sticky = false,
  className,
  headingLevel = 1,
  reserveNavigation = true,
}: {
  context?: React.ReactNode;
  /**
   * Visual identity for record pages (an avatar, a logo). Never a page action;
   * the only control it may hold is a menu that edits that same image.
   */
  leading?: React.ReactNode;
  title: string;
  /** Use the active destination when sibling screens share a visible heading. */
  tabTitle?: string;
  /** Embedded design specimens use h2; destinations always keep the default h1. */
  headingLevel?: 1 | 2;
  /** Narrow screens leave room for the app's sidebar trigger; public pages have none. */
  reserveNavigation?: boolean;
  /** Record state; leads the line under the title, ahead of `meta`, never beside the title. */
  state?: React.ReactNode;
  /** Identity metadata under the title (email, badge id) — not a description. */
  meta?: React.ReactNode;
  description?: string;
  primaryAction?: React.ReactNode;
  secondaryActions?: React.ReactNode;
  /**
   * Sibling-route navigation of the section. Sits on the title's row from md up
   * (and below it on narrow screens) so it does not cost a row of its own.
   */
  nav?: React.ReactNode;
  /**
   * List pages: the header stays pinned while the content scrolls and its title
   * condenses (transform only, so nothing below moves). Toolbars inside a
   * `[data-sticky-chrome]` canvas pin right beneath it.
   */
  sticky?: boolean;
  /** @deprecated Prefer primaryAction and secondaryActions to make priority explicit. */
  actions?: React.ReactNode;
  className?: string;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const actionContent =
    primaryAction || secondaryActions ? (
      <>
        {secondaryActions}
        {primaryAction}
      </>
    ) : (
      actions
    );

  const header = (
    <header
      className={cn(
        "flex min-h-(--control-height-default) flex-col gap-(--space-within-section) md:flex-row md:justify-between",
        nav ? "md:items-center" : "md:items-start",
        className,
      )}
    >
      {headingLevel === 1 && <PageTitle title={tabTitle ?? title} />}
      <div
        className={cn(
          "flex min-w-0 items-start gap-(--space-related) md:pl-0",
          // The sidebar control sits beside a shell notice when one is shown, not over the title.
          reserveNavigation && "pl-12 group-has-[[data-shell-notice]]/shell:pl-0 md:pl-0",
        )}
      >
        {leading && <div className="shrink-0">{leading}</div>}
        <div className="min-w-0 space-y-1">
          {context && <div className="type-meta">{context}</div>}
          <div className="heading-row min-h-(--line-height-page-title) flex flex-wrap items-center gap-(--space-related)">
            <Heading className="type-page-title text-balance">{title}</Heading>
          </div>
          {(state || meta) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {state}
              {meta}
            </div>
          )}
          {description && (
            <p className="max-w-prose text-muted-foreground text-pretty text-sm">{description}</p>
          )}
        </div>
      </div>
      {nav && <div className="min-w-0 md:mr-auto md:ml-4">{nav}</div>}
      {actionContent && (
        <ActionGroup className="md:shrink-0 md:justify-end">{actionContent}</ActionGroup>
      )}
    </header>
  );
  return sticky ? <StickyFrame>{header}</StickyFrame> : header;
}

/**
 * Pins its header and condenses the title once the page scrolls. The state comes
 * from an IntersectionObserver on a sentinel above the frame, never from a scroll
 * handler, and only transform/opacity change, so scrolling never re-lays the
 * content out and cannot oscillate around the threshold. The frame publishes its
 * height as `--sticky-header-h` for the toolbar that pins beneath it.
 */
function StickyFrame({ children }: { children: React.ReactNode }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [condensed, setCondensed] = useState(false);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setCondensed(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      { threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--sticky-header-h", `${node.offsetHeight}px`);
    publish();
    if (typeof ResizeObserver === "undefined")
      return () => root.style.removeProperty("--sticky-header-h");
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--sticky-header-h");
    };
  }, []);
  return (
    <>
      <div ref={sentinel} aria-hidden="true" className="-mb-px h-px" />
      <div
        ref={frame}
        data-sticky-header
        data-condensed={condensed ? "" : undefined}
        style={{ viewTransitionName: "section-header" }}
      >
        {children}
      </div>
    </>
  );
}
