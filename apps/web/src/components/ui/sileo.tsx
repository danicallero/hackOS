"use client";

import { useTheme } from "next-themes";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { Toaster as SileoToaster, sileo } from "sileo";
import { useLocale } from "@/lib/i18n";

type SileoToasterProps = ComponentProps<typeof SileoToaster>;
type ToastTarget = { id: string; node: HTMLElement };

function readToastId(node: HTMLElement) {
  const filter = node.querySelector<SVGFilterElement>(
    '[data-sileo-svg] filter[id^="sileo-gooey-"]',
  );
  return filter?.id.replace("sileo-gooey-", "") ?? null;
}

function useToastTargets(rootRef: React.RefObject<HTMLDivElement | null>) {
  const [targets, setTargets] = useState<ToastTarget[]>([]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const sync = () => {
      const next = Array.from(root.querySelectorAll<HTMLElement>("[data-sileo-toast]"))
        .map((node) => {
          const id = readToastId(node);
          const header = node.querySelector<HTMLElement>("[data-sileo-header]");
          return id && header ? { id, node } : null;
        })
        .filter((target): target is ToastTarget => target !== null);

      setTargets((current) => {
        if (
          current.length === next.length &&
          current.every(
            (target, index) =>
              target.id === next[index]?.id &&
              target.node === next[index]?.node,
          )
        ) {
          return current;
        }
        return next;
      });
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state", "data-exiting"],
    });
    return () => observer.disconnect();
  }, [rootRef]);

  return targets;
}

function ToastCloseLayer({
  rootRef,
  theme,
}: {
  rootRef: React.RefObject<HTMLDivElement | null>;
  theme: "light" | "dark";
}) {
  const { t } = useLocale();
  const targets = useToastTargets(rootRef);

  useEffect(() => {
    const mounted = targets
      .filter(({ node }) => node.dataset.exiting !== "true")
      .map(({ id, node }) => {
        // Sileo's toast root is a button and owns its mouseleave handler. Mount
        // the dismiss control as a real DOM child so moving onto it stays
        // inside that same hit area (a React portal only looks nested visually;
        // it is not part of Sileo's event ancestry).
        const close = document.createElement("span");
        close.setAttribute("role", "button");
        close.setAttribute("aria-label", t("close"));
        close.setAttribute("tabindex", "0");
        close.dataset.hackosToastClose = "";
        close.dataset.hackosToastCloseId = id;
        close.dataset.theme = theme;

        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "2.25");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", "M18 6 6 18M6 6l12 12");
        svg.append(path);
        close.append(svg);

        const stop = (event: Event) => {
          event.preventDefault();
          event.stopPropagation();
        };
        const dismiss = (event: Event) => {
          stop(event);
          sileo.dismiss(id);
        };
        const onKeyDown = (event: KeyboardEvent) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          dismiss(event);
        };

        close.addEventListener("pointerdown", stop);
        close.addEventListener("click", dismiss);
        close.addEventListener("keydown", onKeyDown);
        node.append(close);

        return () => {
          close.removeEventListener("pointerdown", stop);
          close.removeEventListener("click", dismiss);
          close.removeEventListener("keydown", onKeyDown);
          close.remove();
        };
      });

    return () => mounted.forEach((cleanup) => cleanup());
  }, [t, targets, theme]);

  return null;
}

const Toaster = ({ options, theme: requestedTheme, ...props }: SileoToasterProps) => {
  const { resolvedTheme } = useTheme();
  const theme =
    requestedTheme === "light" || requestedTheme === "dark"
      ? requestedTheme
      : resolvedTheme === "light"
        ? "light"
        : "dark";
  const rootRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={rootRef}
      data-hackos-toast-boundary
      // Toasts are a sibling of dialogs in the provider tree. Prevent the
      // pointer's default focus transfer, then stop the click at this boundary
      // so Radix outside-interaction handlers keep the active modal in place.
      onPointerDownCapture={(event) => {
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest("[data-hackos-toast-close], [data-sileo-button]")
        ) {
          return;
        }
        event.preventDefault();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <SileoToaster
        {...props}
        theme={theme}
        options={{
          roundness: 16,
          ...options,
        }}
      />
      <ToastCloseLayer rootRef={rootRef} theme={theme} />
    </div>
  );
};

export { Toaster };
