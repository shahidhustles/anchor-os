# Anchor OS

Anchor OS is a local AI workbench built as a Bun workspace. The current slice
is a Next.js chat app backed by Eve; an Electron desktop shell will follow.

## Workspace layout

```text
anchor-os/
├── apps/
│   ├── web/       # Next.js app
│   └── desktop/   # Electron app
└── packages/
    └── agent/     # Shared Eve agent runtime
```

## Run locally

1. Copy `apps/web/.env.example` to `apps/web/.env.local` and add the API keys
   for the models you want to use.
2. Run `bun install` from the repository root.
3. Run `bun dev`, then open `http://localhost:3000`.

The model picker offers Muse Spark 1.3 Contributor through OpenCode Go and a
self-hosted Qwen 3.8 27B Max endpoint. Model selection is kept per chat and is
locked while that chat is running. Chats live only in browser memory and reset
on reload. Each chat receives its own Eve session and microsandbox workspace.

Useful checks:

```sh
bun run typecheck
bun run lint
bun run agent:info
bun run build
```

## Inspection-report OCR demo

The complete local OCR proof is documented in [docs/demo/local-inspection-report-ocr.md](docs/demo/local-inspection-report-ocr.md). It uses the synthetic three-page fixture at `fixtures/inspection-report/Pump_P204A_Inspection_Report.pdf`, a private PaddleOCR-VL 1.6 endpoint, the Eve workspace report files, grounded findings, and a DOCX approval note with a selected source image. Keep the reasoning endpoint private as well when claiming a fully sovereign run.
