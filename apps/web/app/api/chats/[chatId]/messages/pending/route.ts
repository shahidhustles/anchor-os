import { sanitizeUserMessage } from "@/lib/chat-sanitizer";
import { chatErrorResponse, createPendingChatMessage } from "@/lib/chat-store";
import { isChatThreadId, parseChatRequestBody, parsePendingMessageBody } from "@/lib/chat-types";
import { getChatSupabaseClient } from "@/lib/supabase-server";

export async function POST(
  request: Request,
  context: RouteContext<"/api/chats/[chatId]/messages/pending">,
): Promise<Response> {
  try {
    const { chatId } = await context.params;
    if (!isChatThreadId(chatId)) return chatNotFound();
    const body = parsePendingMessageBody(await parseChatRequestBody(request));
    const content = sanitizeUserMessage(body.message);
    await createPendingChatMessage(getChatSupabaseClient(), chatId, content);
    return Response.json({ ok: true });
  } catch (error: unknown) {
    return chatErrorResponse(error);
  }
}

function chatNotFound(): Response {
  return Response.json({ error: "chat not found" }, { status: 404 });
}
