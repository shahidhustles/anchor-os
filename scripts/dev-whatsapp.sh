#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
env_file_args=()

if [[ -f "$repo_root/apps/web/.env.local" ]]; then
  env_file_args=(--env-file="$repo_root/apps/web/.env.local")
fi

cd "$repo_root"
bun "${env_file_args[@]}" run --filter @anchor-os/agent whatsapp
