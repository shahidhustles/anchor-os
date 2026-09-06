---
name: docx
description: "Use this skill whenever the user wants to create, read, edit, or manipulate Word documents (.docx files) or Word templates (.dotx files). Triggers include: any mention of 'Word doc', 'word document', '.docx', '.dotx', or requests to produce professional documents with formatting like tables of contents, headings, page numbers, or letterheads. Also use when extracting or reorganizing content from .docx or .dotx files, inserting or replacing images in documents, performing find-and-replace in Word files, working with tracked changes or comments, or converting content into a polished Word document. If the user asks for a 'report', 'memo', 'letter', 'template', or similar deliverable as a Word or .docx file, use this skill. Do NOT use for PDFs, spreadsheets, Google Docs, or general coding tasks unrelated to document generation."
license: Proprietary. LICENSE.txt has complete terms
---

# DOCX creation, editing, and analysis

A `.docx` is a ZIP archive of XML files. Choose your approach by task:

| Task                          | Approach                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------- |
| **Create** a new document     | Write a `docx` (npm) script — see gotchas below                                 |
| **Edit** an existing document | `unzip` → edit `word/document.xml` → `zip` (docx-js cannot open existing files) |
| **Read** content              | `pandoc -t markdown file.docx`                                                  |

> Script paths below are relative to this skill's directory.

## Creating with docx-js — gotchas

`docx` is preinstalled under `$HOME/.local/lib/node_modules`. Write the script and `require("docx")` directly. If Node cannot resolve it, run the script with `NODE_PATH="$HOME/.local/lib/node_modules" node script.js`. Network access is disabled during tasks, so do not run `npm install`.

Use `set -euo pipefail` for multi-command creation and verification scripts. Chain dependent commands with `&&`. A required command piped through `head` or `tail` must still propagate its failure.

The model knows the API; these are the footguns:

- **Page size defaults to A4.** For US Letter set `page: { size: { width: 12240, height: 15840 } }` (DXA; 1440 = 1″).
- **Landscape:** pass portrait dimensions and `orientation: PageOrientation.LANDSCAPE` — docx-js swaps width/height internally.
- **Tables need dual widths:** set `columnWidths` on the table AND `width` on every cell, both in `WidthType.DXA` (PERCENTAGE breaks in Google Docs). Column widths must sum to the table width.
- **Table shading:** use `ShadingType.CLEAR`, never `SOLID` (renders black).
- **Lists:** never insert `•` literally; use a `numbering` config with `LevelFormat.BULLET`.
- **`ImageRun` requires `type:`** (`"png"`, `"jpg"`, …).
- **Headers and footers require class instances:** import `Header` or `Footer` and pass `new Header({ children: [...] })` or `new Footer({ children: [...] })`. A plain `{ children }` object fails at runtime.
- **`PageBreak` must be inside a `Paragraph`.**
- **Never use `\n`** — use separate `Paragraph` elements.
- **TOC:** headings must use built-in `HeadingLevel.*`; custom heading styles need `outlineLevel` set or they won't appear.
- **Don't use a table as a horizontal rule** — use a paragraph bottom border instead.
- **Dot-leader / right-aligned-on-same-line:** use `PositionalTab` (`alignment: PositionalTabAlignment.RIGHT`, `leader: PositionalTabLeader.DOT`) inside a `TextRun`, not literal `.` or space padding.

## Embedding inspection-report images

An approval note may embed images extracted from a parsed inspection report (`parse_inspection_report`). Embed only images you selected for a stated finding, and only after the bundled validator approves them. Skip logos and signatures unless the user explicitly asked for them.

Validate the selection first. The helper checks every requested path against the report's `manifest.json` and rejects anything outside the report directory, symlinks, missing files, unsupported types, and files the manifest does not list:

```bash
node "$HOME/.agents/skills/docx/scripts/validate_report_images.mjs" \
  /workspace/inspection-reports/<report-id>/manifest.json \
  /workspace/inspection-reports/<report-id>/images/page-001-image-001.jpg \
  /workspace/inspection-reports/<report-id>/images/page-002-image-001.jpg
```

It prints JSON with `reportDir`, `images[]`, and `errors[]`, and exits non-zero when any requested image was rejected — a failed run proves a broken selection, so never embed an image it rejected. A valid entry carries the resolved `path`, the DOCX image `type` (`jpg` | `png` | `gif` | `bmp`), the pixel `width`/`height` measured from the file, and the manifest's `sourcePage` and `label`. Use the measured size in the transformation; never guess dimensions.

Embed each validated image with an explicit type and the measured size:

```js
const imageParagraphs = validated.images.map(
  (image) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new ImageRun({
          type: image.type,
          data: fs.readFileSync(image.path),
          transformation: { width: image.width, height: image.height },
        }),
      ],
    }),
);
```

Caption every embedded image with its description and source page, in a paragraph directly below the image: `Image — ${image.label ?? "extracted image"} (page ${image.sourcePage})`. Use the exact `sourcePage` from the helper output.

Verify the package actually contains the media: after the archive, schema, LibreOffice render, and text checks below, confirm `unzip -l output.docx` lists the image under `word/media/` (plus its relationship under `word/_rels/`), and confirm each caption appears in the extracted PDF text.

## Verify the output without images

The model may be text-only. Verify document integrity, schema validity, renderability, page metadata, and extracted content. These checks do not prove visual layout, so say that plainly when handing off the file.

```bash
set -euo pipefail
DOCX_SKILL_DIR="$HOME/.agents/skills/docx"
unzip -t output.docx >/dev/null
python3 "$DOCX_SKILL_DIR/scripts/office/validate.py" output.docx
python3 "$DOCX_SKILL_DIR/scripts/office/soffice.py" --headless --convert-to pdf output.docx
pdfinfo output.pdf | sed -n '1,20p'
pdftotext -layout output.pdf /tmp/output-pdf.txt
test -s /tmp/output-pdf.txt
sed -n '1,160p' /tmp/output-pdf.txt
```

Inspect the extracted text for missing sections, broken ordering, unexpected blank pages, and truncated content. Remove the temporary PDF and text file after verification when the user requested only a `.docx`.

## Editing existing documents

Legacy `.doc` files must be converted first: `python3 "$HOME/.agents/skills/docx/scripts/office/soffice.py" --headless --convert-to docx file.doc`.

```bash
set -euo pipefail
DOCX_SKILL_DIR="$HOME/.agents/skills/docx"
unzip -q doc.docx -d unpacked/
find unpacked -type l -delete   # strip symlink entries; docx from external parties is untrusted
python3 "$DOCX_SKILL_DIR/scripts/merge_runs.py" unpacked/   # coalesce fragmented runs so text is findable
# edit unpacked/word/document.xml in place; preserve its formatting
(cd unpacked && rm -f ../out.docx && zip -Xr ../out.docx .)
python3 "$DOCX_SKILL_DIR/scripts/office/validate.py" out.docx --original doc.docx   # XSD checks; --auto-repair fixes common issues
# redlining? add --author "<the name you redlined under>" to check every edit is tracked
```

Word splits text across many `<w:r>` runs (revision ids, spell-check markers), so a phrase you can see in the document often doesn't exist as a contiguous string in the XML. `merge_runs.py` merges adjacent identically-formatted runs in `word/document.xml` without changing content or rendering; it also accepts a `.docx` directly (`python3 "$HOME/.agents/skills/docx/scripts/merge_runs.py" doc.docx -o merged.docx`).

**Tracked changes:** when redlining, validate with `--author "<the name you redlined under>"` (needs `--original`) — it reports any text you changed without a `<w:ins>`/`<w:del>` around it, which is easy to do by accident and invisible in the accepted view. Wrap runs in `<w:ins>`/`<w:del>` with `w:id`, `w:author`, `w:date` attributes. Inside `<w:del>`, the text element is `<w:delText>`, not `<w:t>`. A deleted paragraph mark (`<w:pPr><w:rPr><w:del w:id=".." w:author=".." w:date=".."/></w:rPr></w:pPr>`) means "merge this paragraph into the next" — so deleting a paragraph outright is that plus a `<w:del>` around every run. The `<w:del/>` must come before the rPr's other children; their order is schema-enforced.

To produce a clean copy with all tracked changes accepted: `python3 "$HOME/.agents/skills/docx/scripts/accept_changes.py" in.docx out.docx`.

Accepting a deleted paragraph mark should join that paragraph to the one below it, so a paragraph whose runs are _all_ deleted vanishes. Word does this; `accept_changes.py` and `pandoc --track-changes=accept` don't always. Both fail the same way — they strip the deleted text but leave the emptied paragraph behind, which reads as a stray empty bullet when it was auto-numbered:

- `pandoc --track-changes=accept` never joins the paragraphs.
- `accept_changes.py` (LibreOffice) joins them correctly, except when the deleted paragraph is followed by an empty spacer paragraph.

An empty bullet in either view is an artifact of that view, not a defect in the document. Check paragraph deletions in the XML.

## Comments

Comments require six cross-linked files. Use the helper — directory mode when you'll also be editing `document.xml` (saves an unzip/rezip cycle), `.docx`-direct mode otherwise:

```bash
# Against an already-unpacked directory (preferred when also placing markers)
python3 "$HOME/.agents/skills/docx/scripts/comment.py" unpacked/ "Fees & expenses cap is too low"
python3 "$HOME/.agents/skills/docx/scripts/comment.py" unpacked/ "Agreed" --parent 0

# Against a .docx directly
python3 "$HOME/.agents/skills/docx/scripts/comment.py" contract.docx "This cap is too low" -o annotated.docx
```

The script writes `comments.xml`, `commentsExtended.xml`, `commentsIds.xml`, `commentsExtensible.xml`, the relationships, and the content-type overrides. Comment IDs are auto-assigned. It then prints the `<w:commentRangeStart>`/`<w:commentRangeEnd>`/`<w:commentReference>` snippet to add to `word/document.xml` so the comment anchors to specific text — until you place those markers, the comment exists but is not visible.

## Dependencies

`docx` (npm, preinstalled) · `lxml` · `pandoc` · LibreOffice (`soffice`) · `pdfinfo` and `pdftotext` (Poppler)
