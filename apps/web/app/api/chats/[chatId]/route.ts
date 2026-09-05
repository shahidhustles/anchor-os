import { chatErrorResponse, getChatThread, updateChatThread } from "@/lib/chat-store";
import { isChatThreadId, parseChatRequestBody, parseChatThreadPatch } from "@/lib/chat-types";
import { getChatSupabaseClient } from "@/lib/supabase-server";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/chats/[chatId]">,
): Promise<Response> {
  try {
    const { chatId } = await context.params;
    if (!isChatThreadId(chatId)) return chatNotFound();
    const thread = await getChatThread(getChatSupabaseClient(), chatId);
    return thread === null ? chatNotFound() : Response.json(thread);
  } catch (error: unknown) {
    return chatErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/chats/[chatId]">,
): Promise<Response> {
  try {
    const { chatId } = await context.params;
    if (!isChatThreadId(chatId)) return chatNotFound();
    const patch = parseChatThreadPatch(await parseChatRequestBody(request));
    const thread = await updateChatThread(getChatSupabaseClient(), chatId, patch);
    return thread === null ? chatNotFound() : Response.json(thread);
  } catch (error: unknown) {
    return chatErrorResponse(error);
  }
}

function chatNotFound(): Response {
  return Response.json({ error: "chat not found" }, { status: 404 });
}
