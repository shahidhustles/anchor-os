const LAYOUT_PARSING_PATH = "/layout-parsing";
const MIB = 1024 * 1024;

export const PADDLE_OCR_DEFAULT_MAX_INPUT_BYTES = 20 * MIB;
export const PADDLE_OCR_DEFAULT_MAX_OUTPUT_BYTES = 64 * MIB;
export const PADDLE_OCR_DEFAULT_MAX_RESPONSE_BYTES = 96 * MIB;

export type PaddleOcrImage = {
  readonly key: string;
  readonly bytes: Uint8Array;
};

export type PaddleOcrPage = {
  readonly pageNumber: number;
  readonly markdownText: string;
  readonly images: readonly PaddleOcrImage[];
  readonly prunedResult: Record<string, unknown>;
};

export type PaddleOcrResult = {
  readonly logId: string;
  readonly numPages: number;
  readonly pages: readonly PaddleOcrPage[];
};

export type PaddleOcrOptions = {
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxResponseBytes?: number;
};

export function resolvePaddleOcrBaseUrl(configured: unknown): string {
  if (typeof configured !== "string" || configured.trim() === "") {
    throw new Error(
      "PADDLE_OCR_BASE_URL is required. Add it to apps/web/.env.local before using the Paddle OCR service.",
    );
  }

  const value = configured.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`PADDLE_OCR_BASE_URL must be an absolute URL; got "${configured.trim()}".`);
  }

  if (url.protocol !== "http:") {
    throw new Error(
      `PADDLE_OCR_BASE_URL must use plain http for the private Paddle service; got "${url.protocol}${url.host}".`,
    );
  }

  if (!isPrivateHttpHost(url.hostname)) {
    throw new Error(
      `PADDLE_OCR_BASE_URL must point at a loopback, RFC 1918, or 100.64.0.0/10 host; got "${url.hostname}".`,
    );
  }

  return value;
}

export async function parsePaddleOcrPdf(
  pdf: Uint8Array,
  options: PaddleOcrOptions = {},
): Promise<PaddleOcrResult> {
  const { signal } = options;
  if (signal?.aborted) {
    throw new Error("Paddle OCR request was cancelled before it started.");
  }

  const maxInputBytes = options.maxInputBytes ?? PADDLE_OCR_DEFAULT_MAX_INPUT_BYTES;
  const maxOutputBytes = options.maxOutputBytes ?? PADDLE_OCR_DEFAULT_MAX_OUTPUT_BYTES;
  const maxResponseBytes = options.maxResponseBytes ?? PADDLE_OCR_DEFAULT_MAX_RESPONSE_BYTES;

  if (pdf.byteLength === 0) {
    throw new Error("Paddle OCR input PDF is empty.");
  }
  if (pdf.byteLength > maxInputBytes) {
    throw new Error(
      `Paddle OCR input PDF of ${mib(pdf.byteLength).toFixed(2)} MiB exceeds the ${mib(maxInputBytes).toFixed(2)} MiB input limit.`,
    );
  }

  const baseUrl = resolvePaddleOcrBaseUrl(options.baseUrl ?? process.env.PADDLE_OCR_BASE_URL);
  const url = `${baseUrl}${LAYOUT_PARSING_PATH}`;
  const fileBase64 = Buffer.from(pdf).toString("base64");

  const startedAt = Date.now();
  let response: Response;
  try {
    signal?.throwIfAborted();
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        file: fileBase64,
        fileType: 0,
        returnMarkdownImages: true,
        restructurePages: true,
        visualize: false,
      }),
      signal,
    });
  } catch (error) {
    throw requestError(signal, url, error);
  }

  let bodyText: string;
  try {
    bodyText = await readBodyWithLimit(response, maxResponseBytes);
  } catch (error) {
    throw requestError(signal, url, error);
  }

  if (!response.ok) {
    throw httpError(url, response.status, bodyText);
  }

  const result = parseSuccessEnvelope(bodyText, maxOutputBytes);
  console.info(
    `[paddle-ocr] ${url} -> ${result.numPages} page(s), ${mib(pdf.byteLength).toFixed(2)} MiB in, ` +
      `${mib(decodedImageBytes(result)).toFixed(2)} MiB images out, ${Date.now() - startedAt} ms, logId ${result.logId}`,
  );
  return result;
}

function parseSuccessEnvelope(bodyText: string, maxOutputBytes: number): PaddleOcrResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new Error("Paddle OCR service returned a non-JSON response.");
  }

  if (!isRecord(parsed)) {
    throw new Error("Paddle OCR response envelope is not an object.");
  }
  const { logId, errorCode, errorMsg, result } = parsed;
  if (typeof logId !== "string" || typeof errorCode !== "number" || typeof errorMsg !== "string") {
    throw new Error("Paddle OCR response envelope is missing logId, errorCode, or errorMsg.");
  }
  if (errorCode !== 0) {
    throw new Error(`Paddle OCR request failed (errorCode ${errorCode}, logId ${logId}): ${errorMsg}`);
  }
  if (!isRecord(result)) {
    throw new Error(`Paddle OCR response is missing result (logId ${logId}).`);
  }

  const { dataInfo, layoutParsingResults } = result;
  if (!isRecord(dataInfo) || !isPositiveInteger(dataInfo.numPages) || !Array.isArray(dataInfo.pages)) {
    throw new Error(`Paddle OCR response is missing dataInfo.numPages or dataInfo.pages (logId ${logId}).`);
  }
  if (!Array.isArray(layoutParsingResults)) {
    throw new Error(`Paddle OCR response is missing layoutParsingResults (logId ${logId}).`);
  }
  if (dataInfo.numPages !== dataInfo.pages.length || dataInfo.numPages !== layoutParsingResults.length) {
    throw new Error(
      `Paddle OCR page counts disagree: dataInfo.numPages=${dataInfo.numPages}, dataInfo.pages=${dataInfo.pages.length}, ` +
        `layoutParsingResults=${layoutParsingResults.length} (logId ${logId}).`,
    );
  }

  const pages: PaddleOcrPage[] = [];
  let decodedOutputBytes = 0;
  for (const [index, entry] of layoutParsingResults.entries()) {
    const page = parsePage(entry, index, logId);
    decodedOutputBytes += totalImageBytes(page);
    if (decodedOutputBytes > maxOutputBytes) {
      throw new Error(
        `Paddle OCR decoded images total ${mib(decodedOutputBytes).toFixed(2)} MiB, above the ` +
          `${mib(maxOutputBytes).toFixed(2)} MiB output limit (logId ${logId}).`,
      );
    }
    pages.push(page);
  }

  return { logId, numPages: dataInfo.numPages, pages };
}

function parsePage(entry: unknown, index: number, logId: string): PaddleOcrPage {
  const where = `layoutParsingResults[${index}]`;
  if (!isRecord(entry)) {
    throw new Error(`Paddle OCR ${where} is not an object (logId ${logId}).`);
  }

  const { markdown, prunedResult } = entry;
  if (!isRecord(markdown) || typeof markdown.text !== "string") {
    throw new Error(`Paddle OCR ${where}.markdown.text is missing or not a string (logId ${logId}).`);
  }
  if (!isRecord(markdown.images)) {
    throw new Error(`Paddle OCR ${where}.markdown.images is missing or not an object (logId ${logId}).`);
  }
  if (!isRecord(prunedResult)) {
    throw new Error(`Paddle OCR ${where}.prunedResult is missing or not an object (logId ${logId}).`);
  }

  const images: PaddleOcrImage[] = [];
  for (const [key, value] of Object.entries(markdown.images)) {
    if (!isSafeRelativeImagePath(key)) {
      throw new Error(`Paddle OCR ${where} has an unsafe image path "${key}" (logId ${logId}).`);
    }
    if (typeof value !== "string" || !isBase64(value)) {
      throw new Error(`Paddle OCR ${where} image "${key}" is not valid Base64 (logId ${logId}).`);
    }
    images.push({ key, bytes: new Uint8Array(Buffer.from(value, "base64")) });
  }

  return {
    pageNumber: index + 1,
    markdownText: markdown.text,
    images,
    prunedResult,
  };
}

function isPrivateHttpHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "::1" || hostname === "[::1]") return true;

  const octets = hostname.split(".");
  if (octets.length !== 4) return false;
  if (!octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)) return false;

  const [first, second] = octets.map(Number);
  if (first === 127 || first === 10) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  return false;
}

function isSafeRelativeImagePath(key: string): boolean {
  if (key.length === 0 || key.includes("\\")) return false;
  if (key.startsWith("/")) return false;
  return key.split("/").every(
    (segment) => segment.length > 0 && segment !== "." && segment !== ".." && /^[A-Za-z0-9._-]+$/.test(segment),
  );
}

function isBase64(value: string): boolean {
  return value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && value > 0;
}

function totalImageBytes(page: PaddleOcrPage): number {
  return page.images.reduce((total, image) => total + image.bytes.byteLength, 0);
}

function decodedImageBytes(result: PaddleOcrResult): number {
  return result.pages.reduce((total, page) => total + totalImageBytes(page), 0);
}

function mib(bytes: number): number {
  return bytes / MIB;
}

function requestError(signal: AbortSignal | undefined, url: string, error: unknown): Error {
  if (signal?.aborted) {
    return new Error(`Paddle OCR request to ${url} was cancelled before completion.`);
  }
  if (error instanceof TypeError) {
    return new Error(`Paddle OCR service is unreachable at ${url}: ${error.message}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function httpError(url: string, status: number, bodyText: string): Error {
  let detail = "";
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (isRecord(parsed) && typeof parsed.errorMsg === "string") {
      const logId = typeof parsed.logId === "string" ? `, logId ${parsed.logId}` : "";
      detail = `: ${parsed.errorMsg}${logId}`;
    }
  } catch {
    detail = "";
  }
  return new Error(`Paddle OCR service returned HTTP ${status} from ${url}${detail}.`);
}

async function readBodyWithLimit(response: Response, limitBytes: number): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > limitBytes) {
    throw new Error(
      `Paddle OCR response body limit of ${mib(limitBytes).toFixed(2)} MiB exceeded (content-length ${contentLength} bytes).`,
    );
  }

  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) text += decoder.decode(value, { stream: true });
    if (text.length > limitBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`Paddle OCR response body limit of ${mib(limitBytes).toFixed(2)} MiB exceeded.`);
    }
  }
  text += decoder.decode();
  return text;
}
