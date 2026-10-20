# Platform design system ownership

This document records the runtime ownership boundaries for the existing design system. It is a maintenance contract, not a second CSS framework.

## Runtime load order

`index.html` loads the active layers in this order:

1. `shared-design-tokens.css` — foundations and shared component contracts.
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

## Layer rules

### 1. Foundations

Use the semantic `--platform-*` tokens for color, typography, spacing, focus, radius, shadow, control height, and responsive contracts. Layout must remain RTL-safe; prefer logical properties such as `margin-inline-start` and `border-inline-start`.

### 2. Shared components

Use `.btn` with its semantic color modifier, `.card`, `.row`, `.grid3`, the standard form elements, and `.ui-state`. Modules may position these components but must not redefine their shared color, typography, focus, disabled, or surface behavior.

```html
<button type="button" class="btn btn-blue">Primary action</button>
<div class="ui-state ui-state--error" role="alert">Operation failed</div>
```

### 3. Platform shell

Only `canonical-platform-shell.css` owns the global header, right sidebar, navigation state, and workspace geometry. A module renders inside the workspace registered by the platform and must not hide or duplicate the shell.

### 4. Page patterns

Dashboard grids, toolbars, filters, list/detail arrangements, and module page responsiveness belong in the relevant scoped section of `style.css`. Page patterns compose shared components and do not fork their base appearance.

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
