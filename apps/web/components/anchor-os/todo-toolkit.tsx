"use client";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { defineToolkit, type ToolCallMessagePartProps, useAuiState } from "@assistant-ui/react";
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleIcon,
  CircleXIcon,
  ListTodoIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type TodoPriority = "high" | "medium" | "low";

export type TodoItem = {
  readonly content: string;
  readonly priority: TodoPriority;
  readonly status: TodoStatus;
};

export type TodoSnapshot = {
  readonly toolCallId: string;
  readonly items: readonly TodoItem[];
};

type TodoMessageLike = {
  readonly content: readonly unknown[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTodoStatus(value: unknown): value is TodoStatus {
  return (
    value === "pending" || value === "in_progress" || value === "completed" || value === "cancelled"
  );
}

function isTodoPriority(value: unknown): value is TodoPriority {
  return value === "high" || value === "medium" || value === "low";
}

function readTodoItems(value: unknown): readonly TodoItem[] | undefined {
  if (!isRecord(value) || !("todos" in value) || !Array.isArray(value.todos)) return undefined;

  const items: TodoItem[] = [];
  for (const candidate of value.todos) {
    if (!isRecord(candidate)) return undefined;
    const { content, priority, status } = candidate;
    if (typeof content !== "string" || !isTodoPriority(priority) || !isTodoStatus(status)) {
      return undefined;
    }
    items.push({ content, priority, status });
  }
  return items;
}

function isTodoToolName(toolName: string): boolean {
  return toolName.split(/[.:/]/u).at(-1) === "todo";
}

export function findLatestTodoSnapshot(
  messages: readonly TodoMessageLike[],
): TodoSnapshot | undefined {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const content = messages[messageIndex]?.content ?? [];
    for (let partIndex = content.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = content[partIndex];
      if (
        !isRecord(part) ||
        part.type !== "tool-call" ||
        typeof part.toolName !== "string" ||
        !isTodoToolName(part.toolName) ||
        typeof part.toolCallId !== "string"
      ) {
        continue;
      }

      const items = readTodoItems(part.result) ?? readTodoItems(part.args);
      if (items !== undefined) return { toolCallId: part.toolCallId, items };
    }
  }
  return undefined;
}

export function todoSnapshotKey(messages: readonly TodoMessageLike[]): string {
  const snapshot = findLatestTodoSnapshot(messages);
  return snapshot === undefined ? "" : JSON.stringify(snapshot);
}

function parseTodoSnapshotKey(key: string): TodoSnapshot | undefined {
  if (key === "") return undefined;
  try {
    const value: unknown = JSON.parse(key);
    if (!isRecord(value) || typeof value.toolCallId !== "string") return undefined;
    const items = readTodoItems({ todos: value.items });
    return items === undefined ? undefined : { toolCallId: value.toolCallId, items };
  } catch {
    return undefined;
  }
}

function TodoStatusIcon({ status }: { readonly status: TodoStatus }) {
  switch (status) {
    case "completed":
      return <CheckCircle2Icon className="text-ok size-4 shrink-0" />;
    case "cancelled":
      return <CircleXIcon className="text-muted-foreground size-4 shrink-0" />;
    case "in_progress":
      return (
        <LoaderCircleIcon className="text-foreground size-4 shrink-0 animate-spin motion-reduce:animate-none" />
      );
    case "pending":
      return <CircleIcon className="text-muted-foreground size-4 shrink-0" />;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function TodoPanelView({
  items,
  open,
  onOpenChange,
}: {
  readonly items: readonly TodoItem[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const finishedCount = items.filter(
    (item) => item.status === "completed" || item.status === "cancelled",
  ).length;

  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="border-border/60 bg-card w-full overflow-hidden rounded-2xl border"
      data-slot="todo-panel"
    >
      <CollapsibleTrigger
        className="hover:bg-foreground/[0.03] focus-visible:ring-foreground/20 flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset"
        aria-label={open ? "Collapse tasks" : "Expand tasks"}
      >
        <span className="bg-foreground/[0.05] flex size-8 shrink-0 items-center justify-center rounded-lg">
          <ListTodoIcon className="text-foreground/70 size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Tasks</span>
          <span className="text-muted-foreground block text-xs" aria-live="polite">
            {finishedCount} of {items.length} finished
          </span>
        </span>
        {open ? (
          <ChevronDownIcon className="text-muted-foreground size-4 shrink-0" />
        ) : (
          <ChevronUpIcon className="text-muted-foreground size-4 shrink-0" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="data-closed:animate-collapsible-up data-open:animate-collapsible-down overflow-hidden motion-reduce:animate-none">
        <ol
          className="border-border/60 flex flex-col gap-2.5 border-t px-4 py-3"
          aria-label="Task list"
        >
          {items.map((item, index) => (
            <li key={`${index}-${item.content}`} className="flex items-start gap-2.5">
              <TodoStatusIcon status={item.status} />
              <span
                className={cn(
                  "text-sm leading-5",
                  item.status === "pending" && "text-muted-foreground",
                  item.status === "completed" && "text-muted-foreground line-through",
                  item.status === "cancelled" && "text-muted-foreground line-through",
                )}
              >
                {item.content}
              </span>
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function TodoPanel() {
  const snapshotKey = useAuiState((state) => todoSnapshotKey(state.thread.messages));
  const snapshot = parseTodoSnapshotKey(snapshotKey);
  const items = snapshot?.items ?? [];
  const hasItems = items.length > 0;
  const hasActiveItems = items.some(
    (item) => item.status === "pending" || item.status === "in_progress",
  );
  const [open, setOpen] = useState(true);
  const previousHasItems = useRef(false);
  const previousHadActiveItems = useRef(false);

  useEffect(() => {
    if (
      (hasItems && !previousHasItems.current) ||
      (hasActiveItems && !previousHadActiveItems.current)
    ) {
      setOpen(true);
    }
    previousHasItems.current = hasItems;
    previousHadActiveItems.current = hasActiveItems;
  }, [hasActiveItems, hasItems]);

  if (!hasItems) return null;
  return <TodoPanelView items={items} open={open} onOpenChange={setOpen} />;
}

function HideTodoTranscript(_props: ToolCallMessagePartProps) {
  return null;
}

export const todoToolkit = defineToolkit({
  todo: {
    type: "backend",
    display: "standalone",
    render: HideTodoTranscript,
  },
});

export default todoToolkit;
