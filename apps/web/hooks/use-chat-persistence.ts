"use client";

import { useCallback, useRef } from "react";
import type { MessageStreamEvent } from "eve/client";
import type { EveMessageData, PrepareSend, UseEveAgentSnapshot } from "eve/react";
import {
  saveChatEvents,
  saveChatSession,
  saveChatSnapshot,
  savePendingChatMessage,
} from "@/lib/chat-client";
import {
  sanitizeChatMessages,
  sanitizeStreamEvent,
  sanitizeUserMessage,
  type SanitizedStreamEvent,
} from "@/lib/chat-sanitizer";
import type { ChatSessionCursor } from "@/lib/chat-types";

type UseChatPersistenceOptions = {
  readonly chatId: string;
  readonly onBindingSettled: (chatId: string, failed: boolean) => void;
  readonly onPersistenceError: (chatId: string, message: string | null) => void;
};

export function useChatPersistence(options: UseChatPersistenceOptions) {
  const { chatId } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const lastAttempted = useRef<ChatSessionCursor | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const eventQueue = useRef<SanitizedStreamEvent[]>([]);
  const flushChain = useRef<Promise<void>>(Promise.resolve());
  const cursorWriteChain = useRef<Promise<void>>(Promise.resolve());

  const persist = useCallback(
    (session: ChatSessionCursor) => {
      const next = cursorWriteChain.current
        .catch(() => undefined)
        .then(async () => {
          try {
            await saveChatSession(chatId, session);
            optionsRef.current.onBindingSettled(chatId, false);
            optionsRef.current.onPersistenceError(chatId, null);
          } catch {
            optionsRef.current.onBindingSettled(chatId, true);
            optionsRef.current.onPersistenceError(
              chatId,
              "This chat's session cursor could not be saved.",
            );
          }
        });
      cursorWriteChain.current = next;
      return next;
    },
    [chatId],
  );

  const flushQueuedEvents = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    const chat = optionsRef.current.chatId;
    if (sessionId === null || eventQueue.current.length === 0) return;
    const batch = eventQueue.current;
    eventQueue.current = [];
    try {
      await saveChatEvents(chat, sessionId, batch);
      optionsRef.current.onPersistenceError(chat, null);
    } catch {
      eventQueue.current = [...batch, ...eventQueue.current];
      optionsRef.current.onPersistenceError(
        chat,
        "New chat events could not be saved. They will be recovered when this workspace resumes.",
      );
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    flushChain.current = flushChain.current.then(flushQueuedEvents).catch(() => undefined);
  }, [flushQueuedEvents]);

  const handleSessionChange = useCallback(
    (session: ChatSessionCursor | undefined) => {
      if (session === undefined) return;
      sessionIdRef.current = session.sessionId;
      scheduleFlush();
      const last = lastAttempted.current;
      if (
        last !== null &&
        last.sessionId === session.sessionId &&
        last.streamIndex >= session.streamIndex
      ) {
        return;
      }
      lastAttempted.current = session;
      void persist(session);
    },
    [persist, scheduleFlush],
  );

  const handleEvent = useCallback(
    (event: MessageStreamEvent) => {
      const sanitized = sanitizeStreamEvent(event);
      if (sanitized === null) return;
      eventQueue.current.push(sanitized);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const prepareSend = useCallback<PrepareSend>(async (payload) => {
    if (payload.message !== undefined) {
      await savePendingChatMessage(optionsRef.current.chatId, sanitizeUserMessage(payload.message));
    }
    return payload;
  }, []);

  const handleFinish = useCallback((snapshot: UseEveAgentSnapshot<EveMessageData>) => {
    const session = snapshot.session;
    if (session === undefined) return;
    const chat = optionsRef.current.chatId;
    flushChain.current = flushChain.current
      .then(async () => {
        try {
          await saveChatSnapshot(chat, {
            session: { sessionId: session.sessionId, streamIndex: session.streamIndex },
            events: snapshot.events,
            messages: sanitizeChatMessages(snapshot.data.messages),
          });
          optionsRef.current.onPersistenceError(chat, null);
        } catch {
          optionsRef.current.onPersistenceError(
            chat,
            "This chat's final transcript could not be saved. It will be repaired when this workspace resumes.",
          );
        }
      })
      .catch(() => undefined);
  }, []);

  const retryBinding = useCallback(() => {
    const session = lastAttempted.current;
    if (session !== null) void persist(session);
  }, [persist]);

  return { handleSessionChange, retryBinding, prepareSend, handleEvent, handleFinish };
}
