# Plant maintenance demo

## Goal

Create a small local plant-maintenance application that proves why Anchor OS needs browser control. A user can ask Eve to turn inspection findings into a work order inside an existing-style internal tool that has no API or MCP integration. The judge watches Eve operate the interface in a headed browser and can verify the saved result.

This is a working demonstration CMMS, not a production maintenance platform.

## User flow

1. The operator starts the plant-maintenance demo locally and resets it to the known demo state.
2. The Assets view lists several pieces of equipment, including `Pump P-204A`.
3. The operator uploads the Pump P-204A inspection report to Anchor OS. Eve reads it through the existing inspection-report flow and identifies the grounded findings.
4. The operator enables browser control and asks Eve to open the maintenance system, find Pump P-204A, and prepare a high-priority corrective work order from those findings.
5. The judge watches Eve navigate the visible browser, select the asset, open the work-order form, and fill the fields.
6. Eve asks for confirmation before submitting the work order.
7. After approval, Eve submits the form and verifies that the new work order appears in the Work orders view with the correct asset, priority, description, and status.
8. Reloading the maintenance app keeps the new work order. Resetting the demo restores the original seed state.

## Requirements

- Build the app as a separate local workspace app at `apps/plant-maintenance-demo`.
- Run it independently from Anchor OS on a fixed local URL, defaulting to `http://localhost:3100`.
- Give the product a plain industrial identity such as `PlantOps`. Label it as a local demonstration system in an About or footer note.
- Provide two primary views:
  - `Assets`, with a searchable asset list and asset details.
  - `Work orders`, with a list, create form, and work-order details.
- Seed at least three assets so Eve must identify the requested equipment rather than selecting the only row.
- Include `Pump P-204A` as a centrifugal pump. Its asset page must show its asset ID, name, type, location, operating status, and prior maintenance entries.
- Keep seed asset facts separate from inspection findings. The app must not pre-seed the report's abnormal drive-end bearing vibration or `86 C` bearing temperature as if Eve had already submitted them.
- The create-work-order form must contain:
  - Asset
  - Title
  - Description
  - Priority
  - Assigned team
  - Status
- Use these demo values when Eve creates the work order:
  - Asset: `Pump P-204A`
  - Priority: `High`
  - Assigned team: `Mechanical Maintenance`
  - Status: `Open`
  - Title and description: derived from the OCR output, including only findings Eve can cite from the inspection report
- Do not add the new work order until the form is submitted. Cancel must leave the data unchanged.
- Show a clear success state after submission and make the new work order visible at the top of the list.
- Give each created work order a stable generated ID and creation timestamp.
- Persist assets and work orders in browser storage. Reloading the app must preserve changes in the persistent `Anchor OS` PinchTab profile.
- Provide a visible `Reset demo data` action with a confirmation step. Reset must restore the same seed data and remove work orders created during earlier rehearsals.
- Use semantic HTML, visible labels, native buttons and inputs, predictable focus order, and accessible names. Browser snapshots must expose enough text and roles for Eve to operate the app without coordinate guessing.
- Keep navigation and form state deterministic. Avoid animated page transitions, canvas-only controls, drag-and-drop requirements, hover-only actions, and virtualized tables.
- Show useful empty, validation, success, and storage-failure states.
- The application must remain usable by a human without Anchor OS.

## Implementation decisions

- Use React, TypeScript, and Vite inside the existing Bun workspace. Keep the app independent from `apps/web` so a browser-control failure cannot break the Anchor OS chat UI.
- Use a small client-side router or explicit view state. The demo needs only the asset list, one asset detail route, the work-order list, and the create-work-order route.
- Store the canonical seed data in `apps/plant-maintenance-demo/src/data/seed.ts` and runtime changes in `localStorage` under one versioned key. Validate stored data before use and fall back to the seed state when it is missing or malformed.
- Use a small repository module such as `src/lib/maintenance-store.ts` for reads, writes, generated work-order IDs, and reset behavior. Components must not write to `localStorage` directly.
- Keep all data synthetic and deterministic. Display a short note that names, assets, maintenance records, and work orders are demonstration data.
- Do not expose REST, GraphQL, MCP, or hidden automation endpoints. Anchor OS must complete the workflow through the same visible controls a human uses.
- Do not add the maintenance application to the normal `bun dev` process. Add a separate root command such as `bun run demo:plant` so the judge setup is explicit and failures stay isolated.
- Match the existing Anchor OS environment, which uses Bun and Node 24 or newer. Avoid services, containers, migrations, and external network dependencies.
- Add focused tests for seed restoration, work-order creation, persistence, validation, and cancel behavior. Prefer stable roles and labels in UI tests over CSS selectors.
- The browser-control demo prompt should tell Eve to use the inspection report as evidence, open `http://localhost:3100`, find Pump P-204A, prepare the work order, ask before submission, and verify the saved record afterward.

## Demo / acceptance

- [ ] `bun run demo:plant` starts the maintenance app at `http://localhost:3100` without Docker or another service.
- [ ] The Assets view contains at least three searchable assets and opens the Pump P-204A details.
- [ ] The Pump P-204A page shows realistic seed metadata without preloading the inspection report's fault findings.
- [ ] A human can create a high-priority open work order assigned to Mechanical Maintenance and see it at the top of the Work orders view.
- [ ] Canceling the form creates no work order.
- [ ] Reloading the page preserves a submitted work order.
- [ ] Reset demo data removes rehearsal work orders and restores the exact seed state.
- [ ] With browser control enabled, Eve can navigate from the Assets view to Pump P-204A and fill the work-order form through visible controls.
- [ ] Eve's work-order title and description match findings from the parsed inspection report. Unsupported details are not invented.
- [ ] Eve pauses before submission and submits only after the operator approves.
- [ ] After submission, Eve opens the Work orders view and reports the saved work-order ID, asset, priority, assigned team, and status from the page.
- [ ] The judge can see every navigation, selection, and form action in the headed browser.
- [ ] The app exposes no direct API or MCP shortcut for creating the work order.
- [ ] The app's focused tests, typecheck, lint, and production build pass.

## Out of scope

- Production authentication, users, roles, permissions, or audit compliance.
- A real plant, real equipment records, or real employee data.
- Inventory, spare parts, purchasing, preventive-maintenance schedules, calendars, analytics, notifications, and mobile layouts beyond basic responsiveness.
- Work-order assignment workflows beyond selecting the seeded maintenance team.
- Editing, deleting, closing, or approving work orders after creation.
- File uploads inside the maintenance app. The inspection report stays in Anchor OS.
- Backend databases, Supabase changes, Docker, cloud hosting, and multi-device synchronization.
- Any API, webhook, browser extension, or MCP integration between the maintenance app and Anchor OS.
- Recreating Atlas CMMS, openMAINT, or another full maintenance product.
