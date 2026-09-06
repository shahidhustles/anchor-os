# Model router

This package provides the fine-tuned Qwen3-0.6B local service, TypeScript client, candidate registry and durable EVE session selection. The earlier `routeModel` API is a heuristic prototype. Anchor OS now uses `createLocalRouter` for Auto mode. See [the training guide](training/README.md) for dataset generation, LoRA training and evaluation.

The router accepts the first task and a non-empty candidate list. It returns only:

```json
{
  "model_slug": "qwen3.8-27b",
  "confidence": 0.87
}
```

`profiles.ts` holds six provisional capability and hardware profiles. The values are placeholders for the hackathon MVP. The benchmark engine will replace them after the team measures code correctness, document structure, calculations, latency, throughput, context limits, and VRAM use on target hardware.

The `multimodal` profile field is informational. It never removes a text-only model from the candidate pool under the approved assumption that agents receive image, scanned document, and video context through Vision MCP. This package does not implement that MCP.

`routeWithLoadFallback` tries to load the selected local model before the caller locks the session. If loading fails, it removes that slug and routes across the remaining candidates. Once a model loads, the caller must keep it for the whole session unless the user manually changes it.

The package emits optional structured events for the selected slug, confidence, candidates, profile version, routing time, and load failures. It does not write logs itself, so the host controls where local audit records are stored.

## Start the learned router

After installing the Python dependencies in the training guide, run from the repository root:

```powershell
packages/model-router/.venv/Scripts/python.exe packages/model-router/training/install_artifact.py packages/model-router/artifacts/qwen3-router-artifacts.zip packages/model-router/artifacts/mvp-v1
packages/model-router/.venv/Scripts/python.exe packages/model-router/training/serve.py --model packages/model-router/artifacts/mvp-v1/merged
```

On Linux, use your virtual environment's Python executable. The server binds to `127.0.0.1:8787`, loads the model once, serializes inference, and exposes `POST /route` plus `GET /health`. Browser-originated requests are refused. Routing needs no cloud API or API key.

The archive stays outside Git. Transfer it with the deployment, or reproduce it using the training guide. The installer verifies SHA-256 `ff72f002100ef5ee6074f246a651cf72548c4070546e047e7be7eb9d9c7c80ba` and refuses to overwrite an existing directory. This workstation already has the same merged checkpoint at `artifacts/colab-2026-09-06/merged`.

```ts
import { createLocalRouter } from "@anchor-os/model-router";

const route = createLocalRouter();
const result = await route({
  user_task: "Create and verify a Word approval note",
  candidate_models: profiles.map((profile) => profile.model_slug),
  profiles,
  requires_tools: true,
  input_tokens: 8000,
});
```

The profile shape is shown in [registry.example.json](registry.example.json). The runtime accepts new slugs without extending the built-in enum. Callers supply hard tool/context constraints. Include the full primary-model input budget in `input_tokens`. The runtime filters incompatible candidates before inference and validates the returned slug again.

## Anchor OS integration

Copy `registry.example.json` to a deployment file. Replace sample ports and `served_model` IDs with actual OpenAI-compatible model servers. Remove unavailable entries or disable their `auto_eligible` flag. All sample endpoints are placeholders.

Set these variables in `apps/web/.env.local`, then restart Anchor OS:

| Variable                       | Meaning                                             |
| ------------------------------ | --------------------------------------------------- |
| `ANCHOR_MODEL_REGISTRY`        | Absolute path to your registry JSON file            |
| `ANCHOR_ROUTER_AUTO_ENABLED`   | Set to `true` to allow new Auto selections          |
| `ANCHOR_ROUTER_URL`            | Optional, defaults to `http://127.0.0.1:8787/route` |
| `ANCHOR_ROUTER_FALLBACK_MODEL` | Optional compatible fallback slug                   |

Start the router service and primary model servers, then select **Auto · Local router** in the existing model picker. Local manual choices have a `Local` prefix. Existing hosted manual choices remain available.

Each registry entry declares its provider, local/hosted location, Auto eligibility, serving endpoint, serving model ID and profile. Optional `api_key_env` names an environment variable; never put a credential in the registry. All built-in capability and hardware values are synthetic `mvp-static-v1` placeholders, as agreed for the MVP. They are not public benchmark evidence.

`packages/agent/agent/agent.ts` calls this package's EVE adapter. Auto considers only local, Auto-eligible entries. EVE requires tool calling for every Auto primary. Its initial context estimate is one token per four UTF-8 bytes plus a 4096-token reserve. Exact system/tool/attachment token accounting remains a deployment improvement.

Before locking a new model, the adapter makes a one-token completion request to verify loading. A load failure removes that candidate and routes over the remaining candidates. Later steps and turns reuse durable EVE state without routing or load probes. An explicit manual change replaces the selection. A model failure after the lock stops the turn instead of switching models.

Invalid or unavailable router output uses one deterministic fallback with confidence `0`. It never retries inference. The configured fallback must be compatible; otherwise the highest mean capability wins, with throughput and slug as tie-breakers. Manual selection uses confidence `1` to mean explicit choice. No compatible models, or failure to load every model, produces an error rather than claiming an unavailable model loaded.

The EVE adapter and Python service write structured decisions and failures to local logs, omitting task text and credentials. The core TypeScript client only emits callbacks. `location: local` is an operator declaration. Deployment network rules must enforce locality; existing hosted paths and the full workbench are not proven air-gapped by this package.

## Verification and accepted model quality

```powershell
bun run model-router:test
bun run model-router:typecheck
bun run model-router:lint
packages/model-router/.venv/Scripts/python.exe -m unittest discover -s packages/model-router/training -p "test_*.py"
bun packages/model-router/demo.ts
```

The demo runs six requests through the real checkpoint, saves `artifacts/local-demo.json`, and fails if any result used fallback. It does not execute primary-model tasks.

Sahil accepted **82.875% validation accuracy** for this checkpoint on September 6, 2026. [evaluation.md](evaluation.md) records the original metrics and limitations. The separate test split remains untouched. The reproducible training pipeline still uses its original 90% gate; the MVP exception applies to this checkpoint only.
