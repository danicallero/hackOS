# Onboarding social sharing

Reusable web component that lets an attendee share "I'm going" on LinkedIn or X
with a personalised image. Lives in
`apps/web/src/components/onboarding/social-sharing.tsx`; the embedding flow owns
placement, routing and the signed-in data.

## Interface

```tsx
<SocialSharing
  event={{ name: "HackUDC", year: 2027, dateLabel?, location?, logo? }}
  attendee={{ displayName, roleLabel?, photoUrl? }}
  onContinue={() => …}   // optional
/>
```

- `dateLabel` and `location` are printed only when supplied; nothing is derived
  or invented, and the card/caption omit them otherwise.
- `photoUrl` is the authenticated `/api/users/:id/photo` path (or a
  `blob:`/`data:image/`/`http(s)` URL). Other schemes are rejected.
- `logo` is an optional same-origin or CORS-enabled image. Without it the
  bundled HackUDC wordmark is used when the event name contains "HackUDC";
  other events get their name drawn as text.
- `onContinue` renders one footer button: **Skip** until the person downloads,
  copies, shares or opens a network link, then **Continue**.

## How the image is made

Drawn client-side on a canvas, exported as PNG at 2× (landscape 1200×630 →
2400×1260, the 1.91:1 link-card ratio; square 1080² → 2160²). No image service.

- Photo: read with `fetch(..., { credentials: "include" })` into a blob, then
  `createImageBitmap`, so the private route is authorized by the session cookie
  and the canvas is never tainted. A failed photo falls back to initials on an ink
  disc and shows a short note; it is retried on the next render.
- Fonts: `document.fonts.load` for Rockwell (theme.css `@font-face`) and the
  page's Inter stack before drawing. A load failure keeps the fallback stack.
- Brand assets (`apps/web/public/onboarding/`, from the HackUDC 2027 brand
  files): `hackudc-2027-logo.png` (navy wordmark, same as `public/email`),
  `galeria.png` (Coruña gallery facade), `gaviota.png` (seagull).
- Palette is the edition's: ink `#030846`, brand blue `#a3d5ff`, cream, red rule.
  Long names shrink then truncate with an ellipsis.

## Sharing behaviour

Every action needs an explicit click; mounting only renders the preview.

- **Download image** saves the generated PNG (`hackudc-2027-<name>-<format>.png`).
- **Copy text** writes the caption to the clipboard.
- **Share on LinkedIn / X** open the composer in a new tab (`noopener`) with the
  caption prefilled (`linkedin.com/feed/?shareActive=true&text=`,
  `x.com/intent/post?text=`). Links cannot attach an image, so the UI says to
  attach the downloaded file. No token, user id, tracking parameter or event URL
  is added.
- **Share…** appears only where `navigator.canShare({ files })` is true and
  passes the PNG and caption to the system share sheet.
- The caption is editable and follows the viewer's language (es/gl/en).

## Copy

Strings live in `social-sharing.locales.json` (es/gl/en, identical keys,
enforced by the component test) and are read by `useLocale().language`. To fold
them into the shared catalogue, move the keys into
`packages/shared/locales/{es,gl,en}/web.json` and switch the component to `t()`.

## Accessibility

Radio group for the format; labelled caption field; preview `alt` names the
attendee and event; `role="status"` announces generation, success and failure;
`role="alert"` on render errors with a retry; the only animation is the shared
spinner (`motion-safe`). Controls use the shared Button sizes (44 px touch
targets on coarse pointers).

## Tests

`pnpm --filter @hackos/web exec vitest run src/components/onboarding` covers the
caption/links, drawing (photo crop, initials fallback, truncation, both ratios),
photo fetching and scheme rejection, and the component's click-only behaviour,
fallbacks, errors, Skip/Continue and language.
