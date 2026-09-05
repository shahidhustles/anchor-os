"use client";

import { askQuestionToolkit } from "@/components/anchor-os/ask-question-toolkit";
import { ArtifactWorkspace } from "@/components/anchor-os/artifact-panel";
import { ArtifactsProvider } from "@/components/anchor-os/artifacts-context";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useChatPersistence } from "@/hooks/use-chat-persistence";
import {
  archiveChat,
  createChat,
  listChats,
  loadChat,
  updateChat as persistChat,
  type LoadedChat,
} from "@/lib/chat-client";
import type { ChatThread } from "@/lib/chat-types";
import type { SanitizedChatMessage } from "@/lib/chat-sanitizer";
import { ClientError } from "eve/client";
import { useEveAgentRuntime } from "@assistant-ui/eve";
import {
  AssistantRuntimeProvider,
  AuiConfig,
  Suggestions,
  Tools,
  useAuiState,
} from "@assistant-ui/react";
import { Loader2Icon, MessageSquareIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelOption } from "@/components/assistant-ui/elements/model-selector";
import {
  ANCHOR_MODELS,
  ANCHOR_MODEL_HEADER,
  isAnchorModelId,
  type AnchorModelId,
} from "@anchor-os/agent/model-catalog";

type ChatStatus = "idle" | "running";

type Chat = {
  readonly id: string;
  readonly modelId: AnchorModelId;
  readonly title: string;
  readonly status: ChatStatus;
  readonly hasAcceptedMessage: boolean;
  readonly bindingFailed: boolean;
  readonly persistenceError: string | null;
  readonly archiving: boolean;
  readonly history?: LoadedChat;
};

type LoadState = "loading" | "ready" | "error";

const NEW_CHAT_TITLE = "New chat";
const MAX_TITLE_LENGTH = 50;

const MODEL_OPTIONS: readonly ModelOption[] = ANCHOR_MODELS.map((model) => ({
  id: model.id,
  name: model.label,
}));

function toChat(thread: ChatThread, history?: LoadedChat): Chat {
  return {
    id: thread.id,
    modelId: thread.modelId,
    title: thread.title,
    status: "idle",
    hasAcceptedMessage:
      thread.lastMessageAt !== null ||
      thread.eveSessionId !== null ||
      history?.messages.some((message) => message.role === "user") === true,
    bindingFailed: false,
    persistenceError: null,
    archiving: false,
    ...(history === undefined ? {} : { history }),
  };
}

function titleFromMessage(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_TITLE_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

export function shouldResumeChat(history: LoadedChat | undefined): boolean {
  return history?.thread.eveSessionId != null;
}

export function isReusableDraftChat(chat: {
  readonly hasAcceptedMessage: boolean;
  readonly status: ChatStatus;
}): boolean {
  return chat.status === "idle" && !chat.hasAcceptedMessage;
}

type ProjectedMessage = {
  readonly role: string;
  readonly content: readonly unknown[];
};

export function missingPendingMessages(
  savedMessages: readonly SanitizedChatMessage[],
  projectedMessages: readonly ProjectedMessage[],
): readonly SanitizedChatMessage[] {
  const projectedUserTextCounts = new Map<string, number>();
  for (const message of projectedMessages) {
    if (message.role !== "user") continue;
    const text = visibleMessageText(message.content);
    projectedUserTextCounts.set(text, (projectedUserTextCounts.get(text) ?? 0) + 1);
  }

  return savedMessages.filter((message) => {
    if (message.role !== "user" || !message.id.startsWith("pending-")) return false;
    const text = visibleMessageText(message.parts);
    const projectedCount = projectedUserTextCounts.get(text) ?? 0;
    if (projectedCount === 0) return true;
    projectedUserTextCounts.set(text, projectedCount - 1);
    return false;
  });
}

function visibleMessageText(parts: readonly unknown[]): string {
  return parts
    .flatMap((part) => {
      if (typeof part !== "object" || part === null) return [];
      if (!("type" in part) || typeof part.type !== "string") return [];
      if (part.type === "text" && "text" in part && typeof part.text === "string") {
        return [part.text];
      }
      if (
        (part.type === "file" || part.type === "image") &&
        "filename" in part &&
        typeof part.filename === "string"
      ) {
        return [part.filename];
      }
      return [];
    })
    .join("\n")
    .trim();
}

function PendingMessageRecovery({
  messages,
}: {
  readonly messages: readonly SanitizedChatMessage[];
}) {
  const projectedMessages = useAuiState((state) => state.thread.messages);
  const pendingMessages = missingPendingMessages(messages, projectedMessages);
  if (pendingMessages.length === 0) return null;

  return (
    <div className="mx-4 mt-3 space-y-2" data-slot="pending-message-recovery">
      {pendingMessages.map((message) => (
        <div key={message.id} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-medium text-amber-900">Saved before the agent accepted it</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-amber-950">
            {visibleMessageText(message.parts) || "Message content is unavailable."}
          </p>
        </div>
      ))}
    </div>
  );
}

type RuntimeState = {
  readonly status: ChatStatus;
  readonly hasUserMessage: boolean;
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
      hasUserMessage: firstUserMessage !== undefined,
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
  readonly onBindingSettled: (chatId: string, failed: boolean) => void;
  readonly onPersistenceError: (chatId: string, message: string | null) => void;
};

function ChatPane({
  chat,
  selected,
  registerCancel,
  selectModel,
  updateChat,
  onBindingSettled,
  onPersistenceError,
}: ChatPaneProps) {
  const modelIdRef = useRef(chat.modelId);
  const [resuming, setResuming] = useState(shouldResumeChat(chat.history));
  const [resumeFailed, setResumeFailed] = useState(false);
  modelIdRef.current = chat.modelId;
  const headers = useCallback(() => ({ [ANCHOR_MODEL_HEADER]: modelIdRef.current }), []);
  const handleEveError = useCallback(
    (error: Error) => {
      if (resuming && error instanceof ClientError && error.status === 404) {
        setResuming(false);
        setResumeFailed(true);
      }
    },
    [resuming],
  );
  const { handleSessionChange, retryBinding, prepareSend, handleEvent, handleFinish } =
    useChatPersistence({
      chatId: chat.id,
      onBindingSettled,
      onPersistenceError,
    });
  const handleRuntimeFinish = useCallback(
    (snapshot: Parameters<typeof handleFinish>[0]) => {
      handleFinish(snapshot);
      setResuming(false);
    },
    [handleFinish],
  );
  const runtime = useEveAgentRuntime({
    headers,
    ...(chat.history === undefined
      ? {}
      : {
          initialEvents: chat.history.events,
          ...(chat.history.thread.eveSessionId === null
            ? {}
            : {
                initialSession: {
                  sessionId: chat.history.thread.eveSessionId,
                  streamIndex: chat.history.thread.eveStreamIndex,
                },
                resume: true,
              }),
        }),
    isDisabled: resuming || resumeFailed,
    onError: handleEveError,
    onSessionChange: handleSessionChange,
    prepareSend,
    onEvent: handleEvent,
    onFinish: handleRuntimeFinish,
  });
  const config = useMemo(
    () =>
      AuiConfig({
        tools: Tools({ toolkit: askQuestionToolkit }),
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
              {chat.bindingFailed ? (
                <PaneNotice
                  data-slot="session-binding-error"
                  title="This chat could not save its agent session."
                  description="Sending stays disabled until the session is saved."
                  actionLabel="Retry"
                  onAction={retryBinding}
                />
              ) : (
                <>
                  {chat.history === undefined ? null : (
                    <PendingMessageRecovery messages={chat.history.messages} />
                  )}
                  {resuming ? (
                    <p
                      role="status"
                      className="px-4 pt-3 text-center text-sm text-zinc-500"
                      data-slot="chat-resuming"
                    >
                      Restoring this chat's workspace…
                    </p>
                  ) : null}
                  {resumeFailed ? (
                    <p
                      role="alert"
                      className="mx-4 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                      data-slot="chat-resume-error"
                    >
                      This workspace is unavailable. The saved transcript is still here, but this
                      chat cannot send messages.
                    </p>
                  ) : null}
                  {chat.persistenceError ? (
                    <p
                      role="alert"
                      className="mx-4 mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
                      data-slot="chat-persistence-error"
                    >
                      {chat.persistenceError}
                    </p>
                  ) : null}
                  <Thread
                    autoFocus={selected}
                    modelPicker={{
                      models: MODEL_OPTIONS,
                      value: chat.modelId,
                      onValueChange: (value) => {
                        if (isAnchorModelId(value)) selectModel(chat.id, value);
                      },
                      disabled: chat.status === "running" || resuming || resumeFailed,
                    }}
                  />
                </>
              )}
            </ArtifactWorkspace>
          </div>
        </ArtifactsProvider>
      </AssistantRuntimeProvider>
    </div>
  );
}

type PaneNoticeProps = {
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
  readonly onAction: () => void;
  readonly "data-slot": string;
};

function PaneNotice({
  title,
  description,
  actionLabel,
  onAction,
  "data-slot": dataSlot,
}: PaneNoticeProps) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
      data-slot={dataSlot}
    >
      <p className="text-sm font-medium text-zinc-950">{title}</p>
      <p className="max-w-sm text-sm text-zinc-500">{description}</p>
      <Button type="button" variant="outline" size="sm" onClick={onAction}>
        <RotateCcwIcon className="size-3.5" />
        {actionLabel}
      </Button>
    </div>
  );
}

export default function Home() {
  const [chats, setChats] = useState<readonly Chat[]>([]);
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [creatingChat, setCreatingChat] = useState(false);
  const [createFailed, setCreateFailed] = useState(false);
  const cancelByChatId = useRef(new Map<string, () => void>());
  const initializeStarted = useRef(false);
  const createInFlight = useRef(false);
  const controlSaveChains = useRef(new Map<string, Promise<void>>());
  const [controlSaveError, setControlSaveError] = useState<string | null>(null);

  const enqueueControlSave = useCallback(
    (chatId: string, patch: Parameters<typeof persistChat>[1], message: string) => {
      const previous = controlSaveChains.current.get(chatId) ?? Promise.resolve();
      const next = previous
        .catch(() => undefined)
        .then(() => persistChat(chatId, patch))
        .then(() => undefined)
        .catch(() => {
          setControlSaveError(message);
        });
      controlSaveChains.current.set(chatId, next);
    },
    [],
  );

  const spawnChat = useCallback(() => {
    if (createInFlight.current) return;
    const reusableDraft = chatsRef.current.find(isReusableDraftChat);
    if (reusableDraft !== undefined) {
      setSelectedChatId(reusableDraft.id);
      setCreateFailed(false);
      return;
    }
    createInFlight.current = true;
    setCreatingChat(true);
    void createChat()
      .then((thread) => {
        const chat = toChat(thread);
        setChats((current) => [chat, ...current]);
        setSelectedChatId(chat.id);
        setCreateFailed(false);
      })
      .catch(() => setCreateFailed(true))
      .finally(() => {
        createInFlight.current = false;
        setCreatingChat(false);
      });
  }, []);

  const initialize = useCallback(async () => {
    setLoadState("loading");
    try {
      const threads = await listChats();
      const loadedChats =
        threads.length === 0
          ? [toChat(await createChat())]
          : await Promise.all(threads.map((thread) => loadChat(thread.id))).then((histories) =>
              histories.map((history) => toChat(history.thread, history)),
            );
      setChats(loadedChats);
      setSelectedChatId(loadedChats[0]?.id ?? null);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    if (initializeStarted.current) return;
    initializeStarted.current = true;
    void initialize();
  }, [initialize]);

  const updateChat = useCallback(
    (chatId: string, state: RuntimeState) => {
      const chat = chatsRef.current.find((candidate) => candidate.id === chatId);
      const title =
        chat?.title === NEW_CHAT_TITLE && state.title !== undefined ? state.title : undefined;
      if (title !== undefined) {
        enqueueControlSave(chatId, { title }, "This chat title could not be saved.");
      }
      setChats((current) =>
        current.map((chat) =>
          chat.id !== chatId ||
          (chat.status === state.status &&
            title === undefined &&
            (!state.hasUserMessage || chat.hasAcceptedMessage))
            ? chat
            : {
                ...chat,
                status: state.status,
                hasAcceptedMessage: chat.hasAcceptedMessage || state.hasUserMessage,
                ...(title === undefined ? {} : { title }),
              },
        ),
      );
    },
    [enqueueControlSave],
  );

  const onBindingSettled = useCallback((chatId: string, failed: boolean) => {
    setChats((current) =>
      current.map((chat) => (chat.id === chatId ? { ...chat, bindingFailed: failed } : chat)),
    );
  }, []);

  const onPersistenceError = useCallback((chatId: string, message: string | null) => {
    setChats((current) =>
      current.map((chat) => (chat.id === chatId ? { ...chat, persistenceError: message } : chat)),
    );
  }, []);

  const registerCancel = useCallback((chatId: string, cancel: () => void) => {
    cancelByChatId.current.set(chatId, cancel);
    return () => cancelByChatId.current.delete(chatId);
  }, []);

  const selectModel = useCallback(
    (chatId: string, modelId: AnchorModelId) => {
      const chat = chats.find((candidate) => candidate.id === chatId);
      if (chat === undefined || chat.status !== "idle" || chat.modelId === modelId) return;
      enqueueControlSave(chatId, { modelId }, "This model choice could not be saved.");
      setChats((current) =>
        current.map((chat) =>
          chat.id === chatId && chat.status === "idle" ? { ...chat, modelId } : chat,
        ),
      );
    },
    [chats, enqueueControlSave],
  );

  const deleteChat = useCallback(
    (chatId: string) => {
      if (chats.find((chat) => chat.id === chatId)?.archiving) return;
      setChats((current) =>
        current.map((chat) => (chat.id === chatId ? { ...chat, archiving: true } : chat)),
      );
      void archiveChat(chatId)
        .then(() => {
          cancelByChatId.current.get(chatId)?.();
          const remaining = chats.filter((chat) => chat.id !== chatId);
          setChats(remaining);
          if (chatId !== selectedChatId) return;
          const next = remaining[0];
          if (next !== undefined) {
            setSelectedChatId(next.id);
          } else {
            setSelectedChatId(null);
            spawnChat();
          }
        })
        .catch(() => {
          setChats((current) =>
            current.map((chat) => (chat.id === chatId ? { ...chat, archiving: false } : chat)),
          );
          setControlSaveError("This chat could not be archived.");
        });
    },
    [chats, selectedChatId, spawnChat],
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
              onClick={spawnChat}
              disabled={creatingChat}
              aria-label="New chat"
              title="New chat"
            >
              <PlusIcon className="size-4" />
            </Button>
          </div>

          {createFailed ? (
            <p
              role="alert"
              className="px-4 py-2 text-xs text-red-600"
              data-slot="chat-create-error"
            >
              Could not create the chat. Try again.
            </p>
          ) : null}
          {controlSaveError ? (
            <p role="alert" className="px-4 py-2 text-xs text-red-600" data-slot="chat-save-error">
              {controlSaveError}
            </p>
          ) : null}

          <nav className="flex-1 overflow-y-auto p-2" aria-label="Chats">
            {loadState === "loading" ? (
              <div
                className="flex items-center gap-2 px-2 py-2 text-xs text-zinc-500"
                data-slot="chat-list-loading"
              >
                <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
                Loading chats…
              </div>
            ) : loadState === "error" ? (
              <div className="px-2 py-2" data-slot="chat-list-error">
                <p className="text-xs text-red-600">Chats could not be loaded.</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    initializeStarted.current = false;
                    void initialize();
                  }}
                >
                  <RotateCcwIcon className="size-3.5" />
                  Retry
                </Button>
              </div>
            ) : (
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
                      disabled={chat.archiving}
                      aria-label={`Delete ${chat.title}`}
                      title="Archive chat"
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </nav>
          <p className="border-t border-zinc-200 px-4 py-3 text-xs text-zinc-500">
            Chats are saved and return after reload.
          </p>
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
              onBindingSettled={onBindingSettled}
              onPersistenceError={onPersistenceError}
            />
          ))}
        </section>
      </main>
    </TooltipProvider>
  );
}
