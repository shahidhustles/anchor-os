import { chatErrorResponse, createChatThread, listActiveChatThreads } from "@/lib/chat-store";
import { parseChatRequestBody, parseCreateChatThreadInput } from "@/lib/chat-types";
import { getChatSupabaseClient } from "@/lib/supabase-server";

export async function GET(): Promise<Response> {
  try {
    return Response.json(await listActiveChatThreads(getChatSupabaseClient()));
  } catch (error: unknown) {
    return chatErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const input = parseCreateChatThreadInput(await parseChatRequestBody(request));
    return Response.json(await createChatThread(getChatSupabaseClient(), input), { status: 201 });
  } catch (error: unknown) {
    return chatErrorResponse(error);
  }
}
