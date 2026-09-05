# Anchor OS web

The light-only Anchor OS chat workbench, built with Next.js, assistant-ui, and
the Eve agent runtime in `../../packages/agent`.

## Getting Started

First, copy `.env.example` to `.env.local` and add the keys for the models you
want to use:

```sh
OPENCODE_API_KEY=your-api-key
QWEN_API_KEY=your-api-key
```

Then run the development server:

```sh
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

The UI supports multiple in-memory chats and keeps a separate model selection
for each one. Each mounted chat owns a separate Eve session, so a turn can keep
running while another chat is selected.
