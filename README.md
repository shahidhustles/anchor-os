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

1. Copy `apps/web/.env.example` to `apps/web/.env.local` and add an OpenCode Go
   API key.
2. Run `bun install` from the repository root.
3. Run `bun dev`, then open `http://localhost:3000`.

The web app uses Muse Spark 1.3 Contributor through OpenCode Go. Chats live only
in browser memory and reset on reload. Each chat receives its own Eve session
and microsandbox workspace.

Useful checks:

```sh
bun run typecheck
bun run lint
bun run agent:info
bun run build
```
