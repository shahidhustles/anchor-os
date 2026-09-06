# Design System: PlantOps

Plant maintenance demo. Industrial internal tool, not a marketing surface.
Dials: Density 9 (cockpit), Variance 3 (predictable symmetric), Motion 2 (static).
Motion is deliberately low: the spec requires deterministic navigation and no
animated transitions so an automation agent can operate the UI from snapshots.

## 1. Visual Theme & Atmosphere

A control-room interface for a working plant. Calm, dense, unadorned. The
surface is off-white zinc with a single burnt-orange accent borrowed from
floor-safety paint. Data sits in ruled tables and definition lists, not in
card stacks. Nothing glows, nothing floats, nothing animates. Every control
is visible, labeled, and reachable by keyboard and by name in an
accessibility tree.

## 2. Color Palette & Roles

- **Canvas** (#F4F4F5) — App background.
- **Surface** (#FCFCFD) — Header, panels, table body.
- **Ink** (#18181B) — Primary text, headings, table values.
- **Muted Ink** (#52525B) — Secondary text, helper copy.
- **Faint Ink** (#71717A) — Table column labels, timestamps, metadata.
- **Line** (#E4E4E7) — 1px row dividers and panel borders.
- **Line Strong** (#D4D4D8) — Input borders, table header rule.
- **Safety Ember** (#9A3412) — The single accent: primary buttons, active
  nav, links, focus rings. Saturation below 80%.
- **Ember Deep** (#7C2D12) — Accent hover and pressed state.
- **Ember Tint** (#FBEEE7) — Wash for the just-created work-order row.

Semantic status (fixed pairings, never mixed):

- **Running / open / created** — #15803D text on #F0FDF4, border #BBF7D0.
- **Standby / medium** — #B45309 text on #FFFBEB, border #FDE68A.
- **In progress** — #0F766E text on #F0FDFA, border #99F6E4.
- **High / down** — #B91C1C text on #FEF2F2, border #FECACA.
- **Low / on hold / preventive** — #52525B text on #F4F4F5, border #E4E4E7.

No purple, no neon, no gradients. No pure black or pure white anywhere.

## 3. Typography Rules

- **Sans:** Geist (next/font, self-hosted). UI text, labels, body. Base size
  14px, line height 1.5. Headings 18–24px, weight 600, tracking normal.
- **Mono:** Geist Mono. Every number and machine identifier: asset IDs,
  work-order IDs, dates, times, model tags. Mandatory above density 7.
- **Banned:** Inter, generic serifs, system-ui as a display face,
  letter-spaced screaming headlines.

## 4. Component Stylings

- **Buttons:** Flat, 6px radius, no outer glow. Primary: ember fill with
  #FAFAF9 text. Secondary: surface fill, 1px line-strong border, ink text.
  Ghost: no fill, no border, muted-ink text. Pressed state shifts to ember
  deep (primary) or canvas (secondary). Focus-visible: 2px ember ring,
  2px offset.
- **Inputs:** Label above (12px, weight 500, ink). Surface fill, 1px
  line-strong border, 6px radius, 14px text. Error text below in #B91C1C
  at 12px. Focus: 2px ember ring. No floating labels, no
  placeholder-as-label.
- **Tables:** Full-width, no card wrapper. Surface background with 1px line
  border. Header row: 11px uppercase tracking-wide faint ink above a 1px
  line-strong rule. Rows divided by 1px line lines; row hover washes to
  canvas. The newest work order gets a 3px ember left rule.
- **Badges:** 11px weight 600, 4px radius, 1px tinted border, 10% tint
  fill, dark-tint text. Status and priority only.
- **Panels:** 8px radius, 1px line border, surface fill. Used for the
  create form, success banner, and empty states only.
- **Loaders:** Skeleton rows matching table dimensions, static fill (no
  spinner).
- **Empty states:** A bordered panel with a short heading and the one next
  action, e.g. "No work orders yet" plus a "Create a work order" link.

## 5. Layout Principles

- Single column, max width 1024px, 24px side gutters, 32px page padding.
- Header: 56px, surface fill, 1px bottom border, sticky, z-10. Brand left,
  view nav center-left, actions right. One line on all desktop widths.
- Definition lists: two-column grid, 160px label column, label in faint
  ink 12px, value in ink 14px.
- CSS Grid for structure; no percentage flexbox math.
- Below 768px: single column; tables scroll horizontally inside a
  min-width wrapper (desktop is the demo target).

## 6. Motion & Interaction

Static. The only motion is 120ms ease transitions on background, border,
and color for hover and focus. No page transitions, no keyframe loops, no
transform animations. `prefers-reduced-motion` is therefore trivially
honored.

## 7. Anti-Patterns (Banned)

- No emojis.
- No Inter, no generic serifs, no pure #000000 or #FFFFFF.
- No neon glows, gradients, or glassmorphism.
- No 3-equal-card feature rows, no bento, no hero sections.
- No hover-only actions, canvas-only controls, drag-and-drop,
  virtualized tables, or animated page transitions.
- No coordinate-dependent UI: every control has a stable accessible name
  and semantic role.
- No AI copywriting clichés, no invented precision beyond seed data.
