export type SanitizedStreamEvent = {
  readonly type: string;
  readonly data: Record<string, unknown> | null;
  readonly meta: {
    readonly id: string;
    readonly at: string;
  };
};

export type SanitizedChatMessage = {
  readonly id: string;
  readonly role: "assistant" | "user";
  readonly parts: readonly unknown[];
  readonly metadata: Record<string, unknown>;
};

const REASONING_EVENT_TYPES = new Set(["reasoning.appended", "reasoning.completed"]);

const DATA_URL_PATTERN = /data:[^,\s]{0,300};base64,[A-Za-z0-9+/=]+/gi;
const BASE64_PATTERN = /^[A-Za-z0-9+/=\s]+$/;
const BASE64_MIN_LENGTH = 1024;
const DATA_URL_PLACEHOLDER = "[data URL stripped]";
const BASE64_PLACEHOLDER = "[base64 payload stripped]";

export function sanitizeUserMessage(message: string | readonly unknown[]): readonly unknown[] {
  if (typeof message === "string") {
    return [{ type: "text", text: scrubString(message) }];
  }
  return message.map(sanitizeMessagePart).filter((part) => part !== null);
}

export function sanitizeStreamEvent(event: unknown): SanitizedStreamEvent | null {
  if (!isRecord(event)) return null;
  const { type, data, meta } = event;
  if (typeof type !== "string" || type === "") return null;
  if (REASONING_EVENT_TYPES.has(type)) return null;
  if (!isRecord(meta)) return null;
  const { id, at } = meta;
  if (typeof id !== "string" || id.trim() === "") return null;
  if (typeof at !== "string" || at.trim() === "") return null;

  let sanitizedData: Record<string, unknown> | null = null;
  if (data !== undefined) {
    if (!isRecord(data)) return null;
    sanitizedData = data;
    if (type === "subagent.event") {
      const child = sanitizeStreamEvent(data["event"]);
      if (child === null) return null;
      sanitizedData = { ...data, event: child };
    }
  }
  const sanitizedMeta = { id, at };
  if (sanitizedData === null) return { type, data: null, meta: sanitizedMeta };
  return {
    type,
    data: scrubValue(sanitizedData) as Record<string, unknown>,
    meta: sanitizedMeta,
  };
}

export function sanitizeChatMessages(messages: readonly unknown[]): SanitizedChatMessage[] {
  const sanitized: SanitizedChatMessage[] = [];
  for (const message of messages) {
    if (!isRecord(message)) continue;
    const { id, role, parts, metadata } = message;
    if (typeof id !== "string" || id.trim() === "") continue;
    if (role !== "assistant" && role !== "user") continue;
    if (!Array.isArray(parts)) continue;
    const sanitizedMetadata = metadata === undefined ? {} : metadata;
    sanitized.push({
      id,
      role,
      parts: parts.map(sanitizeMessagePart).filter((part) => part !== null),
      metadata: isRecord(sanitizedMetadata)
        ? (scrubValue(sanitizedMetadata) as Record<string, unknown>)
        : {},
    });
  }
  return sanitized;
}

function sanitizeMessagePart(part: unknown): unknown {
  if (!isRecord(part)) return null;
  const { type, url } = part;
  if (type === "reasoning") return null;
  if ((type === "file" || type === "image") && typeof url === "string" && isSessionScopedUrl(url)) {
    const { url: _url, ...rest } = part;
    return scrubValue(rest);
  }
  return scrubValue(part);
}

function isSessionScopedUrl(url: string): boolean {
  return url.startsWith("data:") || url.startsWith("blob:");
}

function scrubValue(value: unknown): unknown {
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map(scrubValue);
  if (isRecord(value)) {
    const scrubbed: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) continue;
      scrubbed[key] = scrubValue(entry);
    }
    return scrubbed;
  }
  return value;
}

function scrubString(value: string): string {
  const withoutDataUrls = value.replace(DATA_URL_PATTERN, DATA_URL_PLACEHOLDER);
  if (withoutDataUrls.length >= BASE64_MIN_LENGTH && BASE64_PATTERN.test(withoutDataUrls)) {
    return BASE64_PLACEHOLDER;
  }
  return withoutDataUrls;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
