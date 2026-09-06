import assert from "node:assert/strict";
import { test } from "node:test";

import * as XLSX from "xlsx";

import { sheetToStyledHtml } from "./sheet-html";

type CellInit = {
  readonly address: string;
  readonly cell: Record<string, unknown>;
};

function sheetWith(options: {
  readonly ref: string;
  readonly cells?: readonly CellInit[];
  readonly cols?: unknown[];
  readonly rows?: unknown[];
  readonly merges?: unknown[];
}): XLSX.WorkSheet {
  const sheet: Record<string, unknown> = { "!ref": options.ref };
  for (const { address, cell } of options.cells ?? []) sheet[address] = cell;
  if (options.cols) sheet["!cols"] = options.cols;
  if (options.rows) sheet["!rows"] = options.rows;
  if (options.merges) sheet["!merges"] = options.merges;
  return sheet as XLSX.WorkSheet;
}

test("renders column widths and right-aligned formatted numbers", () => {
  const html = sheetToStyledHtml(
    sheetWith({
      ref: "A1:B1",
      cols: [{ wpx: 84 }, { wpx: 120 }],
      cells: [
        { address: "A1", cell: { t: "s", v: "Planned Cost" } },
        {
          address: "B1",
          cell: { t: "n", v: 85000, z: '"$"#,##0;("$"#,##0);-' },
        },
      ],
    }),
    XLSX,
  );

  assert.match(html, /<col style="width:84px">/);
  assert.match(html, /<col style="width:120px">/);
  assert.match(html, /<td[^>]*>\$85,000<\/td>/);
  assert.match(html, /text-align:right/);
});

test("applies solid fills and flips dark fills to white text", () => {
  const html = sheetToStyledHtml(
    sheetWith({
      ref: "A1:A2",
      cells: [
        {
          address: "A1",
          cell: {
            t: "s",
            v: "Status",
            s: { patternType: "solid", fgColor: { rgb: "FF1F4E78" } },
          },
        },
        {
          address: "A2",
          cell: {
            t: "s",
            v: "Within Budget",
            s: { patternType: "solid", fgColor: { rgb: "D9E1F2" } },
          },
        },
      ],
    }),
    XLSX,
  );

  assert.match(html, /background:#1f4e78;color:#fff/);
  assert.match(html, /background:#d9e1f2;/);
  assert.doesNotMatch(html, /background:#d9e1f2;color:#fff/);
});

test("renders merged cells as spans and skips covered cells", () => {
  const html = sheetToStyledHtml(
    sheetWith({
      ref: "A1:B3",
      cells: [
        { address: "A1", cell: { t: "s", v: "Header" } },
        { address: "A3", cell: { t: "s", v: "Variance = Actual - Planned." } },
      ],
      merges: [{ s: { r: 2, c: 0 }, e: { r: 2, c: 1 } }],
    }),
    XLSX,
  );

  assert.match(html, /<td colspan="2">Variance = Actual - Planned\.<\/td>/);
  assert.equal(html.split("<td").length - 1, 5);
});

test("escapes HTML in cell text", () => {
  const html = sheetToStyledHtml(
    sheetWith({
      ref: "A1",
      cells: [{ address: "A1", cell: { t: "s", v: '<b>"Bold"</b> & <i>' } }],
    }),
    XLSX,
  );

  assert.match(html, /&lt;b&gt;&quot;Bold&quot;&lt;\/b&gt; &amp; &lt;i&gt;/);
  assert.doesNotMatch(html, /<b>|<i>/);
});

test("renders row heights and falls back to a default column width", () => {
  const html = sheetToStyledHtml(
    sheetWith({
      ref: "A1:B1",
      cells: [{ address: "A1", cell: { t: "s", v: "Wide" } }],
      rows: [{ hpx: 30 }],
    }),
    XLSX,
  );

  assert.match(html, /<tr style="height:30px">/);
  assert.match(html, /<col style="width:64px">/);
});

test("returns an empty table for a sheet without a range", () => {
  assert.equal(sheetToStyledHtml(sheetWith({ ref: "" }), XLSX), "");
});
