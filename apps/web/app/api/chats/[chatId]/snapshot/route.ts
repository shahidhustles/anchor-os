import { sanitizeChatMessages, sanitizeStreamEvent } from "@/lib/chat-sanitizer";
import { chatErrorResponse, saveChatTurnSnapshot } from "@/lib/chat-store";
import { isChatThreadId, parseChatRequestBody, parseChatSnapshotBody } from "@/lib/chat-types";
import { getChatSupabaseClient } from "@/lib/supabase-server";

export async function POST(
  request: Request,
  context: RouteContext<"/api/chats/[chatId]/snapshot">,
): Promise<Response> {
  try {
    const { chatId } = await context.params;
    if (!isChatThreadId(chatId)) return chatNotFound();
    const body = parseChatSnapshotBody(await parseChatRequestBody(request));
    const events = body.events.flatMap((event, index) => {
      const sanitized = sanitizeStreamEvent(event);
      return sanitized === null ? [] : [{ ...sanitized, streamIndex: index }];
    });
    const messages = sanitizeChatMessages(body.messages);
    await saveChatTurnSnapshot(getChatSupabaseClient(), chatId, {
      session: body.session,
      events,
      messages,
    });
    return Response.json({ ok: true });
  } catch (error: unknown) {
    return chatErrorResponse(error);
  }
}

function chatNotFound(): Response {
  return Response.json({ error: "chat not found" }, { status: 404 });
}
