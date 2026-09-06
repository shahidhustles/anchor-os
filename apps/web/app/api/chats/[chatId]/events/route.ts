import { sanitizeStreamEvent } from "@/lib/chat-sanitizer";
import { chatErrorResponse, insertChatEvents } from "@/lib/chat-store";
import { isChatThreadId, parseChatEventBatchBody, parseChatRequestBody } from "@/lib/chat-types";
import { getChatSupabaseClient } from "@/lib/supabase-server";

export async function POST(
  request: Request,
  context: RouteContext<"/api/chats/[chatId]/events">,
): Promise<Response> {
  try {
    const { chatId } = await context.params;
    if (!isChatThreadId(chatId)) return chatNotFound();
    const body = parseChatEventBatchBody(await parseChatRequestBody(request));
    const events = body.events.map(sanitizeStreamEvent).filter((event) => event !== null);
    await insertChatEvents(getChatSupabaseClient(), chatId, body.sessionId, events);
    return Response.json({ ok: true });
  } catch (error: unknown) {
    return chatErrorResponse(error);
  }
}

function chatNotFound(): Response {
  return Response.json({ error: "chat not found" }, { status: 404 });
}
