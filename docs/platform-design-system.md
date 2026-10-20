# Platform design system ownership

This document records the runtime ownership boundaries for the existing design system. It is a maintenance contract, not a second CSS framework.

## Runtime load order

`index.html` loads the active layers in this order:

1. `shared-design-tokens.css` — the sole owner of foundations, compatibility aliases, and shared component contracts.
2. `style.css` — Conference page patterns and the remaining established application styles.
3. `modules/reservations/reservations-module.css` — Reservations-only layouts.
4. `canonical-platform-shell.css` — the authoritative shell, loaded last so modules cannot replace its header, right sidebar, or workspace rules.

The same URLs must be present in `service-worker.js`. A revision change is required whenever a cached runtime asset changes.

## Ownership matrix

| Component family | Active source before Round 4 | Evidence / legacy overlap | Authoritative destination |
| --- | --- | --- | --- |
| Colors, spacing, type, radii, shadows, breakpoints | `shared-design-tokens.css`, with older `--app-*` aliases in `style.css` | Used by every active runtime stylesheet | `shared-design-tokens.css` |
| Buttons, fields, cards, rows, common empty/loading/error states | Generic rules in `style.css`; Reservations has locally scoped controls | Generic classes are used by Conference, accommodation, settings, and dialogs | `shared-design-tokens.css` |
| Header, right sidebar, workspace visibility, module navigation | `canonical-platform-shell.css` | One shell host in `index.html`; module registration targets that host | `canonical-platform-shell.css` |
| Conference dashboard and conference cards | `style.css` and `renderStartupConferenceCards` in `script.js` | Active startup route renderer | `style.css` page-pattern section |
| Canonical accommodation toolbar, summary, house/floor/room cards | `style.css` and `renderCanonicalAccommodation` in `script.js` | Active protected Conference accommodation renderer | `style.css`, scoped under `#tab0` where needed |
| Older local accommodation views | Earlier accommodation selectors and local-only renderer functions in `style.css` / `script.js` | Still referenced by backward-compatible local data paths | Retained until those runtime paths are formally retired |
| Reservations layout | `modules/reservations/reservations-module.css` | Loaded only with the registered Reservations module | Reservations module stylesheet; shared controls remain centrally owned |
| Warehouse layout | Warehouse-scoped section in `style.css` | Active registered module and intentionally independent data layout | Warehouse-scoped section; shared controls remain centrally owned |

## Token consolidation status

`--platform-*` is the only vocabulary approved for new development. Round 5 removed the unused competing `--platform-v2-*` palette, radius, shadow, and status set. Three exact shell aliases remain temporarily (`--platform-v2-border`, `--platform-v2-navy`, and `--platform-v2-text`) because the minified canonical shell still consumes them; each resolves directly to a canonical semantic token and introduces no independent value.

The active Conference stylesheet has extensive `--app-*` consumers. Their definitions now live only in `shared-design-tokens.css` and map to canonical values wherever equivalence is proven. Compact typography aliases retain their current values to avoid redesigning operational screens in this consolidation round. New code must not use `--app-*` or `--ds-*`; migration can proceed by tested page pattern without a second token authority.

Removed as dead definitions in Round 5: the 16 unused `--platform-v2-*` values plus unused `--app-surface-glass-compact`, `--app-blur-md`, `--app-blur-header`, and `--app-font-family` definitions. The active `--app-*`/`--ds-*` aliases were moved, not copied: their former `style.css` definition block was deleted.

## Layer rules

### 1. Foundations

Use the semantic `--platform-*` tokens for color, typography, spacing, focus, radius, shadow, control height, and responsive contracts. Layout must remain RTL-safe; prefer logical properties such as `margin-inline-start` and `border-inline-start`.

### 2. Shared components

Use `.btn` with its semantic color modifier, `.card`, `.row`, `.grid3`, the standard form elements, and `.ui-state`. Modules may position these components but must not redefine their shared color, typography, focus, disabled, or surface behavior.

```html
<button type="button" class="btn btn-blue">Primary action</button>
<div class="ui-state ui-state--error" role="alert">Operation failed</div>
```

The central inventory is:

| Contract | Classes / elements |
| --- | --- |
| Buttons and icon buttons | `.btn`, semantic `.btn-*`, `.ui-icon-button` |
| Form fields and choices | standard inputs/selects/textareas, `.ui-field`, `.ui-choice`, `.ui-search` |
| Cards and KPI cards | `.card`, `.ui-kpi-grid`, `.ui-kpi` |
| Tables and pagination | `.ui-table-wrap`, `.ui-table`, `.ui-pagination` |
| Filters and tabs | `.ui-filters`, `.ui-filter`, `.ui-tabs`, `.ui-tab` |
| Dialog and confirmation | `.ui-dialog-backdrop`, `.ui-dialog`, `.ui-dialog__actions` |
| Toast and feedback | `.toast` compatibility owner, `.ui-toast`, `.ui-feedback` |
| Badges and status | `.ui-badge` and semantic modifiers |
| Loading / empty / error / denied | `.ui-skeleton`, `.ui-state` and semantic modifiers |
| Responsive toolbar | `.ui-toolbar` |

### 3. Platform shell

Only `canonical-platform-shell.css` owns the global header, right sidebar, navigation state, and workspace geometry. A module renders inside the workspace registered by the platform and must not hide or duplicate the shell.

### 4. Page patterns

Dashboard grids, toolbars, filters, list/detail arrangements, and module page responsiveness belong in the relevant scoped section of `style.css`. Page patterns compose shared components and do not fork their base appearance.

The supported patterns are Dashboard, Data List/Table, List + Detail, Registration/Multi-step Form, Search + Filters, Reports/Analytics, Detail/Edit, Settings/Administration, Dialog/Confirmation, and Loading/Empty/Error/Denied. Pattern ownership is layout-only; business data, mutations, permissions, and locks stay in their module service and renderer.

### 5. Module-specific UI

Keep only business-specific layout and visualization rules in module scopes. Reservations and Warehouse can retain distinct data layouts, while identity, permissions, shell, focus, and standard controls remain platform-owned.

## Responsive and state contract

- Desktop is the default layout; page patterns collapse at their documented tablet/mobile breakpoints.
- Interactive controls preserve a visible `:focus-visible` state and a minimum mobile touch target.
- Loading uses `role="status"`; blocking errors and denied states use `role="alert"`.
- Disabled room assignment remains driven by the existing closed/full business rule. Styling must not replace authorization or lock checks.
- Empty, loading, error, and denied content uses `.ui-state`; modules must not encode these states with inline CSS.

## Safe cleanup record

Round 4 moved only the proven generic component rules out of `style.css`. Older accommodation rules were not blindly deleted: local-only compatibility renderers still reference them. The canonical accommodation renderer now has an explicit scoped page pattern, which makes a future dependency-proven retirement possible without changing its current protected mutation path.

No separate demo route was introduced. This document and the live Conference/accommodation markup provide the practical component reference without adding a runtime dependency or navigation surface.

Round 5 adds `design-system-reference.html` as an isolated Development reference, not an application route. It imports the real shared stylesheet, performs no data reads, registers no module or navigation item, and demonstrates keyboard focus, disabled controls, responsive toolbar/table/dialog layouts, status badges, loading, empty, error, and denied states.

The global `.toast` implementation and the duplicate `.body` declaration were consolidated into their authoritative definitions. Module-scoped Reservations and Warehouse visuals remain because they express active business layouts; their independent token sets are recorded as D — Legacy but Still Required until their runtime consumers can be migrated page by page without visual or behavioral redesign.
