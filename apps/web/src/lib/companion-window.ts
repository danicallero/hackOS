// The Document Picture-in-Picture API (Chromium-only as of writing) is the
// one real, spec-guaranteed way a page can put its own content in a window
// the OS keeps above everything else. TypeScript's DOM lib doesn't ship
// types for it yet, so it's declared narrowly here — only the bits used
// below — rather than pulling in a whole ambient-types package for one API.
declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
    };
  }
}

interface CompanionWindowOptions {
  url: string;
  title: string;
  /** `window.open` target name, so repeated opens reuse one popup. */
  name: string;
  width: number;
  height: number;
  /** Fires once the picture-in-picture or popup window goes away. */
  onClosed?: () => void;
}

/**
 * Opens a small review window that outlives a trip to another tab.
 *
 * Document Picture-in-Picture is the only web-platform API that lets a page's
 * own window be kept above other windows by the browser/OS. It needs a user
 * gesture, so this is a best-effort upgrade: browsers without it (Firefox,
 * Safari) or a denied request fall through to an ordinary popup, which has no
 * scripted way to stay on top. Returns null when the popup is blocked.
 */
export async function openCompanionWindow({
  url,
  title,
  name,
  width,
  height,
  onClosed,
}: CompanionWindowOptions): Promise<Window | null> {
  if (window.documentPictureInPicture) {
    try {
      const pipWindow = await window.documentPictureInPicture.requestWindow({ width, height });
      const iframe = pipWindow.document.createElement("iframe");
      iframe.src = url;
      iframe.style.cssText = "position:fixed;inset:0;width:100%;height:100%;border:0;";
      pipWindow.document.body.style.margin = "0";
      pipWindow.document.title = title;
      pipWindow.document.body.append(iframe);
      if (onClosed) pipWindow.addEventListener("pagehide", onClosed);
      return pipWindow;
    } catch {
      // Denied (no user gesture in this call stack, one already open): use the popup.
    }
  }
  const popup = window.open(
    url,
    name,
    `popup=yes,width=${width},height=${height},resizable=yes,scrollbars=yes`,
  );
  // A single, immediate focus on open — not a repeated/refocus loop, which
  // would steal focus back from whatever the reviewer clicks into next.
  if (popup) {
    popup.focus();
    if (onClosed) popup.addEventListener("unload", onClosed);
  }
  return popup;
}
