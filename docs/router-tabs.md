# RouterTabs: a platform-adaptive Expo Router tab bar

`RouterTabs` is hackOS's reusable custom tab shell for Expo Router. It keeps
the interaction model of a native tab bar while making the visual surface
available on every platform:

- iOS 26+ uses the real `expo-glass-effect` Liquid Glass material.
- Earlier iOS versions and Android use the same layout, hit targets, gesture
  model, and overflow menu with an opaque, colour-scheme-aware surface.
- Four direct tabs and a separate overflow circle are used when navigation is
  crowded. Five direct tabs fit on compact layouts when there is no overflow;
  tablet-width layouts fit six.
- The direct surface is one continuous scrub area. The selection lens follows
  the finger on the UI thread and navigation commits to the cell under the
  finger when the gesture ends.
- The shell publishes its geometry to route content, so scrollable screens can
  finish above the floating bar without copying device-specific constants.

The shell is generic in code and deliberately has no hackOS capability, copy,
icon-library, or route-policy dependency. It is not published as an npm
package yet, but the public API is already package-shaped: a consumer can use
the source in any Expo Router app, or later consume the same API from a package
without changing its navigation policy. The app-specific adapter is
[`opaque-router-tabs.tsx`](../apps/mobile/components/opaque-router-tabs.tsx);
the reusable shell is
[`router-tabs.tsx`](../apps/mobile/components/router-tabs.tsx).

Story: H55.

## Design boundary

The component has two layers:

| Layer | Owns | Does not own |
| --- | --- | --- |
| `RouterTabs` | Expo Router tab registration, direct-tab rendering, Liquid Glass/opaque geometry, scrub gesture, selection lens, safe-area contract, direct-tab press callbacks | Capabilities, localization, icon choice, overflow destination policy, native menu actions |
| `OpaqueRouterTabs` | hackOS capabilities, localized labels, SF Symbols, unread state, direct/overflow partitioning, `MenuView` actions, pseudo-tab replacement semantics | The shell's geometry or gesture implementation |

Keep this boundary when adding destinations. A library consumer should be able
to provide an arbitrary `Href`, icon React nodes, labels, and an already-built
overflow control without importing hackOS navigation or capability code.

## Requirements

The shell is designed for an Expo Router app with these runtime peers:

- `expo-router` with the `expo-router/ui` headless tabs primitives;
- `react-native-gesture-handler` for the horizontal scrub gesture;
- `react-native-reanimated` for the UI-thread selection lens;
- `react-native-safe-area-context` for the published bottom clearance; and
- `expo-glass-effect` for the built-in Liquid Glass renderer.

With Expo, install the versions matched to the app's SDK rather than copying
the versions from another project:

```sh
npx expo install expo-router expo-glass-effect \
  react-native-gesture-handler react-native-reanimated \
  react-native-safe-area-context
```

The app root must already be configured for Gesture Handler and Reanimated,
using Expo's normal setup. The shell should be rendered in a tab layout whose
root can host an Expo Router `TabSlot`; it is not a replacement for the root
router or for a stack inside an individual tab.

## Minimal integration

`RouterTabs` must be rendered inside an Expo Router layout that owns the tab
routes. Direct tabs are descriptors for the cells that are visible now;
`routes` is the complete registry that Expo Router must know about, including
destinations that the overflow menu will open.

```tsx
import { MenuView } from "@expo/ui/community/menu";
import { RouterTabs, type RouterTabItem } from "@/components/router-tabs";
import { SymbolView } from "@/components/symbol";

const tabs: RouterTabItem[] = [
  {
    href: "/(tabs)/home",
    name: "home",
    label: "Home",
    icon: <SymbolView name="house" size={22} />,
    selectedIcon: <SymbolView name="house.fill" size={22} />,
  },
  // ...the other direct cells
];

export function AppTabs() {
  return (
    <RouterTabs
      tabs={tabs}
      routes={[
        { href: "/(tabs)/home", name: "home" },
        { href: "/(tabs)/settings", name: "settings" },
      ]}
      overflow={
        <MenuView actions={[]} shouldOpenOnLongPress={false}>
          {/* The caller supplies the button and the menu actions. */}
        </MenuView>
      }
      theme={theme}
    />
  );
}
```

The example is intentionally schematic: a real overflow control must provide
its menu actions and an accessible button child. `RouterTabs` does not inspect
or navigate overflow entries; that policy belongs to the adapter.

## Public API

### `RouterTabItem`

| Field | Type | Meaning |
| --- | --- | --- |
| `href` | `Href` | Expo Router destination used by the direct `TabTrigger`. |
| `name` | `string` | Stable trigger name. It must be unique within the tab registry. |
| `label` | `string` | Visible and accessible tab label. Keep it short enough to fit one line. |
| `icon` | `ReactNode` | Inactive icon node. The caller owns its size and colour. |
| `selectedIcon` | `ReactNode?` | Optional selected icon node. `icon` is reused when omitted. |
| `testID` | `string?` | Optional stable test identifier for the direct button. |

The shell intentionally accepts `ReactNode`, rather than a symbol name or an
icon library type. This keeps icon rendering portable and lets a consumer use
SF Symbols on Apple platforms, Material icons on Android, or its own icon
system. The consumer is responsible for setting the icon's inactive and
selected colours.

### `RouterTabRoute`

`{ href: Href; name: string }` is the complete route registry. Pass every
route that can be reached through the tab shell, not only the direct cells.
Expo Router's `TabList` is kept mounted and hidden so route registration does
not change as capability or overflow state changes.

### `RouterTabsTheme`

| Field | Purpose |
| --- | --- |
| `surface` | Opaque direct/overflow surface on non-Liquid-Glass platforms. |
| `selectedSurface` | Opaque selection lens surface on non-Liquid-Glass platforms. |
| `label` | Inactive label colour. |
| `selectedLabel` | Active label colour. |
| `transparent` | Transparent colour used by the overlay and tab hit targets. |
| `shadow?` | Optional React Native `boxShadow` value applied to the bar and lens. |

On iOS 26+, `surface` and `selectedSurface` are not painted as opaque fills;
the native Liquid Glass surfaces provide the material. They remain required so
the same theme has a complete fallback. Icon colours are intentionally not in
the theme: `RouterTabItem` accepts arbitrary React nodes, so the consumer can
use any icon library and own its inactive/active rendering.

### `RouterTabsProps`

| Prop | Required | Meaning |
| --- | --- | --- |
| `tabs` | yes | Direct cells to render, in visual and scrub order. |
| `theme` | yes | Semantic colours and optional shadow for both rendering paths. |
| `routes` | no | Complete hidden + direct route registry. Defaults to descriptors derived from `tabs`. |
| `overflow` | no | Ready-to-render overflow control placed in its own perfect circle. |
| `maxDirectTabs` | no | Direct-cell budget when `overflow` exists. Defaults to 4. |
| `maxTabsWithoutOverflow` | no | Direct-cell budget when `overflow` is absent. Defaults to 5. |
| `fallbackTheme` | no | Partial theme used only by the opaque fallback when the screen's scheme differs from the system scheme. |
| `surfaceComponent` | no | Custom material renderer. The built-in Expo Glass renderer is used when omitted. |
| `onTabPress` | no | Called by an ordinary direct-tab press. Use for haptics or analytics. |
| `onTabSelect` | no | Called after a direct tab is released, including a scrubbed selection. |
| `testID` | no | Prefix for the shell, direct buttons, and overflow group. |

`RouterTabs` does not automatically move excess descriptors into the overflow
menu. The caller must partition `tabs`, pass the full `routes` registry, and
render the corresponding menu. In development, the shell warns if more direct
descriptors than the active budget are supplied.

### Material abstraction

The default `surfaceComponent` uses only `expo-glass-effect` and React Native,
so the shell is not coupled to hackOS's `GlassView`, colour tokens, or another
application component. A consumer can replace it with a design-system
surface, a third-party blur implementation, or a platform-specific renderer:

```tsx
import type { RouterTabsSurfaceProps } from "@/components/router-tabs";

function AppSurface({
  children,
  mode,
  style,
  testID,
}: RouterTabsSurfaceProps) {
  // Keep the same geometry and children contract; only the material changes.
  return (
    <MyGlassOrSolidSurface
      material={mode}
      style={style}
      testID={testID}
    >
      {children}
    </MyGlassOrSolidSurface>
  );
}

<RouterTabs surfaceComponent={AppSurface} {...props} />;
```

`mode` is `"liquid-glass"` only when the runtime passes the real native
Liquid Glass availability check; otherwise it is `"opaque"`. A custom
renderer must forward `style`, `children`, and `testID`, preserve the supplied
rounded geometry, and provide a visible opaque material for the opaque mode.
It may use `isInteractive` to enable or disable its own interactive glass
effect and `reducedMotion` to disable its own material transitions. The tab
shell still owns hit testing, selection animation, and route changes.

`fallbackTheme` is the other customization seam. It lets an app with an
intentionally dark screen provide dark fallback tokens without forcing the
library to know how that app represents colour schemes:

```tsx
<RouterTabs
  fallbackTheme={{
    label: "#98989e",
    selectedLabel: "#0a84ff",
    selectedSurface: "#2c2c2e",
    surface: "#1c1c1e",
  }}
  {...props}
/>
```

## Overflow menu contract

The overflow control is deliberately separate from the scrub surface. It is
not a fifth fake tab, not a full-width transparent overlay, and not a screen.
The caller should use the platform-native menu implementation available to its
Expo SDK (hackOS uses `MenuView` from `@expo/ui/community/menu`) and make the
button accessible as a button with the current section selected when the
current route belongs to the overflow set.

The menu adapter owns three decisions:

1. Which destinations are hidden behind the circle.
2. Which icon/label represents the current hidden destination. The default
   ellipsis is only shown when no overflow destination is active.
3. How a menu action changes navigation. For pseudo-tabs, switch sections with
   replacement semantics and make selecting the current section a no-op; do
   not push a new stack entry for each selection.

For a route-aware adapter, normalize Expo Router route groups before comparing
paths. `/(tabs)/others/queue` and `/others/queue` can represent the same
screen depending on where the pathname was read.

## Interaction model

### Direct taps

Direct cells remain real Expo Router `TabTrigger` controls. A normal tap goes
through the router's tab event pipeline, so consumers retain native tab
behaviour such as:

- preserving each tab's stack;
- receiving `tabPress` on the selected screen;
- scrolling a list to the top when the active tab is tapped again; and
- implementing a domain-specific retap action, such as returning Schedule to
  the currently active event.

The shell does not replace that press event with a delayed JS callback.

### Reduced motion

The shell reads Reanimated's `useReducedMotion()` preference. When the user
has enabled Reduce Motion / Remove animations:

- route selection still changes normally;
- the selection lens still follows a finger during a direct scrub, because
  that is direct manipulation rather than an autonomous animation;
- the arrival animation is replaced with an immediate position update; and
- the resolved `reducedMotion` flag is passed to a custom `surfaceComponent` so
  its own material transitions can be disabled as well.

Reduced motion changes animation, not information architecture or navigation.

### Finger scrub

The direct group is wrapped in one `react-native-gesture-handler` pan gesture.
The gesture activates only after a small horizontal movement and fails for a
primarily vertical movement, allowing the individual `TabTrigger` pressables
to keep ordinary taps. Once active:

1. the selection lens follows the finger continuously on a Reanimated worklet;
2. no route changes while the finger is moving;
3. the final x-coordinate is converted to a direct-cell index on release; and
4. navigation commits once to the tab under the finger.

The lens is inset evenly on all four sides of its cell. The full cell remains
the hit target, so the visual padding does not make a tab harder to touch.
The overflow circle is outside this gesture and opens its native menu.

### Selection and route changes

The shell determines the active direct cell from the current pathname, after
removing query/hash suffixes, trailing slashes, and Expo Router group segments.
Changing the route from elsewhere animates the lens to the matching cell. A
scrubbed selection uses the headless Expo Router tab trigger state and emits
the selection callback once; it does not simulate a second press on the target,
which would incorrectly trigger a retap-to-top action.

## Geometry and safe-area contract

`RouterTabs` renders as an absolute overlay at the bottom of its `Tabs` root.
Content is expected to continue behind the surface on Liquid Glass platforms;
the inset hooks provide the clearance needed for the last interactive content
to remain reachable.

| Layout | Surface height | Inner vertical padding | Direct cells before overflow | Cells without overflow |
| --- | ---: | ---: | ---: | ---: |
| Compact (`width < 700`) | 64 pt | 8 pt | 4 | 5 |
| Tablet-width (`width >= 700`) | 56 pt | 6 pt | 6 | 6 |

The outer wrapper uses at least 16 pt horizontal display padding and derives
its bottom gap from `react-native-safe-area-context`. The overflow control is
the same height and width as the surface height, so it remains a perfect
circle. The bar's layout and safe-area values are recalculated on rotation and
window-size changes.

### `useRouterTabBarInsets`

Returns:

```ts
interface RouterTabBarInsets {
  safeAreaBottom: number;
  tabBarBottomPadding: number;
  tabBarHeight: number;
  tabBarVerticalPadding: number;
  contentBottomInset: number;
}
```

Use the returned `contentBottomInset` for a scroll view's bottom content and
scroll-indicator padding. Use `tabBarHeight + tabBarBottomPadding` when
placing a floating action above the bar. The provider is mounted by
`RouterTabs`, but the hook has a safe fallback to the current safe-area context
so shared children remain usable in isolation and tests.

Convenience hooks:

- `useRouterTabBarBottomInset()` returns `contentBottomInset`.
- `useRouterTabBarScrollBottomInset()` is for scroll views that retain iOS
  `contentInsetAdjustmentBehavior="automatic"`. UIKit already adds the device
  bottom safe area there, so this hook subtracts it once on iOS and preserves
  the full custom clearance on Android.

Do not add another hard-coded `paddingBottom`, safe-area spacer, or absolute
bar height in a route that uses this component. Those duplicate clearances are
the usual cause of lists ending too high.

## Platform behaviour

| Platform | Material | Navigation/menu | Consumer responsibility |
| --- | --- | --- | --- |
| iOS 26+ | Native Liquid Glass with interactive selection surface | Expo Router triggers + native `MenuView` overflow | Keep content edge-to-edge and use the inset hook for reachable endings. |
| iOS <26 | Opaque colour-scheme-aware surface with matching geometry | Same | Supply `fallbackTheme` for screens with an explicit dark surface. |
| Android | Opaque colour-scheme-aware surface with matching geometry | Same native menu API and same trigger contract | Ensure the app has Gesture Handler/Reanimated configured; use the inset hook for navigation-bar clearance. |
| iPad / regular tablet width | Slightly thinner bar; up to six direct cells | Same | Treat width as a layout policy, not a different navigation model. |

`expo-glass-effect` is the material seam. The reusable shell checks the same
real Liquid Glass availability gate used by `GlassView`; it does not assume
that an iOS runtime automatically means Liquid Glass is available.

## Accessibility and screen readers

Every direct control is a native `Pressable` with:

- `accessibilityRole="tab"`;
- the visible label as its accessibility label; and
- a selected accessibility state supplied by Expo Router.

That gives VoiceOver on iOS and TalkBack/other Android screen readers a
standard focusable tab for each direct destination. The finger-scrub gesture is
an enhancement, never the only way to navigate: a screen-reader user can move
focus to a tab and activate it with the normal accessibility action. Retapping
the focused tab continues to go through Expo Router's `tabPress` event, so
screen-reader activation preserves the same scroll-to-top/live-activity
behaviour as a touch tap.

The overflow button must expose its current label and selected state from the
adapter, and its native menu actions must have visible localized labels. The
menu itself should remain a real native menu so VoiceOver/TalkBack get their
standard open, focus, selection, and dismiss behaviour. Icons inside a tab or
overflow button are decorative because the control already has a text label;
custom consumers should pass icon nodes with `accessible={false}`. The
selection lens is also excluded from accessibility focus.

Keep the full route registry mounted so accessibility and deep-link navigation
do not depend on which capability set happened to render first.

## Testing

Recommended test layers:

1. Pure geometry tests for width thresholds, safe-area math, and the compact vs
   tablet tab budgets (`apps/mobile/lib/router-tabs-inset.test.ts`).
2. Navigation contract tests for route-group normalization, overflow no-op,
   replacement, and exhaustive destination descriptors.
3. React Native Testing Library tests for labels, selected state, menu actions,
   retap behaviour, reduced-motion selection, and the final-tab selection after
   a scrub.
4. A simulator/device pass on iOS 26+, an older iOS runtime, and Android for
   visual alignment, native menu presentation, gesture feel, VoiceOver, and
   TalkBack.

UI changes also require screenshots in the PR comment. Capture at least the
following states: Liquid Glass with a direct selection, opaque dark fallback,
opaque light fallback, an active overflow icon, and the tablet-width geometry.
See [`ui-testing.md`](./ui-testing.md#screenshots-on-ui-prs).

## Publishing checklist for a future package

The current source already has the package boundary. Publishing it should
formalize these seams rather than add hackOS-specific behaviour:

1. Move `router-tabs.tsx` and `router-tabs-inset.ts` into a package with
   peer dependencies on `expo-router`, `expo-glass-effect`,
   `react-native-gesture-handler`, `react-native-reanimated`, and
   `react-native-safe-area-context`.
2. Replace the app alias imports with package-local imports and keep
   `surfaceComponent` as the material injection point. The default renderer
   should continue to depend only on Expo's public `expo-glass-effect` API.
3. Keep route registration and direct-cell partitioning as explicit props;
   never make the package know about capability names, localization keys, or
   app-specific pseudo-tabs.
4. Publish the safe-area math as pure functions as well as hooks so unit tests
   and design-system consumers can calculate clearance without mounting React
   Native.
5. Document Expo SDK / React Native / Reanimated compatibility and provide a
   small example app with one direct set, one overflow set, and both colour
   schemes before publishing.

The package should remain a tab shell rather than a complete navigation
framework. Expo Router owns routes and stacks; the consumer owns the registry,
overflow policy, menu actions, analytics, haptics, and domain-specific retap
behaviour.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| “Couldn't find any screens for the navigator” | `TabList` was not given direct `TabTrigger` children, or the route registry was mounted conditionally. | Keep `TabSlot` and `TabList` direct children of `Tabs`; register every route on the first render. |
| Taps work but scrubbing does not | Gesture Handler is not installed/configured, or a parent vertical gesture captures the touch. | Verify the native setup, keep the pan thresholds, and avoid wrapping the shell in another horizontal pan. |
| The lens moves but route changes twice | The adapter is navigating from both `onTabSelect` and a gesture callback. | Let the shell commit direct scrub selection; use `onTabSelect` for side effects only. |
| A list ends behind the bar | The route did not use the published inset, or used the full inset together with iOS automatic adjustment. | Use `useRouterTabBarBottomInset()` or `useRouterTabBarScrollBottomInset()` as appropriate. |
| Dark fallback has white/low-contrast controls | A screen has an explicit dark surface but the shell follows the system scheme. | Pass a dark `fallbackTheme` and provide dark semantic theme values. |
| The overflow action pushes duplicate screens | The menu adapter uses `router.push()`. | Classify the current overflow section and use replace/no-op semantics. |
| A direct label is clipped | The label is too long for a single tab cell. | Use concise localized copy; let the bar adapt the cell width, but do not use paragraph-length tab names. |
