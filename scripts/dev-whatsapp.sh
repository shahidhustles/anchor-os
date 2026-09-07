#!/usr/bin/env bash

set -euo pipefail

agent_pid=""

stop_agent() {
  if [[ -n "$agent_pid" ]] && kill -0 "$agent_pid" 2>/dev/null; then
    kill "$agent_pid" 2>/dev/null || true
    wait "$agent_pid" 2>/dev/null || true
  fi
}

trap stop_agent EXIT INT TERM

ANCHOR_WHATSAPP_ENABLED=1 PORT=2000 bun run --filter @anchor-os/agent dev &
agent_pid=$!

agent_ready=0
for _attempt in {1..120}; do
  if curl --fail --silent --output /dev/null http://127.0.0.1:2000/eve/v1/health; then
    agent_ready=1
    break
  fi
  if ! kill -0 "$agent_pid" 2>/dev/null; then
    printf 'WhatsApp Eve server exited before it became ready.\n' >&2
    wait "$agent_pid" 2>/dev/null || true
    exit 1
  fi
  sleep 0.25
done

if [[ "$agent_ready" -ne 1 ]]; then
  printf 'WhatsApp Eve server did not become ready on port 2000.\n' >&2
  exit 1
fi

ANCHOR_WHATSAPP_ENABLED=1 EVE_BASE_URL=http://127.0.0.1:2000 \
  bun run --filter @anchor-os/web dev
