# Statistics dashboard (H27)

The Logistics Statistics workspace is a generic, aggregate-only dashboard. It
has three independent concepts:

1. the event context (`Before`, `During`, `After`),
2. one or more authorized statistics scopes, and
3. a catalog of panels rendered for the selected scopes.

The web dashboard uses `GET /api/statistics/scopes` to populate the scope
selector, `POST /api/statistics/query` to request the selected panel data, and
`/api/statistics/access` for every scope/panel visibility override.

## Catalog and scopes

The catalog lives in `apps/api/src/modules/statistics/catalog.ts`. A panel
definition declares its data kind, supported scope kinds, and whether it can be
aggregated across scopes. The application overview composes headline metrics,
the confirmation lifecycle, and supporting application activity panels; the
lifecycle is not a duplicate standalone panel. Application-only time series are
separate from generic user dimensions such as shirt size and food intolerance.
Form-question panels are generated only for fields explicitly published through
`field.statistics.enabled`.
The application builder presents that opt-in as integration into Logistics;
the same configured field is included in the dashboard and its authorized CSV.
The editor serializes that one statistics object, so a builder round trip
cannot silently disable an integration.

For each selected application scope, the dashboard and statistics CSV accept a
`participant_filters` entry keyed by `application:<id>`. An empty status list
includes all submitted responses; otherwise the list can include `confirmed`,
`accepted_internal`, and/or `accepted`. Drafts are always excluded. Applications
without an entry use the confirmed-only default. The legacy
`participant_filter=confirmed|submitted` parameter remains available to older
clients and applies to every selected application when no per-application
entry overrides it.

The filter affects form-question and application-scope logistics distributions
only: application status, confirmation lifecycle, and submission time-series
panels continue to report the full non-draft pipeline. Role-scope logistics
distributions remain based on role membership and are not changed by the
application filter. Each phase serves one organizing moment:

- **Before** (preparation): the configurable application panels and charts
  (overview, applications over time, by hour/day, shirt sizes, dietary and
  form-question distributions). They appear only here.
- **During** (operations): event-wide live totals, flow by hour, accredited by
  role, meals served, and the meal/activity and staff-scan tables. Application
  figures are not loaded in this phase.
- **After** (results): participation funnel (confirmed → accredited →
  attended), attendance rate, hours on site and their distribution, the hourly
  curve, accredited by role, meals served, attendance by activity, and the
  attendance-hours table. Confirmed comes from the selected application scopes;
  the other figures are event-wide.

Every chart in all three phases has a full-screen view (`ChartCard`). The
hourly series come from `hourly` in `GET /api/logistics/stats`: UTC-hour
buckets of accreditations (`users.badge_assigned_at`), meal servings and
activity scans, which the client localizes.

Selecting a meal or activity opens a full-window detail with
live servings/scans, distinct people, repeats, and two ring charts. The coverage
chart intersects activity attendees with the current presence estimate: both
segments refer to people currently at the event, rather than subtracting all
historical attendees from current occupancy. Presence remains explicitly
estimated. The second chart separates first visits from repeat scans or
servings. Exact counts are visible beside the charts. Logistics SSE events
refresh the operational totals and charts during the event.

Sponsor meal plans (#933) add planned-versus-served figures to the During
meals table: **Planned** (sponsor representatives who said they attend) next
to **Served**. Meals not offered to sponsors show `—`. The
meal detail adds the plan figures (attending, not attending, no answer) and the
intolerance breakdown among attendees, read from aggregate-only
`GET /api/logistics/meal-plans` under `logistics:stats` and refreshed by
`logistics.meal_plan.updated`. Holders of `meal-plans:export` also get the
per-person catering CSV (`GET /api/logistics/meal-plans/:activityId/export.csv`:
name, surname, enterprise, intolerances, notes; each download is audited as
`export`). Only meals on a shown schedule entry count. Counts exclude inactive
and anonymized accounts and respect the review-fixture boundary: a synthetic
operator sees only test accounts, everyone else only real ones.

Scope keys are stable resource identifiers: `application:<id>` and
`role:<id>`. The API validates every selected key against the caller's
effective permissions. The browser may select several compatible scopes, but it
cannot use the selector or a hidden UI state to bypass that check.

## Data and privacy boundary

The flow is:

```text
Postgres → authorized scope/panel resolver → aggregate/transform service
         → panel-ready response → shared chart/panel components
```

The web renders these panels with tree-shaken Apache ECharts using its SVG
renderer. Charts resize with their panel and use the edition's semantic chart
tokens in both themes. Root theme class changes refresh the palette after the
CSS theme is applied, so a light/dark switch cannot retain the previous colors. ECharts keeps its native hover tooltip beside the
pointer. The axis pointer uses a lower drawing order than each series so its
guide line stays behind the data. Theme colors are converted to RGBA at the
ECharts boundary because its emphasis color parser does not support CSS
`color(srgb …)` values. All chart types include native scrolling legends;
hovering a legend highlights its series or pie sector. Hovering chart data
highlights the matching native legend label using a rich-text style; only the
legend formatter is updated, without replacing series or React state. Bar categories are
separate overlapping sparse series so each legend item targets its own bar.
Diagonal decals use thicker stripes, count axes use integer bounds, and a
screen-reader data list preserves access to every value.

Application status, confirmation, time-series, and question distributions are
aggregated by `applications/stats.ts`. Role and mixed-scope shirt-size and food
intolerance results are aggregated by a server-side user union so a person in
two selected scopes is counted once. Raw application response rows and user
records do not leave the API.

Configured select/multiselect/checkbox options are merged into their result
bucket set, including zero-count options. Transformations are configuration
data rather than chart logic. `age` uses the event's stable reference date
(`event_config.event_starts_at`, then the hacking start when needed), and
`study_level` maps graduation years relative to the event year and configured
program length. Neither transformation returns its source value. The
statistics export uses the same authorized aggregate response and participant
filter as the dashboard. That export includes headline metrics, visible time
series, logistics distributions, and integrated application-question
distributions.

## Permission resolution

`logistics:stats` supplies the default allow for reportable panels. A
`statistics:manage` user can inspect all scopes. Every application and role
scope uses `statistics_scope_panel_role_access`, with the existing role-position
resolver and the same tri-state states:

```text
explicit allow / explicit deny  → winning role-position override
no override                     → inherited general capability
```

An explicit deny removes the panel even when the role has general Logistics
access. An explicit panel allow can expose a limited panel to a role without
general Logistics access. The scopes endpoint, query endpoint, and statistics
CSV all resolve the same effective permissions. Limited-access roles can also
be removed from a scope, which deletes their panel overrides while leaving the
role and its general capabilities unchanged.

Scope discovery loads applications and active roles, then resolves all of the
caller's applicable scope-panel overrides in one set query. Its database round
trips are therefore bounded by the scope-discovery operation rather than by
the number of forms or roles.

## Layout and customization

The dashboard stores presentation preferences in the existing
`users.ui_prefs` namespace through `/api/me/ui-prefs`. The `stats-layout` value
contains panel identity, visibility, chart choice, grid order, and bounded
width/height. It also stores semantic panel and Overview KPI tones and the
user-defined order of the KPI cards; values are
restricted to the design system's neutral, positive, critical, warning, and
informational roles. Customization mode turns the panel area into a direct
sortable grid with keyboard-accessible drag handles and resize controls. The
Overview cards form their own nested sortable grid, so their order can be
personalized without moving the complete Overview panel. During reordering,
the active panel or KPI has a floating preview at its measured size and a
dashed destination outline; siblings shift to show the resulting order without
scaling to another item's dimensions. Reordering preserves each panel's saved
width and height. Keyboard pickup, arrow movement, drop, and cancellation use
the same feedback. Reduced-motion preferences disable sortable transitions and
preview drop animations (issue #849). Grid rows grow with their content so
expanded access settings cannot overlap a panel. Unknown
panel ids are ignored by the sanitizer and new panels receive catalog defaults,
so older preferences cannot blank or break a dashboard. The default layout
gives the composed overview additional width, and users can reset their
personal layout to current catalog defaults.

## Configuration and compatibility

Migration `0818_statistics_configuration.sql` introduced the explicit
publication flag and generic ACL table. Forward-only migration 0824 transforms
current retained application templates exactly once, moving `reporting: true`
to `statistics.enabled: true`, removing the old key, and moving application
ACL rows into the generic scope table. Immutable submitted-form snapshots stay
unchanged. Old time-series ACL/layout ids are canonicalized to the descriptive
`applications-*` ids at read time; `funnel` is canonicalized to `overview`.

Question publication and visualization metadata are stored with the application
template, so deployment/event configuration remains the source of truth rather
than introducing a second statistics registry.

The browser regression in `e2e/browser/statistics-chart.spec.ts` checks native
legend counts and repeated light/dark switches against the running web app.
