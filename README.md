# Anchor OS

Anchor OS is an AI workbench built as a Bun workspace. The first app will run
on Next.js, followed by an Electron desktop shell.

## Workspace layout

```text
anchor-os/
├── apps/
│   ├── web/       # Next.js app
│   └── desktop/   # Electron app
└── packages/
    └── agent/     # Shared Eve agent runtime
```

The workspace currently contains no application dependencies. Each directory
has only a package manifest so Bun can recognize the workspace boundaries.
