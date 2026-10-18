/** Opens the evaluation in a small window that outlives a trip to another tab (same approach as the application review). */
export async function openReviewWindow(url: string, title: string): Promise<Window | null> {
  // Document Picture-in-Picture keeps the window above other apps, Chromium only
  // and needing a user gesture; other browsers get an ordinary popup.
  const pip = (
    window as unknown as {
      documentPictureInPicture?: {
        requestWindow: (options: { width: number; height: number }) => Promise<Window>;
      };
    }
  ).documentPictureInPicture;
  if (pip) {
    try {
      const pipWindow = await pip.requestWindow({ width: 440, height: 680 });
      const iframe = pipWindow.document.createElement("iframe");
      iframe.src = url;
      iframe.style.cssText = "position:fixed;inset:0;width:100%;height:100%;border:0;";
      pipWindow.document.body.style.margin = "0";
      pipWindow.document.title = title;
      pipWindow.document.body.append(iframe);
      return pipWindow;
    } catch {
      // Denied or already open: fall through to the plain popup.
    }
  }
  const popup = window.open(
    url,
    "hackos-judging-review-window",
    "popup=yes,width=440,height=680,resizable=yes,scrollbars=yes",
  );
  popup?.focus();
  return popup;
}
