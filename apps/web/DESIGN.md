# Design System: Anchor OS — "Lagoon"

The visual language for the Anchor OS web workbench. It is a functional AI
workbench (a chat + tools + artifacts surface), not a marketing page. The
direction is **Lagoon**: a Mangalore-coast reading of the brand — lagoon teal,
sea-slate ink, sea-foam surfaces, and a single sun-coral accent. It must read
as a calm, premium, coastal tool first and a "beach" second.

Ground rules that never change:

- No functionality changes. This document governs visuals only.
- Light-only. The app forces `color-scheme: light`; there is no dark mode.
- Every status color (ok/warn/critical/running) stays semantic and readable.

## 1. Visual Theme & Atmosphere

A sunlit, low-humidity coast. Airy but working. The canvas is a near-white
with the faintest sea cast; surfaces are sea-foam; ink is a deep sea-slate
rather than pure black; the one saturated note is lagoon teal; a single
sun-coral is used sparingly for the mark and a couple of live moments. Density
is "daily app" — generous, not packed. Motion is fluid and restrained: things
settle with a soft spring, live indicators breathe, nothing loops without a
reason. Atmosphere keywords: calm, salt, morning light on still water, confident.

Dials: `DESIGN_VARIANCE 6` · `MOTION_INTENSITY 5` · `VISUAL_DENSITY 4`.

## 2. Color Palette & Roles

All values live in `app/globals.css` (`:root`, oklch). One palette, no warm/cool
drift, no pure black/white, no AI-purple, no beige+brass default.

- **Canvas** `oklch(0.986 0.004 155)` — near-white, faint sea. Page + chat background.
- **Ink** `oklch(0.24 0.025 215)` — deep sea-slate. Primary text, headings.
- **Surface** `oklch(0.996 0.002 160)` — card/popover fill, a touch cleaner than canvas.
- **Sea-foam** `oklch(0.95 0.012 135)` — secondary/muted. User bubble, chips, soft fills.
- **Foam wash** `oklch(0.945 0.02 175)` — accent/hover/selected. Light teal wash.
- **Muted ink** `oklch(0.52 0.02 205)` — secondary text, metadata.
- **Line** `oklch(0.9 0.012 175)` — hairline borders and inputs, sea-tinted.
- **Lagoon (primary)** `oklch(0.44 0.1 198)` — the sea. CTAs, links, send, focus, active nav.
- **Tide** `oklch(0.7 0.12 190)` — bright lagoon. The "working / live" pulse, live indicators.
- **Sun** `oklch(0.74 0.15 55)` — the single warm accent. Brand mark + 1–2 signature moments.
- **Destructive** `oklch(0.55 0.2 25)` — functional red. Errors, destructive actions.
- **Ok** `oklch(0.55 0.12 160)` — sea-green success. Completed states only.
- **Warn** `oklch(0.55 0.12 70)` — sun-hue amber. Recovery banners, caution.
- **Ring** `oklch(0.6 0.1 195)` — focus ring (lagoon).
- **Chart 1–5** — coastal ramp for any data viz: deep lagoon → tide → foam → sand → sun.

Contrast: ink on canvas and lagoon-on-canvas both clear WCAG AA for body text.
Lagoon primary carries near-white foreground.

## 3. Typography Rules

Loaded via `next/font/google`, self-hosted, `display: swap`. No `<link>` fonts.

- **Sans (UI + display): Outfit** — geometric, warm, premium. Track-tight on
  headings; hierarchy by weight and color, not raw scale.
- **Mono: Geist Mono** — model IDs, timestamps, durations, code, counts.
- Body: relaxed leading, `max-w-[65ch]`, muted-ink for secondary.
- Banned: Inter; generic serifs in this workbench; oversized screaming H1s.

## 4. Component Stylings

- **Buttons:** rounded to the shared scale; primary = lagoon with near-white
  text and a whisper shadow tinted to the sea hue; tactile `translate-y`/scale
  on active. No neon outer glow.
- **Brand mark:** lagoon tile with a white anchor glyph (the app's existing
  "reasoning" glyph) + Outfit "Anchor OS" wordmark. Replaces the old text "A".
- **User bubble:** sea-foam fill, rounded, right-aligned. **Assistant:** no
  bubble — text on canvas.
- **Composer:** the roundest surface (~24px). Sea-foam/ink border; lagoon focus
  ring on focus-within; lagoon send button (up arrow).
- **Live indicator:** a small tide dot that pulses softly ("working"), not a
  spinner.
- **Inputs:** label above, error below, lagoon focus ring, no floating labels.
- **Loaders:** skeletal, matching the layout; no generic spinners for content.
- **Empty state:** "How can I help you today?" with a soft anchor/tide motif
  and the suggestion pills below.

## 5. Layout Principles

- Sidebar + main split, full-height (`h-dvh`), no page scroll.
- Contained thread width (`--thread-max-width: 44rem`), centered.
- One corner-radius scale (base `0.875rem`); composer and pill affordances are
  the documented exceptions.
- Grid over flex math. No overlapping content. Every element owns its zone.

## 6. Motion & Interaction

- Soft spring for interactive elements (`cubic-bezier(0.16,1,0.3,1)` family);
  `tw-animate` for mount/unmount fades and slides; `tw-shimmer` on running labels.
- Animate `transform` and `opacity` only.
- Live dots and the streaming cursor breathe; everything honors
  `prefers-reduced-motion` (loops collapse to static).
- Ambient: a whisper-quiet tide + sun glow sits in the body background behind
  the surfaces — texture, not wallpaper.

## 7. Anti-Patterns (Banned)

- No emojis, no Inter, no pure `#000`/`#fff`, no neon/outer glows.
- No AI-purple or random gradients. No beige+brass default.
- No 3-equal-card rows, no centered-hero clichés, no scroll-fillers.
- No custom cursors. No overlapping content. No broken images.
- No dark mode, no functionality changes.
