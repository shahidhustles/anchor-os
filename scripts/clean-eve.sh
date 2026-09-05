#!/usr/bin/env bash
#
# Cleans eve agent runs and microsandbox VMs off a small disk.
#
#   scripts/clean-eve.sh         stop + remove eve VMs, drop session disks,
#                                and clear repo .eve caches (dev server must
#                                be stopped for the repo part)
#   scripts/clean-eve.sh --all   also delete the sandbox template snapshots
#                                (2.9 GB here) and the pulled base image cache;
#                                the next session rebuilds/re-pulls them
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEEP=0
[ "${1:-}" = "--all" ] && DEEP=1

MSB="$(ls "$ROOT"/node_modules/.bun/@superradcompany+microsandbox-darwin-arm64@*/node_modules/@superradcompany/microsandbox-darwin-arm64/bin/msb 2>/dev/null | head -1 || true)"
if [ -z "$MSB" ]; then
  echo "msb binary not found under node_modules; nothing to clean."
  exit 0
fi

MSB_HOME="${MICROSANDBOX_HOME:-$HOME/.microsandbox}"

report() {
  du -sh "$MSB_HOME/sandboxes" "$MSB_HOME/snapshots" "$MSB_HOME/cache" 2>/dev/null || true
}

echo "Disk before:"
report

if lsof -ti :3000 >/dev/null 2>&1; then
  echo "WARNING: a dev server is listening on :3000. VM cleanup will kill any"
  echo "turn that is running right now. Repo .eve caches are skipped while it runs."
  DEV_RUNNING=1
else
  DEV_RUNNING=0
fi

names="$("$MSB" status 2>/dev/null | awk 'NR > 2 { print $1 }' | grep '^eve-sbx-' || true)"
if [ -n "$names" ]; then
  echo "Stopping and removing $(echo "$names" | wc -l | tr -d ' ') eve sandbox(es)..."
  # shellcheck disable=SC2086
  "$MSB" remove -f $names >/dev/null 2>&1 || true
else
  echo "No running eve sandboxes."
fi

rm -rf "$MSB_HOME"/sandboxes/eve-sbx-* 2>/dev/null || true

if [ "$DEEP" -eq 1 ]; then
  echo "Deep clean: removing template snapshots and the pulled image cache."
  rm -rf "$MSB_HOME"/snapshots/* "$MSB_HOME"/cache/* 2>/dev/null || true
  rm -rf "$ROOT"/packages/agent/.eve/sandbox-cache/* 2>/dev/null || true
else
  echo "Keeping template snapshots (pass --all to remove them too)."
fi

if [ "$DEV_RUNNING" -eq 0 ]; then
  echo "Clearing repo .eve caches (dev-runtime snapshots, hosts, traces, build output)."
  rm -rf "$ROOT"/packages/agent/.eve/dev-runtime/snapshots/* 2>/dev/null || true
  rm -rf "$ROOT"/packages/agent/.eve/dev-hosts/* 2>/dev/null || true
  rm -rf "$ROOT"/packages/agent/.eve/traces/* 2>/dev/null || true
  rm -rf "$ROOT"/packages/agent/.eve/builds/* "$ROOT"/packages/agent/.output 2>/dev/null || true
  rm -rf "$ROOT"/packages/agent/.eve/sandbox-cache/microsandbox/sessions/* 2>/dev/null || true
else
  echo "Skipping repo .eve caches while the dev server is running."
fi

echo "Disk after:"
report
