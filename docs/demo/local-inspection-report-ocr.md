# Local inspection-report OCR demo

This guide proves the complete Anchor OS inspection-report path with a synthetic report. It does not claim that the system is sovereign when the selected reasoning model still uses a public URL. For that claim, point both Paddle OCR and the reasoning model at private or loopback addresses and capture the network evidence below.

## What this demo uses

- Fixture: `fixtures/inspection-report/Pump_P204A_Inspection_Report.pdf`
- Expected evidence: `fixtures/inspection-report/expected-findings.md`
- OCR provider: PaddleOCR-VL 1.6, running on the ThinkPad
- OCR endpoint: `http://100.90.16.40:8080/layout-parsing`
- Anchor OCR setting: `PADDLE_OCR_BASE_URL=http://100.90.16.40:8080`
- Report limits: one PDF, no more than 20 pages, no more than 20 MiB

The provider accepts one synchronous whole-document request. The UI must show `Reading report · 3 pages` while it waits. It must show `Read 3 of 3 pages` only after the response contains all three page results.

## Start the services

On the ThinkPad, start the PaddleOCR-VL service and note the model version from its startup log. Confirm it is reachable from the Anchor machine:

```sh
curl -sS http://100.90.16.40:8080/health
```

Expected response: an envelope with `errorCode: 0` and `errorMsg: "Healthy"`.

In `apps/web/.env.local`, set the OCR endpoint and set the reasoning endpoint to a private or loopback OpenAI-compatible service for the sovereign run. Do not use the public Cloudflare example from the checked-in sample file:

```dotenv
PADDLE_OCR_BASE_URL=http://100.90.16.40:8080
QWEN_BASE_URL=http://<private-reasoning-host>:<port>/v1
```

Start Anchor from the repository root:

```sh
bun install
bun run dev
```

Open `http://localhost:3000` in a headed browser. Select the private reasoning model in the composer picker.

## Happy path

1. Attach `Pump_P204A_Inspection_Report.pdf` and send: `Review this inspection report and draft an approval note.`
2. Confirm the original PDF remains visible in the user message.
3. Confirm the OCR card moves through validation, `Reading report · 3 pages`, file preparation, and finally `Read 3 of 3 pages`. There must be no animated page counter while the HTTP request is active.
4. Confirm the model calls `parse_inspection_report` before it calls `read_file` or `bash` for report content.
5. In the tool result, open the returned workspace paths. The report directory must contain:

   ```text
   inspection-reports/<report-id>/
   ├── original.pdf
   ├── report.md
   ├── layout.json
   ├── manifest.json
   └── images/
   ```

6. Confirm `report.md` has `<!-- page 1 -->`, `<!-- page 2 -->`, and `<!-- page 3 -->` markers. Confirm the Markdown image links, if any, point at files under `images/`.
7. Compare the answer with `expected-findings.md`. Material findings must cite page numbers. The photograph may be selected as evidence in the approval note, but the model must not claim a visual diagnosis from it.
8. Ask the model to create the approval-note DOCX. It must select an image by the exact path and source page in `manifest.json`.
9. Download the artifact from the artifact card. Validate the archive, schema, render, text, and embedded media:

   ```sh
   DOCX_SKILL_DIR="$HOME/.agents/skills/docx"
   unzip -t /path/to/approval-note.docx >/dev/null
   python3 "$DOCX_SKILL_DIR/scripts/office/validate.py" /path/to/approval-note.docx
   python3 "$DOCX_SKILL_DIR/scripts/office/soffice.py" --headless --convert-to pdf /path/to/approval-note.docx
   pdftotext -layout /path/to/approval-note.pdf /tmp/approval-note.txt
   rg -n "page 3|P-204A|86 C|6.8 mm/s|48 hours" /tmp/approval-note.txt
   unzip -l /path/to/approval-note.docx | rg 'word/media/|word/_rels/document.xml.rels'
   ```

   The rendered text must contain the selected image caption with its source page, and the archive must contain at least one file under `word/media/`.

## Failure and cancellation checks

For a retryable failure, stop Anchor, change `PADDLE_OCR_BASE_URL` temporarily to an unused private address such as `http://127.0.0.1:9`, restart `bun run dev`, and submit the same fixture. Confirm the card says `Could not read report`, offers `Retry`, and does not let the model answer from the PDF. Restore the ThinkPad URL, restart Anchor, press `Retry`, and confirm the same report ID converges to one complete directory.

For cancellation, submit the fixture while the card says `Reading report · 3 pages`, then press the thread stop control. Confirm the card says `Stopped reading report`, no report artifacts are published, and no reasoning answer starts after the remote service eventually finishes.

## Network evidence

Capture traffic during one happy-path run. Pick the active interface on the Anchor machine first with `ifconfig`, then run:

```sh
sudo tcpdump -i <active-interface> -n 'tcp port 8080 or tcp port <private-reasoning-port>'
```

The capture must show report traffic only to `100.90.16.40:8080` and the chosen private reasoning host. It must not show the report request reaching a public OCR or model host. A public reasoning URL is a failed sovereign proof even if Paddle stays private.

## Measurements to record

Fill this table from the ThinkPad service log and one cold plus one warm run. Do not estimate values.

| Measurement | Value | Evidence source |
| --- | --- | --- |
| ThinkPad CPU model | _record_ | `lscpu` or system information |
| ThinkPad RAM | _record_ | `free -h` or system information |
| PaddleOCR-VL version | 1.6 / _confirm in log_ | ThinkPad startup log |
| Cold start time | _record_ | service log or timed first request |
| Warm three-page request | _record_ | timed Anchor request |
| Peak memory | _record_ | ThinkPad process monitor |
| Anchor result `logId` | _record_ | sanitized Paddle/Anchor log |

The current service health check was verified from Anchor on 2026-09-06 and returned HTTP 200 with `errorCode: 0`. The OpenAPI document identifies the service as FastAPI `0.1.0`; that is not a substitute for recording the deployed PaddleOCR-VL model version from the ThinkPad log.

On 2026-09-06, a separate user-prepared report containing diagrams, photographs, tables, and handwritten text completed through a direct Paddle request in **2m53.584s**. The user reviewed the output and reported that all four content types were recognized correctly. This is evidence for the OCR service itself, not yet an Anchor end-to-end result.

Later that day, the same report completed through Anchor. The user confirmed that Anchor returned the expected report. This confirms the happy path through attachment staging, Paddle OCR, saved workspace files, and agent analysis. Failure, cancellation, and network-capture checks remain separate acceptance steps.

The first attachment after a sandbox definition change may take several minutes while Eve builds its reusable document-tool template. That setup is separate from OCR. Wait for the build to finish before timing the report, then use a second run for the warm-path measurement. The sandbox needs 2 GiB of memory; a 1 GiB template can terminate while LibreOffice is being installed, leaving the turn waiting before `message.received` and before any Paddle request.

## Re-run repository checks

```sh
bun run web:test
bun run agent:test
bun run typecheck
bun run lint
bun run agent:build
bun run build
```

All commands should exit successfully before calling the demo complete.
