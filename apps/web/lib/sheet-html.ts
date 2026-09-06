import type { CellObject, WorkSheet } from "xlsx";

type XlsxModule = typeof import("xlsx");
type NumberFormatter = (format: string, value: number) => string;

type ParsedFill = {
  readonly background: string | undefined;
  readonly lightText: boolean;
};

const DEFAULT_COLUMN_PX = 64;
const LIGHT_TEXT_LUMINANCE = 0.6;
const HEX_RGB_PATTERN = /^[0-9a-f]{6}$/;

/**
 * Renders a worksheet as a self-contained HTML table. SheetJS Community
 * Edition parses fills, column widths, row heights, merges, and number
 * formats, but drops fonts, alignment, and borders — so alignment falls back
 * to Excel's defaults (numbers right, booleans centered) and text on a dark
 * fill is flipped to white for contrast.
 */
export function sheetToStyledHtml(sheet: WorkSheet, xlsx: XlsxModule): string {
  const ref = sheet["!ref"];
  if (typeof ref !== "string" || ref === "") return "";

  const range = xlsx.utils.decode_range(ref);
  const { anchors, covered } = indexMerges(sheet["!merges"]);

  const columns: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const col = sheet["!cols"]?.[c];
    const width = col?.hidden === true ? 0 : (col?.wpx ?? DEFAULT_COLUMN_PX);
    columns.push(`<col style="width:${width}px">`);
  }

  const rows: string[] = [];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const row = sheet["!rows"]?.[r];
    const height =
      row?.hidden === true || row?.hpx === undefined ? "" : ` style="height:${row.hpx}px"`;

    const cells: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      if (covered.has(`${r}:${c}`)) continue;
      cells.push(renderCell(sheet, xlsx, { r, c }, anchors.get(`${r}:${c}`)));
    }

    rows.push(`<tr${height}>${cells.join("")}</tr>`);
  }

  return `<table><colgroup>${columns.join("")}</colgroup><tbody>${rows.join("")}</tbody></table>`;
}

function indexMerges(merges: unknown): {
  readonly anchors: Map<string, unknown>;
  readonly covered: Set<string>;
} {
  const anchors = new Map<string, unknown>();
  const covered = new Set<string>();

  if (!Array.isArray(merges)) return { anchors, covered };

  for (const merge of merges) {
    const start = readAddress(merge, "s");
    const end = readAddress(merge, "e");
    if (start === undefined || end === undefined) continue;

    anchors.set(`${start.r}:${start.c}`, merge);
    for (let r = start.r; r <= end.r; r += 1) {
      for (let c = start.c; c <= end.c; c += 1) {
        if (r !== start.r || c !== start.c) covered.add(`${r}:${c}`);
      }
    }
  }

  return { anchors, covered };
}

function readAddress(
  merge: unknown,
  key: "s" | "e",
): { readonly r: number; readonly c: number } | undefined {
  if (typeof merge !== "object" || merge === null) return undefined;
  const address = (merge as Record<string, unknown>)[key];
  if (typeof address !== "object" || address === null) return undefined;
  const r = (address as Record<string, unknown>).r;
  const c = (address as Record<string, unknown>).c;
  if (typeof r !== "number" || typeof c !== "number") return undefined;
  return { r, c };
}

function renderCell(
  sheet: WorkSheet,
  xlsx: XlsxModule,
  address: { readonly r: number; readonly c: number },
  merge: unknown,
): string {
  const cell = sheet[xlsx.utils.encode_cell(address)] as CellObject | undefined;

  const span = spanAttributes(address, merge);
  const style = `${fillStyle(cell)}${alignmentStyle(cell)}`;
  const styleAttribute = style === "" ? "" : ` style="${style}"`;
  const text = escapeHtml(cellText(cell, xlsx));

  return `<td${span}${styleAttribute}>${text}</td>`;
}

function spanAttributes(
  address: { readonly r: number; readonly c: number },
  merge: unknown,
): string {
  const end = readAddress(merge, "e");
  if (end === undefined) return "";

  const rowSpan = end.r - address.r + 1;
  const colSpan = end.c - address.c + 1;
  const rowSpanAttribute = rowSpan > 1 ? ` rowspan="${rowSpan}"` : "";
  const colSpanAttribute = colSpan > 1 ? ` colspan="${colSpan}"` : "";
  return `${rowSpanAttribute}${colSpanAttribute}`;
}

function cellText(cell: CellObject | undefined, xlsx: XlsxModule): string {
  if (cell === undefined) return "";
  if (typeof cell.w === "string") return cell.w;
  if (typeof cell.v === "string") return cell.v;

  if (typeof cell.v === "number") {
    const format = typeof cell.z === "string" ? cell.z : undefined;
    if (format !== undefined) {
      const formatNumber = asNumberFormatter(xlsx.SSF);
      if (formatNumber !== undefined) {
        try {
          const text = formatNumber(format, cell.v);
          if (typeof text === "string") return text;
        } catch {
          return String(cell.v);
        }
      }
    }
    return String(cell.v);
  }

  if (typeof cell.v === "boolean") return cell.v ? "TRUE" : "FALSE";
  if (cell.v instanceof Date) return cell.v.toISOString().slice(0, 10);
  return "";
}

function asNumberFormatter(value: unknown): NumberFormatter | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const format = (value as Record<string, unknown>).format;
  return typeof format === "function" ? (format as NumberFormatter) : undefined;
}

function fillStyle(cell: CellObject | undefined): string {
  const fill = parseFill(cell?.s);
  if (fill?.background === undefined) return "";
  const color = fill.lightText ? ";color:#fff" : "";
  return `background:${fill.background}${color};`;
}

function parseFill(style: unknown): ParsedFill | undefined {
  if (typeof style !== "object" || style === null) return undefined;
  const record = style as Record<string, unknown>;
  if (record.patternType !== "solid") return undefined;

  const fgColor = record.fgColor;
  if (typeof fgColor !== "object" || fgColor === null) return undefined;
  const rgb = (fgColor as Record<string, unknown>).rgb;
  if (typeof rgb !== "string") return undefined;

  const hex = rgb.slice(-6).toLowerCase();
  if (!HEX_RGB_PATTERN.test(hex)) return undefined;

  return {
    background: `#${hex}`,
    lightText: luminance(hex) < LIGHT_TEXT_LUMINANCE,
  };
}

function luminance(hex: string): number {
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
}

function alignmentStyle(cell: CellObject | undefined): string {
  if (cell === undefined) return "";
  if (cell.t === "n" || cell.t === "d" || cell.t === "e") return "text-align:right;";
  if (cell.t === "b") return "text-align:center;";
  return "";
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
