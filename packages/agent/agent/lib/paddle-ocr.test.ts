import { afterEach, expect, test } from "bun:test";

import { parsePaddleOcrPdf } from "./paddle-ocr";

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env.PADDLE_OCR_BASE_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalBaseUrl === undefined) delete process.env.PADDLE_OCR_BASE_URL;
  else process.env.PADDLE_OCR_BASE_URL = originalBaseUrl;
});

const DEMO_BASE_URL = "http://100.90.16.40:8080";
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const PDF_BASE64 = Buffer.from(PDF_BYTES).toString("base64");
const IMAGE_BYTES = new Uint8Array([1, 2, 3, 4]);
const IMAGE_BASE64 = Buffer.from(IMAGE_BYTES).toString("base64");

type CapturedRequest = {
  readonly url: string;
  readonly method: string | undefined;
  readonly contentType: string | null;
  readonly body: string;
};

function stubPaddleService(respond: () => Response): CapturedRequest[] {
  const requests: CapturedRequest[] = [];
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method,
      contentType: new Headers(init?.headers).get("content-type"),
      body: String(init?.body ?? ""),
    });
    return respond();
  }) as typeof fetch;
  return requests;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function successPayload(): Record<string, unknown> {
  return {
    logId: "log-1",
    errorCode: 0,
    errorMsg: "Success",
    result: {
      dataInfo: {
        type: "pdf",
        numPages: 2,
        pages: [{ pageNumber: 1 }, { pageNumber: 2 }],
      },
      layoutParsingResults: [
        {
          prunedResult: { page_number: 1 },
          markdown: {
            text: "# Page one\n\n![photo](imgs/img_001.jpg)",
            images: { "imgs/img_001.jpg": IMAGE_BASE64 },
          },
        },
        {
          prunedResult: { page_number: 2 },
          markdown: { text: "# Page two", images: {} },
        },
      ],
    },
  };
}

function resultField(payload: Record<string, unknown>): Record<string, unknown> {
  return payload.result as Record<string, unknown>;
}

function firstEntry(payload: Record<string, unknown>): Record<string, unknown> {
  return (resultField(payload).layoutParsingResults as unknown[])[0] as Record<string, unknown>;
}

function firstMarkdown(payload: Record<string, unknown>): Record<string, unknown> {
  return firstEntry(payload).markdown as Record<string, unknown>;
}

test("posts the whole PDF with fileType 0 and returns ordered typed pages", async () => {
  process.env.PADDLE_OCR_BASE_URL = DEMO_BASE_URL;
  const requests = stubPaddleService(() => jsonResponse(successPayload()));

  const result = await parsePaddleOcrPdf(PDF_BYTES);

  expect(requests).toHaveLength(1);
  expect(requests[0]!.url).toBe("http://100.90.16.40:8080/layout-parsing");
  expect(requests[0]!.method).toBe("POST");
  expect(requests[0]!.contentType).toBe("application/json");
  expect(JSON.parse(requests[0]!.body)).toEqual({
    file: PDF_BASE64,
    fileType: 0,
    returnMarkdownImages: true,
    restructurePages: true,
    visualize: false,
  });

  expect(result.logId).toBe("log-1");
  expect(result.numPages).toBe(2);
  expect(result.pages.map((page) => page.pageNumber)).toEqual([1, 2]);
  expect(result.pages[0]!.markdownText).toBe("# Page one\n\n![photo](imgs/img_001.jpg)");
  expect(result.pages[0]!.prunedResult).toEqual({ page_number: 1 });
  expect(result.pages[0]!.images).toHaveLength(1);
  expect(result.pages[0]!.images[0]!.key).toBe("imgs/img_001.jpg");
  expect(Array.from(result.pages[0]!.images[0]!.bytes)).toEqual([1, 2, 3, 4]);
  expect(result.pages[1]!.markdownText).toBe("# Page two");
  expect(result.pages[1]!.images).toHaveLength(0);
});

test("rejects Paddle error envelopes with code, message, and logId", async () => {
  process.env.PADDLE_OCR_BASE_URL = DEMO_BASE_URL;
  stubPaddleService(() => jsonResponse({ logId: "log-9", errorCode: 1, errorMsg: "Model file not found" }));

  const error = await parsePaddleOcrPdf(PDF_BYTES).catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(Error);
  const message = (error as Error).message;
  expect(message).toContain("errorCode 1");
  expect(message).toContain("Model file not found");
  expect(message).toContain("log-9");
  expect(message).not.toContain(PDF_BASE64);
});

const malformedCases: readonly (readonly [string, (payload: Record<string, unknown>) => void, RegExp])[] = [
  [
    "missing result",
    (payload) => {
      delete payload.result;
    },
    /missing result/,
  ],
  [
    "missing dataInfo",
    (payload) => {
      delete resultField(payload).dataInfo;
    },
    /dataInfo/,
  ],
  [
    "page counts disagree",
    (payload) => {
      (resultField(payload).dataInfo as Record<string, unknown>).numPages = 3;
    },
    /page counts disagree/,
  ],
  [
    "missing layoutParsingResults",
    (payload) => {
      delete resultField(payload).layoutParsingResults;
    },
    /layoutParsingResults/,
  ],
  [
    "non-object page entry",
    (payload) => {
      (resultField(payload).layoutParsingResults as unknown[])[0] = "nope";
    },
    /is not an object/,
  ],
  [
    "missing markdown.text",
    (payload) => {
      delete firstMarkdown(payload).text;
    },
    /markdown\.text/,
  ],
  [
    "markdown.images not an object",
    (payload) => {
      firstMarkdown(payload).images = [];
    },
    /markdown\.images/,
  ],
  [
    "image value not Base64",
    (payload) => {
      firstMarkdown(payload).images = { "imgs/img_001.jpg": 42 };
    },
    /not valid Base64/,
  ],
  [
    "unsafe relative image path",
    (payload) => {
      firstMarkdown(payload).images = { "../escape.jpg": IMAGE_BASE64 };
    },
    /unsafe image path/,
  ],
  [
    "absolute image path",
    (payload) => {
      firstMarkdown(payload).images = { "/etc/passwd.jpg": IMAGE_BASE64 };
    },
    /unsafe image path/,
  ],
  [
    "missing prunedResult",
    (payload) => {
      delete firstEntry(payload).prunedResult;
    },
    /prunedResult/,
  ],
];

for (const [name, mutate, expected] of malformedCases) {
  test(`rejects malformed response: ${name}`, async () => {
    process.env.PADDLE_OCR_BASE_URL = DEMO_BASE_URL;
    const payload = successPayload();
    mutate(payload);
    stubPaddleService(() => jsonResponse(payload));

    await expect(parsePaddleOcrPdf(PDF_BYTES)).rejects.toThrow(expected);
  });
}

test("enforces the decoded output limit", async () => {
  process.env.PADDLE_OCR_BASE_URL = DEMO_BASE_URL;
  stubPaddleService(() => jsonResponse(successPayload()));

  await expect(parsePaddleOcrPdf(PDF_BYTES, { maxOutputBytes: 2 })).rejects.toThrow(/output limit/);
});

test("rejects oversized PDFs before sending", async () => {
  process.env.PADDLE_OCR_BASE_URL = DEMO_BASE_URL;
  const requests = stubPaddleService(() => {
    throw new Error("must not be called");
  });

  await expect(parsePaddleOcrPdf(PDF_BYTES, { maxInputBytes: 4 })).rejects.toThrow(/input limit/);
  expect(requests).toHaveLength(0);
});

test("rejects empty PDF input", async () => {
  process.env.PADDLE_OCR_BASE_URL = DEMO_BASE_URL;
  stubPaddleService(() => {
    throw new Error("must not be called");
  });

  await expect(parsePaddleOcrPdf(new Uint8Array())).rejects.toThrow(/empty/);
});

test("rejects public, https, and malformed base URLs", async () => {
  process.env.PADDLE_OCR_BASE_URL = DEMO_BASE_URL;
  const requests = stubPaddleService(() => {
    throw new Error("must not be called");
  });

  process.env.PADDLE_OCR_BASE_URL = "http://8.8.8.8:8080";
  await expect(parsePaddleOcrPdf(PDF_BYTES)).rejects.toThrow(/100\.64\.0\.0\/10/);

  process.env.PADDLE_OCR_BASE_URL = "https://100.90.16.40:8080";
  await expect(parsePaddleOcrPdf(PDF_BYTES)).rejects.toThrow(/plain http/);

  process.env.PADDLE_OCR_BASE_URL = "not a url";
  await expect(parsePaddleOcrPdf(PDF_BYTES)).rejects.toThrow(/absolute URL/);

  expect(requests).toHaveLength(0);
});

test("requires PADDLE_OCR_BASE_URL", async () => {
  delete process.env.PADDLE_OCR_BASE_URL;
  stubPaddleService(() => {
    throw new Error("must not be called");
  });

  await expect(parsePaddleOcrPdf(PDF_BYTES)).rejects.toThrow(/PADDLE_OCR_BASE_URL is required/);
});

test("surfaces cancellation as a clear error", async () => {
  process.env.PADDLE_OCR_BASE_URL = DEMO_BASE_URL;
  const controller = new AbortController();
  stubPaddleService(() => {
    controller.abort();
    throw new DOMException("The operation was aborted.", "AbortError");
  });

  await expect(parsePaddleOcrPdf(PDF_BYTES, { signal: controller.signal })).rejects.toThrow(/cancelled/);
});

test("fails fast when the signal is already aborted", async () => {
  process.env.PADDLE_OCR_BASE_URL = DEMO_BASE_URL;
  const controller = new AbortController();
  controller.abort();
  const requests = stubPaddleService(() => {
    throw new Error("must not be called");
  });

  await expect(parsePaddleOcrPdf(PDF_BYTES, { signal: controller.signal })).rejects.toThrow(/cancelled/);
  expect(requests).toHaveLength(0);
});

test("maps non-200 responses to clear errors", async () => {
  process.env.PADDLE_OCR_BASE_URL = DEMO_BASE_URL;
  stubPaddleService(() =>
    jsonResponse({ logId: "log-5", errorCode: 500, errorMsg: "Internal error" }, 500),
  );

  const error = await parsePaddleOcrPdf(PDF_BYTES).catch((caught: unknown) => caught);

  const message = (error as Error).message;
  expect(message).toContain("HTTP 500");
  expect(message).toContain("Internal error");
  expect(message).toContain("log-5");
  expect(message).not.toContain(PDF_BASE64);
});

test("bounds oversized response bodies", async () => {
  process.env.PADDLE_OCR_BASE_URL = DEMO_BASE_URL;
  const oversized = "x".repeat(2048);
  stubPaddleService(
    () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(oversized));
            controller.close();
          },
        }),
      ),
  );

  await expect(parsePaddleOcrPdf(PDF_BYTES, { maxResponseBytes: 1024 })).rejects.toThrow(
    /response body limit/,
  );
});

test("wraps network failures with the endpoint", async () => {
  process.env.PADDLE_OCR_BASE_URL = DEMO_BASE_URL;
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;

  await expect(parsePaddleOcrPdf(PDF_BYTES)).rejects.toThrow(/unreachable at http:\/\/100\.90\.16\.40:8080\/layout-parsing/);
});
