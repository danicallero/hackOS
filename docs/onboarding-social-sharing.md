# Onboarding social sharing

Reusable web component that lets an attendee share "I'm going" with a
personalised image. It lives in
`apps/web/src/components/onboarding/social-sharing.tsx`; the embedding flow owns
placement, routing and the signed-in data.

## Interface

```tsx
<SocialSharing
  event={{ name: "HackUDC", year: 2027, dateLabel?, location?, url?, logo? }}
  attendee={{ displayName, roleLabel?, photoUrl? }}
  onContinue={() => …}   // optional
/>
```

- `dateLabel` and `location` are printed exactly as supplied, on the pass
  header and in the caption. Nothing is derived or invented: without them the
  header has no date.
- `url` is the public event page. It goes in the caption and its host on the
  image. Only http(s) is accepted; username, password, query and fragment are
  dropped (`publicEventUrl`), so no token or tracking parameter can travel.
- `photoUrl` is the authenticated `/api/users/:id/photo` path (or a
  `blob:`/`data:image/`/`http(s)` URL). Other schemes are rejected.
- `logo` is an optional same-origin or CORS-enabled image for non-HackUDC
  events; HackUDC uses the pass strip.
- `onContinue` renders one footer button: **Skip** until the person downloads,
  copies, shares or opens a network link, then **Continue**.

## The step

One preview, **Download image** as the primary action, **Share** as a menu
(LinkedIn, X, Copy text, and "Send image…" where the browser can share files),
and a quiet format selector (Horizontal, Cuadrado, Vertical, Historia). The "LinkedIn and X don't attach the
image" note lives inside the menu. Feedback uses the shared toast. Structure
follows the Wallet pass on the profile (bounded surface, official artwork,
quiet secondary actions), not a custom panel.

## The image

Drawn client-side on a canvas, exported as PNG at 2×. No image service.

| Format | Logical size | PNG | Use |
| --- | --- | --- | --- |
| Landscape | 1200×630 | 2400×1260 | 1.91:1 link card (LinkedIn, X) |
| Square | 1080×1080 | 2160×2160 | Feed square |
| Portrait | 1080×1350 | 2160×2700 | Instagram 4:5 |
| Story | 1080×1920 | 2160×3840 | 9:16 story; content kept clear of the top and bottom interface bands |

The pass is the Apple Wallet pass at its real proportions (838×1165): organizer
logo and date in the header, the strip, NAME and ROLE side by side (red mono
labels, Inter values), and the photo where the QR sits (initials on ink when
there is no photo). It is drawn slightly tilted on the ink canvas with Emilia
the seagull perched on it. All text is left-aligned on one margin. Landscape and Square put the text
column (event line, name as the hero, role, host) on the left and the tilted
pass on the right. Portrait and Story stack the text on top, anchor the pass to
the right below it and put the host (the link, larger in Story) under it on the
left; the column is centred in the format's safe band and the pass is scaled to
fill what is left. The pass header shows the supplied date with the year
(`dateWithYear`: "26 - 28 feb" becomes "26 - 28 feb 2027" unless the label
already has it); the host line adds the supplied location. Long names shrink
and wrap (up to three lines in Square). No email, QR, badge or ticket credentials ever appear.

Assets, all copied from the repo into `apps/web/public/onboarding/`:

| File | Source |
| --- | --- |
| `pass-strip.png` | `apps/api/assets/apple-wallet/strip@3x.png` (lighthouse + HackUDC 2027) |
| `gpul-logo.png` | `apps/api/assets/apple-wallet/logo@2x.png`, recoloured ink for the blue body |
| `emilia.png` | `apps/web/public/errors/emilia-404.png`, trimmed and scaled |

Palette: ink `#030846`, brand blue `#a3d5ff` (the Wallet pass colour), red
labels `#bf2100`. Inter for values (the page's own stack), a system mono for the
pass labels and date, matching the pass.

- Photo: read with `fetch(..., { credentials: "include" })` into a blob, then
  `createImageBitmap`, so the private route is authorized by the session cookie
  and the canvas is never tainted. A failed photo falls back to initials and
  shows a short note; it is retried on the next render. The component owns one
  decoded photo bitmap and closes it when replaced, removed or unmounted; late
  decodes and a custom event logo are closed too.
- Fonts: `document.fonts.load` for the page's Inter stack before drawing; a
  failure keeps the fallback stack.

### Design notes (Instagram)

Collected from public design guides, not Meta documentation, so treat the
numbers as conservative defaults:

- Story: keep text clear of roughly the top 250 px and bottom 250-350 px, where
  Instagram overlays profile and reply UI; one focal point, large bold type,
  hook then value then call to action top to bottom
  ([story size guide](https://www.inro.social/blog/instagram-story-size),
  [story design tips](https://designshack.net/articles/graphics/instagram-story-design),
  [layout ideas](https://postsyncer.com/blog/instagram-story-layout-ideas)).
- Feed: design at 4:5 (1080×1350) and keep key content in a centred 3:4 area,
  since the profile grid crops to 3:4
  ([image sizes](https://postsyncer.com/tips/instagram-image-sizes-complete-guide),
  [post size guide](https://creatorflow.so/blog/instagram-post-size-guide/)).

## Sharing behaviour

Every action needs an explicit click; mounting only renders the preview.

- **Download image** saves `hackudc-2027-<name>-<format>.png`.
- **LinkedIn** opens `linkedin.com/feed/?shareActive=true&text=<caption>` and
  **X** opens `x.com/intent/post?text=<caption>` in a new tab (`noopener`). The
  caption ends with the event link when `url` is given, which both networks turn
  into a link preview of the event page. Neither accepts an image through a
  link: LinkedIn's offsite share takes only a `url` (preview from the page's
  Open Graph tags) and the text prefill is an undocumented parameter, so the
  generated PNG has to be uploaded by the person. The `text` prefill was not
  verified against a signed-in LinkedIn session.
- **Send image…** appears only where `navigator.canShare({ files })` is true and
  hands the PNG and caption to the system share sheet, which is the one path
  that attaches the image to a post.
- A personalised link preview would need a server-rendered Open Graph image on
  a per-person URL, which this component does not do (no tokens in shared URLs).

## Copy

Strings live in `social-sharing.locales.json` (es/gl/en, identical keys,
enforced by the component test) and are read by `useLocale().language`. To fold
them into the shared catalogue, move the keys into
`packages/shared/locales/{es,gl,en}/web.json` and switch the component to `t()`.

## Accessibility

Radio group for the format; preview `alt` names the attendee and event;
the loading skeleton is a labelled status; `role="alert"` with retry on render
errors; the Share menu is the shared Radix menu; the only animation is the
shared skeleton/spinner (`motion-safe`). Controls use the shared Button sizes.

## Tests

`pnpm --filter @hackos/web exec vitest run src/components/onboarding` covers the
caption and links (including URL sanitising), drawing (photo tile, initials
fallback, strip/logo/text bands, seagull, host, truncation, both ratios), photo
fetching and scheme rejection, the component's click-only behaviour, menu,
fallbacks, errors, Skip/Continue and language, and the bitmap lifecycle.
