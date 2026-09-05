"use client";

import { ArtifactWorkspace } from "@/components/anchor-os/artifact-panel";
import { ArtifactsProvider } from "@/components/anchor-os/artifacts-context";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEveAgentRuntime } from "@assistant-ui/eve";
import { AssistantRuntimeProvider, AuiConfig, Suggestions, useAuiState } from "@assistant-ui/react";
import { MessageSquareIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelOption } from "@/components/assistant-ui/elements/model-selector";
import {
  ANCHOR_MODELS,
  ANCHOR_MODEL_HEADER,
  DEFAULT_ANCHOR_MODEL_ID,
  isAnchorModelId,
  type AnchorModelId,
} from "@anchor-os/agent/model-catalog";

type ChatStatus = "idle" | "running";

type Chat = {
  readonly id: string;
  readonly modelId: AnchorModelId;
  readonly title: string;
  readonly status: ChatStatus;
};

const NEW_CHAT_TITLE = "New chat";
const MAX_TITLE_LENGTH = 50;
const INITIAL_CHAT_ID = "initial-chat";

const MODEL_OPTIONS: readonly ModelOption[] = ANCHOR_MODELS.map((model) => ({
  id: model.id,
  name: model.label,
}));

function createChat(id = crypto.randomUUID()): Chat {
  return {
    id,
    modelId: DEFAULT_ANCHOR_MODEL_ID,
    title: NEW_CHAT_TITLE,
    status: "idle",
  };
}

function titleFromMessage(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_TITLE_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

type RuntimeState = {
  readonly status: ChatStatus;
  readonly title?: string;
};

function RuntimeObserver({
  onStateChange,
}: {
  readonly onStateChange: (state: RuntimeState) => void;
}) {
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const firstUserMessage = useAuiState((state) =>
    state.thread.messages.find((message) => message.role === "user"),
  );
  const firstUserText = firstUserMessage?.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ");

  useEffect(() => {
    onStateChange({
      status: isRunning ? "running" : "idle",
      ...(firstUserText ? { title: titleFromMessage(firstUserText) } : {}),
    });
  }, [firstUserText, isRunning, onStateChange]);

  return null;
}

type ChatPaneProps = {
  readonly chat: Chat;
  readonly selected: boolean;
  readonly registerCancel: (chatId: string, cancel: () => void) => () => void;
  readonly selectModel: (chatId: string, modelId: AnchorModelId) => void;
  readonly updateChat: (chatId: string, state: RuntimeState) => void;
};

function ChatPane({ chat, selected, registerCancel, selectModel, updateChat }: ChatPaneProps) {
  const modelIdRef = useRef(chat.modelId);
  modelIdRef.current = chat.modelId;
  const headers = useCallback(() => ({ [ANCHOR_MODEL_HEADER]: modelIdRef.current }), []);
  const runtime = useEveAgentRuntime({ headers });
  const config = useMemo(
    () =>
      AuiConfig({
        suggestions: Suggestions([
          {
            title: "Explore this workspace",
            label: "and explain what you find",
            prompt: "Explore this workspace and explain its structure.",
          },
          {
            title: "Help me build",
            label: "a feature in this project",
            prompt: "Help me plan and build a feature in this project.",
          },
        ]),
      }),
    [],
  );
  const onStateChange = useCallback(
    (state: RuntimeState) => updateChat(chat.id, state),
    [chat.id, updateChat],
  );

  useEffect(
    () => registerCancel(chat.id, () => runtime.thread.cancelRun()),
    [chat.id, registerCancel, runtime],
  );

  return (
    <div className={selected ? "h-full" : "hidden"} aria-hidden={!selected}>
      <AssistantRuntimeProvider runtime={runtime} config={config}>
        <ArtifactsProvider>
          <RuntimeObserver onStateChange={onStateChange} />
          <div className="h-full">
            <ArtifactWorkspace>
              <Thread
                autoFocus={selected}
                modelPicker={{
                  models: MODEL_OPTIONS,
                  value: chat.modelId,
                  onValueChange: (value) => {
                    if (isAnchorModelId(value)) selectModel(chat.id, value);
                  },
                  disabled: chat.status === "running",
                }}
              />
            </ArtifactWorkspace>
          </div>
        </ArtifactsProvider>
      </AssistantRuntimeProvider>
    </div>
  );
}

export default function Home() {
  const [chats, setChats] = useState<Chat[]>(() => [createChat(INITIAL_CHAT_ID)]);
  const [selectedChatId, setSelectedChatId] = useState(() => chats[0]!.id);
  const cancelByChatId = useRef(new Map<string, () => void>());

  const updateChat = useCallback((chatId: string, state: RuntimeState) => {
    setChats((current) =>
      current.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              status: state.status,
              title: chat.title === NEW_CHAT_TITLE && state.title ? state.title : chat.title,
            }
          : chat,
      ),
    );
  }, []);

  const registerCancel = useCallback((chatId: string, cancel: () => void) => {
    cancelByChatId.current.set(chatId, cancel);
    return () => cancelByChatId.current.delete(chatId);
  }, []);

  const addChat = useCallback(() => {
    const chat = createChat();
    setChats((current) => [chat, ...current]);
    setSelectedChatId(chat.id);
  }, []);

  const selectModel = useCallback((chatId: string, modelId: AnchorModelId) => {
    setChats((current) =>
      current.map((chat) =>
        chat.id === chatId && chat.status === "idle" ? { ...chat, modelId } : chat,
      ),
    );
  }, []);

  const deleteChat = useCallback(
    (chatId: string) => {
      cancelByChatId.current.get(chatId)?.();
      const remaining = chats.filter((chat) => chat.id !== chatId);
      const nextChats = remaining.length > 0 ? remaining : [createChat()];

      setChats(nextChats);
      if (chatId === selectedChatId) setSelectedChatId(nextChats[0]!.id);
    },
    [chats, selectedChatId],
  );

  return (
    <TooltipProvider>
      <main className="flex h-dvh overflow-hidden bg-white text-zinc-950">
        <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50/80">
          <div className="flex h-14 items-center justify-between border-b border-zinc-200 px-3">
            <div className="flex items-center gap-2 px-2 text-sm font-semibold">
              <span className="flex size-7 items-center justify-center rounded-lg bg-zinc-950 text-xs font-bold text-white">
                A
              </span>
              Anchor OS
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={addChat}
              aria-label="New chat"
              title="New chat"
            >
              <PlusIcon className="size-4" />
            </Button>
          </div>

          <nav className="flex-1 overflow-y-auto p-2" aria-label="Chats">
            <p className="px-2 py-2 text-xs font-medium text-zinc-500">Chats</p>
            <div className="space-y-1">
              {chats.map((chat) => (
                <div
                  key={chat.id}
                  className={`group flex items-center rounded-lg ${
                    selectedChatId === chat.id ? "bg-zinc-200/70" : "hover:bg-zinc-100"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedChatId(chat.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-sm"
                    aria-current={selectedChatId === chat.id ? "page" : undefined}
                  >
                    {chat.status === "running" ? (
                      <span
                        className="size-2 shrink-0 animate-pulse rounded-full bg-emerald-500"
                        aria-label="Working"
                      />
                    ) : (
                      <MessageSquareIcon className="size-4 shrink-0 text-zinc-500" />
                    )}
                    <span className="truncate">{chat.title}</span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mr-1 size-7 shrink-0 text-zinc-500 opacity-0 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                    onClick={() => deleteChat(chat.id)}
                    aria-label={`Delete ${chat.title}`}
                    title="Delete chat"
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </nav>

          <div className="border-t border-zinc-200 px-4 py-3 text-xs text-zinc-500">
            Chats reset when this app reloads.
          </div>
        </aside>

        <section className="min-w-0 flex-1 bg-white">
          {chats.map((chat) => (
            <ChatPane
              key={chat.id}
              chat={chat}
              selected={selectedChatId === chat.id}
              registerCancel={registerCancel}
              selectModel={selectModel}
              updateChat={updateChat}
            />
          ))}
        </section>
      </main>
    </TooltipProvider>
  );
}
