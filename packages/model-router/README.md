# Model Router

This package contains the Anchor OS model router MVP. It runs locally and has no network dependency.

The router accepts the first task and a non-empty candidate list. It returns only:

```json
{
  "model_slug": "qwen3.8-27b",
  "confidence": 0.87
}
```

`profiles.ts` holds six provisional capability and hardware profiles. The values are placeholders for the hackathon MVP. The benchmark engine will replace them after the team measures code correctness, document structure, calculations, latency, throughput, context limits, and VRAM use on target hardware.

The `multimodal` profile field is informational. It never removes a text-only model from the candidate pool because Anchor OS supplies image, scanned document, and video context through Vision MCP.

`routeWithLoadFallback` tries to load the selected local model before the caller locks the session. If loading fails, it removes that slug and routes across the remaining candidates. Once a model loads, the caller must keep it for the whole session unless the user manually changes it.

The package emits optional structured events for the selected slug, confidence, candidates, profile version, routing time, and load failures. It does not write logs itself, so the host controls where local audit records are stored.
