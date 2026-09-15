# Platform Dashboard Visual Baseline v1

Status: APPROVED for implementation on `develop`.

This document locks the latest approved dashboard reference from the design session as the visual baseline for the unified platform. It is a design/measurement contract; real application data, permissions, routes, security and module behavior remain authoritative.

## Non-negotiable design decisions

- Arabic RTL enterprise dashboard.
- Dark navy global sidebar on the RIGHT on desktop.
- All platform modules remain visible in global navigation; authorization determines whether a module can be entered. A denied module must not change route or expose protected content.
- Do not use a separate Modules/Units launcher as the normal navigation step after sign-in.
- Do not duplicate actions. Each business action has one primary dashboard entry point.
- KPI/statistic cards may contain ONE small contextual action/icon inside the card; do not add a second large action row that repeats the same actions.
- Dashboard actions navigate to the corresponding real module workflow/page. No fake actions or fake data.
- Preserve proven mobile behavior: no page horizontal scrolling, touch-friendly controls, 16px form controls on mobile to avoid browser zoom, intentional responsive reflow.

## Reference geometry

The approved reference is a 1536 × 1024 desktop composition. Treat values as proportional targets, not hard-coded viewport assumptions.

- Desktop global sidebar: approximately 13% of viewport width in the reference; implementation target 264–288px at wide desktop.
- Top global header: approximately 68–72px.
- Main content occupies the remaining width and uses a dense operational grid.
- Hero/context band: approximately 150–170px.
- KPI row: approximately 110–125px including internal compact action area.
- Main gaps: 12–16px; section separation may reach 20–24px.
- Cards: 12–16px radius; compact controls 8–12px radius.
- Compact contextual action inside KPI card: target 32–36px height or 32–36px square icon button, not a full-size secondary card.
- Minimum interactive touch target remains 44px where touch interaction is expected; compact desktop visuals must gain hit-area/padding without shrinking mobile accessibility.

## Visual tokens extracted/normalized from the approved reference

These are implementation starting tokens and should replace scattered legacy visual values as consumers migrate:

```css
--platform-v2-primary: #0a6cff;
--platform-v2-primary-deep: #0758d4;
--platform-v2-navy: #0b2747;
--platform-v2-navy-deep: #061b32;
--platform-v2-page: #f4f8fc;
--platform-v2-surface: #ffffff;
--platform-v2-border: #dce8f3;
--platform-v2-text: #0b2b57;
--platform-v2-muted: #6480a0;
--platform-v2-success: #00b96b;
--platform-v2-warning: #ff9500;
--platform-v2-danger: #ff3b3b;
--platform-v2-purple: #7c4dff;
--platform-v2-cyan: #00b8c8;
--platform-v2-radius-sm: 8px;
--platform-v2-radius-md: 12px;
--platform-v2-radius-lg: 16px;
--platform-v2-shadow: 0 2px 10px rgba(15, 43, 82, .07);
```

Use Cairo/Tajawal-compatible Arabic typography through the existing project font strategy; do not add an unnecessary font dependency merely to mimic the mockup.

## Dashboard information hierarchy

1. Global shell: brand/account/search/notifications/navigation.
2. Current operational context: conference/event summary and status.
3. KPI cards: participants, registration, pending confirmation/problems, rooms/accommodation, meals/restaurant, payments or the relevant module equivalents.
4. Each KPI may expose a unique compact contextual action only when that action is not already represented elsewhere on the same dashboard.
5. Operational cards: urgent follow-up, occupancy/attendance/payment/registration summaries, current schedule.
6. Search and recent-record tables.
7. Secondary tools only when they are real, useful and not duplicates.

## Action de-duplication contract

Before adding an action, map it to a canonical route/handler. If an equivalent action already exists in a KPI card, header, table row, or another dashboard widget, keep the strongest contextual location and remove the duplicate dashboard entry. Examples:

- Participant registration belongs with the participant/registration context.
- Booking management belongs with booking context.
- Attendance belongs with attendance/registration context.
- Payment collection/follow-up belongs with payment context.
- Room/accommodation action belongs with accommodation context.
- Search should have one obvious primary search surface; do not repeat equivalent search buttons around the dashboard.

Table row actions are record-specific and are not considered duplicates of dashboard navigation actions.

## Responsive contract

- >1100px: full right sidebar and dense desktop grid.
- <=1100px: compact global navigation/rail and reduced grid columns.
- <=820px: global navigation becomes mobile header/drawer behavior; cards reflow intentionally.
- <=700px: tables remain contained with local horizontal scrolling only when unavoidable.
- <=600px: single-column/stacked operational layout, 16px form controls, no page-level horizontal overflow, safe-area bottom spacing.

## Migration rule

Implement this baseline as the new Platform UI Foundation, then migrate Reservations first and subsequently Conference/Warehouse. Replace verified old consumers and delete superseded CSS/components instead of accumulating override patches. Source `main` and Production remain unchanged until explicit approval after Development Preview verification.
