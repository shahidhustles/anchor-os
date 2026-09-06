import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { ChatDatabase } from "./chat-types";

export type ChatSupabaseClient = ReturnType<typeof createChatSupabaseClient>;

const globalForChatSupabase = globalThis as unknown as {
  chatSupabaseClient?: ChatSupabaseClient;
};

export function getChatSupabaseClient(): ChatSupabaseClient {
  globalForChatSupabase.chatSupabaseClient ??= createChatSupabaseClient();
  return globalForChatSupabase.chatSupabaseClient;
}

function createChatSupabaseClient() {
  return createClient<ChatDatabase>(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SECRET_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: fetchWithoutSecretBearer,
      },
    },
  );
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is missing; set it in apps/web/.env.local for chat persistence`);
  }
  return value.trim();
}

const fetchWithoutSecretBearer: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  if (headers.get("Authorization")?.startsWith("Bearer sb_") === true) {
    headers.delete("Authorization");
  }
  return fetch(input, { ...init, headers });
};
