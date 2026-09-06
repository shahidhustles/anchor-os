# Ticket 01 - Call the private Paddle service

Confirmed with the user:

- Missing `PADDLE_OCR_BASE_URL` throws a clear error (no code default).
- Host validation accepts literal IPs only (`localhost`, `127.0.0.0/8`, `::1`, RFC 1918, `100.64.0.0/10`); no DNS resolution.
- Hand-rolled type guards, no zod.

## `packages/agent/agent/lib/paddle-ocr.ts`

Exported types:

```ts
PaddleOcrImage = { key: string; bytes: Uint8Array }   // base64 decoded here
PaddleOcrPage = { pageNumber: number; markdownText: string; images: PaddleOcrImage[]; prunedResult: Record<string, unknown> }
PaddleOcrResult = { logId: string; numPages: number; pages: PaddleOcrPage[] }
```

Exported function `parsePaddleOcrPdf(pdf: Uint8Array, options?: PaddleOcrOptions)` and `resolvePaddleOcrBaseUrl(configured: unknown)`.

Behavior:

1. `signal.throwIfAborted()` first, then input checks: empty PDF rejected; size over `maxInputBytes` (default 20 MiB) rejected before Base64 encoding.
2. Base URL from `options.baseUrl ?? process.env.PADDLE_OCR_BASE_URL`, trimmed, trailing slashes stripped. Errors: missing env, non-absolute URL, non-`http:` scheme, non-private host (message names loopback / RFC 1918 / `100.64.0.0/10` and the offending host).
3. `POST {base}/layout-parsing` with JSON `{ file, fileType: 0, returnMarkdownImages: true, restructurePages: true, visualize: false }` and the caller's `AbortSignal`.
4. Network `TypeError` wrapped as "unreachable at <url>"; aborts mapped to "was cancelled before completion"; other errors rethrown.
5. Response body read through a `ReadableStream` accumulator capped at `maxResponseBytes` (default 96 MiB); `content-length` over the cap rejected before reading.
6. Non-200 status -> `HTTP <status> from <url>: <errorMsg>, logId <logId>` when the body carries the Paddle envelope.
7. `JSON.parse` as `unknown`, then guards: envelope `{ logId, errorCode, errorMsg, result }`; `errorCode !== 0` -> error with code + logId + errorMsg; `result.dataInfo` with positive-integer `numPages` and array `pages`; array `layoutParsingResults`; all three counts equal, else "page counts disagree" with all three numbers + logId.
8. Per page: `markdown.text` string, `markdown.images` object map with Base64-string values (strict regex, length % 4), `prunedResult` object. Image keys must pass `isSafeRelativeImagePath`: no empty/backslash, no leading `/`, segments match `[A-Za-z0-9._-]+` and aren't `.` or `..`. Violations fail closed.
9. Decoded image bytes accumulate across pages and must stay under `maxOutputBytes` (default 64 MiB).
10. One `console.info` line on success: url, page count, input MiB, decoded image MiB, duration ms, logId. Nothing else logged; error messages never contain payload or Base64.

## `packages/agent/agent/lib/paddle-ocr.test.ts`

bun:test, stubbed `globalThis.fetch` with env save/restore in `afterEach` (pattern from `qwen-model.test.ts`). Inline 2-page fixture: page 1 has one image + Markdown reference, page 2 has none; `dataInfo.numPages=2`, `pages` length 2, two layout results.

Cases:

- Request contract: URL `<base>/layout-parsing`, POST, JSON content type, exact body `{ file: <PDF base64>, fileType: 0, returnMarkdownImages: true, restructurePages: true, visualize: false }`.
- Happy path: typed pages, `logId`, page numbers 1..2, decoded image bytes equal the fixture bytes, empty images on page 2.
- Paddle error envelope: message carries `errorCode`, `errorMsg`, `logId`, and no Base64.
- Malformed variants (mutated fixture): missing `result`, missing `dataInfo`, `numPages` disagreement, missing `layoutParsingResults`, missing `markdown.text`, `images` not an object, image value not Base64, unsafe keys (`../escape.jpg`, `/etc/passwd.jpg`), missing `prunedResult`, non-object page entry.
- `maxOutputBytes: 2` -> decoded-output-limit error.
- `maxInputBytes: 4` -> input-limit error, fetch never called.
- Empty PDF rejected.
- Base URL config: `http://8.8.8.8:8080` (public), `https://...` (scheme), garbage URL, missing env - each a clear error, fetch never called.
- Cancellation: already-aborted signal fails fast with zero requests; mid-flight abort (stub aborts controller then throws `AbortError`) surfaces "cancelled".
- Non-200 with error envelope -> `HTTP 500` + logId + errorMsg.
- Oversized response stream (2 KiB body, `maxResponseBytes: 1024`) -> response-limit error.
- `TypeError("fetch failed")` -> "unreachable" error naming the endpoint.

## `apps/web/.env.example`

Append after the Qwen block:

```
# Private PaddleOCR-VL service (demo ThinkPad over Tailscale). http only;
# loopback, RFC 1918, or 100.64.0.0/10 hosts.
PADDLE_OCR_BASE_URL=http://100.90.16.40:8080
```

## Verification

`bun run agent:test` from the repo root (runs `bun test agent/lib/*.test.ts`). No typecheck script exists for the agent package; tests compile the TS.
