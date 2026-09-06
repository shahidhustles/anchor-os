import type {
  Attachment,
  AttachmentAdapter,
  CompleteAttachment,
  PendingAttachment,
  ToolCallMessagePartStatus,
} from "@assistant-ui/react";

export const INSPECTION_REPORT_MAX_BYTES = 20 * 1024 * 1024;
export const INSPECTION_REPORT_OPAQUE_MEDIA_TYPE = "application/octet-stream";

const PDF_MEDIA_TYPE = "application/pdf";
const PDF_SIGNATURE = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

export class InspectionReportAttachmentAdapter implements AttachmentAdapter {
  readonly accept = "application/pdf,.pdf";

  private readonly activeAttachmentIds = new Set<string>();

  async add({ file }: { file: File }): Promise<PendingAttachment> {
    if (this.activeAttachmentIds.size > 0) {
      throw new Error("Attach one inspection-report PDF per message.");
    }

    const id = crypto.randomUUID();
    this.activeAttachmentIds.add(id);
    try {
      await validateInspectionReportFile(file);
      return {
        id,
        type: "file",
        name: file.name,
        contentType: PDF_MEDIA_TYPE,
        file,
        status: { type: "requires-action", reason: "composer-send" },
      };
    } catch (error) {
      this.activeAttachmentIds.delete(id);
      throw error;
    }
  }

  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    try {
      return {
        id: attachment.id,
        type: "file",
        name: attachment.name,
        contentType: PDF_MEDIA_TYPE,
        file: attachment.file,
        content: [
          {
            type: "file",
            data: await fileToOpaqueDataUrl(attachment.file),
            mimeType: INSPECTION_REPORT_OPAQUE_MEDIA_TYPE,
            filename: attachment.name,
          },
        ],
        status: { type: "complete" },
      };
    } finally {
      this.activeAttachmentIds.delete(attachment.id);
    }
  }

  async remove(attachment: Attachment): Promise<void> {
    this.activeAttachmentIds.delete(attachment.id);
  }
}

export async function validateInspectionReportFile(file: File): Promise<void> {
  const isPdfName = file.name.toLowerCase().endsWith(".pdf");
  if (!isPdfName || (file.type !== "" && file.type !== PDF_MEDIA_TYPE)) {
    throw new Error("Only PDF inspection reports are supported.");
  }
  if (file.size === 0) {
    throw new Error("The inspection-report PDF is empty.");
  }
  if (file.size > INSPECTION_REPORT_MAX_BYTES) {
    throw new Error("The inspection-report PDF must be 20 MiB or smaller.");
  }

  const signature = new Uint8Array(await file.slice(0, PDF_SIGNATURE.length).arrayBuffer());
  if (!PDF_SIGNATURE.every((byte, index) => signature[index] === byte)) {
    throw new Error("The selected file does not contain a valid PDF signature.");
  }
}

export function assertInspectionReportAttachmentMessage(message: unknown): void {
  if (typeof message === "string" || !Array.isArray(message)) return;

  const files = message.filter(isFilePart);
  if (files.length === 0) return;
  if (files.length > 1) {
    throw new Error("Send one inspection-report PDF per message.");
  }

  const file = files[0];
  if (
    file === undefined ||
    file.mediaType !== INSPECTION_REPORT_OPAQUE_MEDIA_TYPE ||
    typeof file.filename !== "string" ||
    !file.filename.toLowerCase().endsWith(".pdf")
  ) {
    throw new Error("Only opaque inspection-report PDF attachments may be sent.");
  }
}

export type InspectionReportToolView = {
  readonly tone: "active" | "complete" | "cancelled" | "error";
  readonly label: string;
  readonly detail: string | null;
};

export function inspectionReportToolView(
  result: unknown,
  status: ToolCallMessagePartStatus,
): InspectionReportToolView {
  if (status.type === "incomplete") {
    if (status.reason === "cancelled") {
      return { tone: "cancelled", label: "Stopped reading report", detail: null };
    }
    return { tone: "error", label: "Could not read report", detail: null };
  }

  if (isRecord(result) && result.status === "complete" && isPositiveInteger(result.totalPages)) {
    return {
      tone: "complete",
      label: `Read ${result.totalPages} of ${result.totalPages} pages`,
      detail: isNonNegativeInteger(result.imageCount)
        ? `${result.imageCount} extracted ${result.imageCount === 1 ? "image" : "images"}`
        : null,
    };
  }

  if (isRecord(result)) {
    if (result.phase === "validating") {
      return {
        tone: "active",
        label: "Checking report",
        detail: typeof result.filename === "string" ? result.filename : null,
      };
    }
    if (result.phase === "reading" && isPositiveInteger(result.totalPages)) {
      return {
        tone: "active",
        label: `Reading report · ${result.totalPages} ${result.totalPages === 1 ? "page" : "pages"}`,
        detail: null,
      };
    }
    if (result.phase === "saving" && isPositiveInteger(result.totalPages)) {
      return {
        tone: "active",
        label: "Preparing report files",
        detail: isNonNegativeInteger(result.imageCount)
          ? `${result.totalPages} pages · ${result.imageCount} ${result.imageCount === 1 ? "image" : "images"}`
          : `${result.totalPages} pages`,
      };
    }
  }

  return { tone: "active", label: "Preparing report", detail: null };
}

async function fileToOpaqueDataUrl(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${INSPECTION_REPORT_OPAQUE_MEDIA_TYPE};base64,${btoa(binary)}`;
}

function isFilePart(value: unknown): value is Record<string, unknown> & { readonly type: "file" } {
  return isRecord(value) && value.type === "file";
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
