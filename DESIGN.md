---
name: SAQ QURYLYS
description: A modern GovTech analytical workspace for housing-risk review.
colors:
  navy-dark: "#10223a"
  navy: "#152c49"
  navy-mid: "#264761"
  navy-soft: "#42647d"
  ink: "#172a3b"
  ink-secondary: "#344d63"
  ink-muted: "#50697d"
  ink-note: "#61788b"
  rule: "#d4dee7"
  rule-soft: "#e6edf2"
  canvas: "#ffffff"
  surface: "#f5f7f9"
  white: "#ffffff"
  teal: "#087b83"
  teal-hover: "#05656c"
  teal-bright: "#0b8e94"
  teal-wash: "#def0ef"
  green: "#286447"
  green-wash: "#e1efe7"
  amber: "#76520d"
  amber-wash: "#f6edda"
  red: "#a13c3c"
  red-wash: "#f7e7e5"
  hypothesis-blue: "#3f6684"
  hypothesis-wash: "#e6eef5"
  unknown: "#586e80"
  unknown-wash: "#e9eff4"
  evidence-mark: "#d7efeb"
  selected-row: "#e8f3f2"
  field-rule: "#b9c8d3"
typography:
  headline:
    fontFamily: 'Inter, "Segoe UI Variable", "Segoe UI", Roboto, system-ui, sans-serif'
    fontSize: "36px"
    fontWeight: 600
    lineHeight: 1.14
    letterSpacing: "-.035em"
  title:
    fontFamily: 'Inter, "Segoe UI Variable", "Segoe UI", Roboto, system-ui, sans-serif'
    fontSize: "15px"
    fontWeight: 600
  body:
    fontFamily: 'Inter, "Segoe UI Variable", "Segoe UI", Roboto, system-ui, sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: 'Inter, "Segoe UI Variable", "Segoe UI", Roboto, system-ui, sans-serif'
    fontSize: "11px"
    fontWeight: 620
    lineHeight: 1.35
  source-quotation:
    fontFamily: 'Inter, "Segoe UI Variable", "Segoe UI", Roboto, system-ui, sans-serif'
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.65
  source-id:
    fontFamily: 'Inter, "Segoe UI", system-ui, sans-serif'
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-.03em"
rounded:
  badge: "7px"
  field: "8px"
  control: "9px"
  metric: "10px"
  panel: "12px"
  filter: "14px"
spacing:
  inline: "8px"
  compact: "10px"
  small: "12px"
  panel-gap: "14px"
  panel: "15px"
  workspace: "18px"
  detail: "22px"
  section: "24px"
  page-inline: "38px"
components:
  button-primary:
    backgroundColor: "{colors.teal}"
    textColor: "#fff"
    rounded: "{rounded.control}"
    padding: "10px 15px"
  button-primary-hover:
    backgroundColor: "{colors.teal-hover}"
  button-accent:
    backgroundColor: "{colors.teal}"
    textColor: "#fff"
    rounded: "{rounded.control}"
    padding: "10px 15px"
  button-secondary:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
  button-danger:
    backgroundColor: "{colors.white}"
    textColor: "{colors.red}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
  button-success:
    backgroundColor: "{colors.green-wash}"
    textColor: "{colors.green}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "9px 11px"
  panel:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.panel}"
  status-unknown:
    backgroundColor: "{colors.unknown-wash}"
    textColor: "{colors.unknown}"
    rounded: "{rounded.badge}"
    padding: "4px 8px"
  summary-metric:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.metric}"
    padding: "14px 15px"
  queue-selected:
    backgroundColor: "{colors.selected-row}"
    textColor: "{colors.ink}"
    padding: "14px 8px"
  evidence-folio:
    backgroundColor: "#fff"
    rounded: "{rounded.panel}"
    padding: "0 22px 20px"
---

# Design System: SAQ QURYLYS

## Overview

**Creative North Star: "The GovTech Analytical Workspace"**

The approved direction follows the supplied TЗ sections 22–25: a modern professional GovTech and analytical platform. Deep navy, restrained teal, cool off-white surfaces, subtle borders and a modern sans stack establish a clear working hierarchy. The interface is an operational dashboard, not a landing page.

Registry state and analyst tasks have separate meanings and separate groups. Distribution, city coverage and recent signals support an overview of risk; publication review and the registry follow. Exact evidence, machine suggestions, human confirmation and deterministic scores remain visibly distinct. The MVP uses synthetic local records and makes no legal verdict or production-integration claim.

**Key Characteristics:**

- Deep navy structure with restrained teal actions.
- Cool off-white ground, white panels and subtle borders.
- Locally bundled Inter typography and compact functional controls.
- Separate registry state, analyst queue and supporting analysis.
- Labeled semantic risk colors, exact evidence and auditable decisions.

## Colors

The frontmatter owns current values extracted from public/saq-theme.css. Sidecar tonal strips are synthesized previews, not additional source tokens.

### Primary

- **Navy:** active navigation, brand mark and strong text hierarchy; the navigation rail itself is light gray.
- **Teal:** primary and accent actions, focus, source emphasis and selected states. The darker teal supports hover.

### Secondary

- **Green, amber and red:** risk and review categories with written labels and muted washes.
- **Hypothesis blue:** machine suggestions and draft context.
- **Unknown:** a separate neutral review category, not confirmation or an adverse finding.
- **Evidence mark and selected row:** quiet teal-tinted surfaces support exact excerpts and current selection.

### Neutral

- **Canvas, surface and white:** cool page ground, secondary surfaces and reading panels.
- **Ink hierarchy:** primary, secondary, muted and note text.
- **Rule and soft rule:** subtle grouping and row boundaries.
- **Field rule:** form entry strokes.

### Named Rules

**The Semantic Risk Rule.** Risk colors always accompany explicit labels; an unknown state or AI hypothesis does not visually become a confirmed factor.

## Typography

**UI, headings, body and quotations:** Inter → Segoe UI Variable → Segoe UI → Roboto → system-ui → sans-serif.
**Data:** Inter with tabular numerals. Raw audit JSON keeps Cascadia Mono → Consolas → monospace.

Inter Variable is bundled at `public/fonts/InterVariable.woff2`, preloaded by the document and loaded with `font-display: swap`. The font and SIL Open Font License come from the pinned upstream commit recorded in `public/fonts/README.md`. No font request leaves the local application. The system families remain fallbacks. UI, source reading, IDs, dates and numbers share one type family; raw audit code uses monospace.

### Hierarchy

- **Headline:** the headline token; (30px) at (560px) and below.
- **Title:** dashboard panels (15px, 570), registry (16px, 570), publication queue (18px, 570), source preview (22px, 570).
- **Body:** the body token, reducing to (14px) at the narrow breakpoint. Page descriptions use (14px), reducing to (13px).
- **Labels:** field labels use the label token; standard buttons use (13px, 640, line-height 1.15); badges use (11px, 600).
- **Summary numbers:** (44px, 550) and (36px) on narrow screens, with tabular numerals, directly on the page rather than inside individual tiles.
- **Source quotation:** the source-quotation token; exact text scrolls beyond maximum height (245px).
- **Data:** IDs, dates, counts, percentages, factor codes and scores use Inter with tabular numerals. Only raw audit JSON uses monospace. Numeric styling does not imply measured model accuracy.

## Layout

The shell has a light-gray navigation rail (232px), a solid surface-container topbar (76px), and a white flexible main column. Only the active navigation item is solid navy. The architectural brand mark accompanies the SAQ wordmark. Content centers within (1560px), with padding (34px 40px 64px). No backdrop blur is applied.

The dashboard order is: “Обзор рисков” and “Мониторинг объектов долевого жилищного строительства”; update and demonstration context; registry state and analyst queue; publication queue with selected source; risk distribution, city counts and recent signals; residential-complex registry; collapsed case-scenario formula check.

Registry state contains total complexes and the confirmed red-zone count. The current demonstration has 10 complexes; the UI derives that count from records, not a design constant. The analyst queue separately contains new advertisements, AI hypotheses and items needing review. Its figures are task counts, not disjoint risk categories or percentages of total housing.

The summary has two quiet tonal groups (0.9fr / 1.1fr): registry state and analyst tasks. Large open numbers, labels and short context replace decorative icons and nested tiles; metric areas remain links to filtered lists. Groups stack at 820px, with task counts in a two-plus-one layout below 560px. Supporting analytics share one light-gray surface, split by functional dividers: risk distribution, geography and signals. A stacked bar replaces the donut; its widths derive from records, with the linked textual counts and percentages retained. City shares remain data bars, not a map. Signal names lead; full IDs remain visible in secondary text. At 1250px signals span the full width, at 560px all three sections stack.

Publication review is a single bordered workspace: white queue and a quiet gray source preview, in (.95fr / 1.05fr) columns. There is no separate source-card shadow or colored top rule. Exact evidence, matching state and the review action remain intact. The queue stays first in reading order. Below 850px both columns stack. The registry uses a comparison table on desktop and compact object cards below 560px.

Below 850px the rail becomes a 260px drawer and detail views use one column. Below 560px page padding is (26px 18px 40px), topbar height is 60px and the analyst-task counts use two columns with the final action spanning both. Form text uses 16px; buttons have minimum height 44px, small buttons 38px.

## Elevation & Depth

Open space and quiet surface changes separate functional groups. Summary figures have no containers. Dashboard analytics and the source preview use no shadows. Borders organize the review workspace and tables. The mobile drawer and transient feedback retain functional elevation.

### Shadow Vocabulary

- **Root surface token:** `0 12px 32px rgba(17, 38, 61, .07)`.
- **Dashboard analytics and source preview:** none; surface contrast and dividers carry structure.
- **Toast:** `0 8px 22px rgba(17, 38, 61, .14)`.
- **Mobile drawer:** `6px 0 22px rgba(9,25,39,.15)`, inherited from the base stylesheet.
- **Timeline ring:** `0 0 0 3px var(--teal-100)`.

### Named Rules

**The Functional Grouping Rule.** Use borders, compact spacing and shallow elevation to group work; avoid oversized decorative containers.

## Shapes

Observed shapes are compact rounded rectangles: badges (7px), inputs (8px), buttons and navigation (9px), summary metrics (10px), panels and folios (12px), filters (14px). Source ID tabs use small corners; status dots and the risk donut remain circular. These are functional controls, not a physical-material metaphor.

## Components

### Buttons

Primary and accent buttons share teal with white text and darken on hover. Secondary controls use white and a neutral border; danger and success keep semantic text and washes. Standard minimum height is (42px), small variants (34px) with padding (7px 10px). Pressed controls shift (1px); disabled opacity is (.58). State transitions take (.14s ease).

### Inputs / Fields

Inputs use white, subtle entry strokes, the field radius and padding from frontmatter. Minimum height is (42px); textarea minimum height is (120px). Focus changes the border to teal and supplies a visible outline (3px), offset (3px). Compact RU/KZ search wording retains a separate full accessible label; its height changes from (40px) to (36px) on narrow screens.

### Navigation

The navy rail uses labeled links with minimum height (46px). Active and hover states retain distinct surfaces and a narrow teal-tinted leading mark. Standard menu controls and backdrop dismiss the mobile drawer. Tabs use the active teal rule and horizontal overflow.

### Summary Metrics

Registry state and analyst queue are named tonal groups. Their linked metric areas display a number, label and short context without decorative icons or nested cards. Do not add the five counts together or present all five as one mutually exclusive distribution.

### Risk Distribution

The conic donut is generated from actual green/yellow/red/review counts. It has an image role and accessible total label; the adjacent legend supplies category names, counts, percentages and filtered-list links. A neutral review segment stays distinct from green. A conic gradient used to encode data is not a decorative gradient treatment.

### Panels, City Rows and Signals

Support panels have a lightly tinted header, complete border, panel radius and shallow shadow. City rows carry derived complex counts, percentages of the demo register, proportional teal bars and a navigation link, without claiming geospatial precision. Signals retain identity, date, status, an active-count context and a separate list action. The registry header and rows follow the same hierarchy.

### Status Badges

Labels use semantic text, a one-pixel current-color border and muted washes. The unknown family uses the neutral review palette; it does not imply missing legal evidence is confirmed absence. Numeric score pills retain tabular data styling.

### Publication Queue and Source Preview

The selected row uses pale teal without an inset outline. A shared white queue / light-gray source workspace contains plain metadata, the exact quotation, soft evidence highlighting, ruled facts and a full-width review action. There is no colored top/left rule or separate source-card shadow. Selection preserves URL and accessible current state; keyboard focus and narrow-screen navigation remain implemented.

## Motion and Continuity

Navigation retains the current screen while data loads. A delayed topbar line appears after 160ms rather than replacing a ready page with a loading label. Route changes use a 180ms content crossfade; selecting a publication on the dashboard preserves scroll and reveals the new source preview in 240ms. Native View Transitions have a CSS animation fallback. On mobile, selecting a source moves focus and scrolls to its preview. Search and preserved form updates do not replay page transitions.

The mobile drawer uses a 260ms transform with `cubic-bezier(.16, 1, .3, 1)` and a 180ms backdrop fade. It has a close button, a focus trap and an inert background. Closing it restores focus to the menu button. Reduced-motion preferences skip page/source animations and smooth scrolling and remove CSS spatial transitions. There are no decorative loops or scroll-triggered section entrances.

At phone widths, the last analyst-task metric spans the entire row. At 380px and below, history date filters use one column and the document can shrink with its scrollbar without horizontal page overflow.

## Do's and Don'ts

### Registry workflow

Search takes the widest control, followed by zone, city and sorting. Legal status, stage and publication/hypothesis conditions use a native disclosure, expanded when applied. Active conditions are individually removable URL links; removal preserves other conditions and sorting. The overview's needs-review condition survives form submissions. Empty results explain how to broaden the query and offer a reset.

Above 560px results remain a comparison table. On phones the same records become compact object cards: link, full address, risk zone, score, legal status, developer and publication counts. Unknown legal status remains separate from risk. Cards replace the table in the accessibility tree at that breakpoint.

### Do:

- **Do** follow the approved TЗ GovTech direction with navy, restrained teal and cool light surfaces.
- **Do** separate registry state, analyst tasks and risk distribution by meaning.
- **Do** derive counts and chart segments from records and keep text equivalents visible.
- **Do** preserve original evidence, human confirmation, unknown states and synthetic-data notices.
- **Do** keep controls compact, readable, accessible and consistent across RU/KZ.

### Don't:

- **Don't** restore the rejected freight, waybill, graphite/brass or physical-stamp direction.
- **Don't** add neon, cyberpunk styling, purple gradients, glass, crypto imagery or a landing-page hero.
- **Don't** use oversized decorative cards or let ornament dominate analytical content.
- **Don't** claim live collection, geodata, production roles, model calibration or a legal verdict.

Extraction basis: public/styles.css followed by public/saq-theme.css; current dashboard markup and RU/KZ strings in public/pages-portfolio.js and public/i18n.js. Legacy CSS variable aliases remain compatibility details, not a visual-direction contract. Current browser and test evidence is recorded in docs/design-review.md. Canonical component previews and historical screenshots are not current runtime screenshots or a finish-review shipping verdict.
