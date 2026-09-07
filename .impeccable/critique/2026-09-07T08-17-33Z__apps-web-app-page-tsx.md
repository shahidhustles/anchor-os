---
target: Anchor OS web workbench (Lagoon reskin)
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-09-07T08-17-33Z
slug: apps-web-app-page-tsx
---
# Anchor OS web (Lagoon reskin) — Impeccable Critique

Method: dual-agent (A: design review sub-agent · B: detector sub-agent)

## Design Health Score (as reviewed, pre-fix)

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Four coexisting live idioms (tide-dot, spinners, pulsing ●, shimmer); in-thread running was a bare unlabeled ● |
| 2 | Match System / Real World | 3 | Plain, honest copy; "Browser control" explained only in a tooltip |
| 3 | User Control and Freedom | 2 | Chat archive instant + irreversible, hover-only reveal |
| 4 | Consistency and Standards | 2 | Stock amber/red/emerald beside token destructive; ink vs lagoon primaries; mixed alert radii |
| 5 | Error Prevention | 2 | Nothing guards the one destructive action |
| 6 | Recognition Rather Than Recall | 3 | tide-dot meaning unexplained; aria-label on generic span |
| 7 | Flexibility and Efficiency | 3 | Tooltips + focusable actions; no shortcuts/chat switcher |
| 8 | Aesthetic and Minimalist Design | 3 | Calm core; three stacked radial glows + off-palette statuses added noise |
| 9 | Error Recovery | 3 | Specific, actionable copy; line-clamp-2 truncates message tails |
| 10 | Help and Documentation | 2 | One footer sentence carries all documentation |
| **Total** | | **26/40** | Acceptable |

## Design Specificity Verdict
Authored parts are real (tide-dot, shadow-lagoon, anchor tile, foam-wash selection) but execution was ~80%: stock Tailwind status families, two "primary" identities, dead `dark:` variants in a light-only app. Bespoke coastal workbench with shadcn scaffolding showing at the seams.

## Priority Issues (with fix status)
- [P1] Off-palette status colors (amber/red/emerald stock) — FIXED: added `--ok`/`--warn` Lagoon tokens; all notices, tool states, and icons routed through tokens; `dark:` variants stripped.
- [P1] Two primary identities (lagoon send vs ink elicitation Send) — FIXED: elicitation accept button is lagoon. (Disabling composer while `requires-action` is pending = functionality change, skipped per project constraint.)
- [P2] Blank main pane + generic spinner during load — FIXED: skeletal loaders in sidebar (data-slot preserved) and workspace skeleton in main pane.
- [P2] Font-variable fragility (`--font-sans` name collision with Tailwind default) — FIXED: unique `--font-outfit`/`--font-geist-mono` vars mapped deterministically in `@theme inline`.
- [P3] Purity/dead code — FIXED: switch thumb `bg-white`→`bg-card`, `dark:` variants removed, dead `.tide-line` class removed, dead grid classes on action bar removed, one-off `rounded-[10px]`→scale `rounded-sm`, icon.svg hexes nudged to Lagoon, welcome glow restrained (0.25→0.16/0.10) with a faint sun rim.

## Persona Red Flags
- Alex (power user): no keyboard path to common actions; instant hover-only archive; model identity sans instead of mono. (Fixes out of scope: functionality.)
- Sam (accessibility): aria-label on generic spans; composer focus is border-only; error tails clamped. (Structural a11y left intact to avoid behavior changes.)

## Skipped (functionality, per project constraint)
- Archive confirmation/undo, keyboard shortcuts, composer lock during `requires-action`, a11y role changes.

## Detector (Assessment B)
`detect.mjs` exit 0 — 0 findings across apps/web/app + apps/web/components. Browser overlay skipped (browser automation forbidden by project instruction).
