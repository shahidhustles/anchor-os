import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToString } from "react-dom/server";

import { AskQuestionCard } from "./ask-question-toolkit";
import { findLatestTodoSnapshot, TodoPanelView, todoToolkit, type TodoItem } from "./todo-toolkit";

const ACTIVE_TODOS = [
  { content: "Inspect the existing chat UI", priority: "high", status: "completed" },
  { content: "Build the todo panel", priority: "high", status: "in_progress" },
  { content: "Verify the interaction", priority: "medium", status: "pending" },
] satisfies readonly TodoItem[];

test("registers todo as a standalone backend tool UI", () => {
  assert.equal(todoToolkit.todo.type, "backend");
  assert.equal(todoToolkit.todo.display, "standalone");
});

test("uses the newest valid todo result and falls back to streamed arguments", () => {
  const messages = [
    {
      content: [
        {
          type: "tool-call",
          toolName: "todo",
          toolCallId: "first",
          args: { todos: ACTIVE_TODOS.slice(0, 1) },
        },
      ],
    },
    {
      content: [
        {
          type: "tool-call",
          toolName: "agent.tools/todo",
          toolCallId: "latest",
          args: { todos: ACTIVE_TODOS.slice(0, 2) },
          result: { counts: { total: 3 }, todos: ACTIVE_TODOS },
        },
      ],
    },
  ];

  assert.deepEqual(findLatestTodoSnapshot(messages), {
    toolCallId: "latest",
    items: ACTIVE_TODOS,
  });

  assert.deepEqual(
    findLatestTodoSnapshot([
      {
        content: [
          {
            type: "tool-call",
            toolName: "todo",
            toolCallId: "streaming",
            args: { todos: ACTIVE_TODOS.slice(0, 2) },
          },
        ],
      },
    ])?.items,
    ACTIVE_TODOS.slice(0, 2),
  );
});

test("ignores malformed todo updates and preserves the previous valid list", () => {
  const messages = [
    {
      content: [
        {
          type: "tool-call",
          toolName: "todo",
          toolCallId: "valid",
          args: { todos: ACTIVE_TODOS },
        },
      ],
    },
    {
      content: [
        {
          type: "tool-call",
          toolName: "todo",
          toolCallId: "partial",
          args: { todos: [{ content: "Still streaming" }] },
        },
      ],
    },
  ];

  assert.equal(findLatestTodoSnapshot(messages)?.toolCallId, "valid");
  assert.equal(findLatestTodoSnapshot([{ content: [] }]), undefined);
});

test("renders readable expanded and collapsed todo summaries", () => {
  const expanded = renderToString(
    <TodoPanelView items={ACTIVE_TODOS} open onOpenChange={() => undefined} />,
  );
  const collapsed = renderToString(
    <TodoPanelView items={ACTIVE_TODOS} open={false} onOpenChange={() => undefined} />,
  );

  assert.match(expanded, /Tasks/);
  assert.match(expanded.replaceAll("<!-- -->", ""), /1 of 3 finished/);
  assert.match(expanded, /Build the todo panel/);
  assert.match(expanded, /aria-label="Collapse tasks"/);
  assert.match(collapsed, /aria-label="Expand tasks"/);
});

test("renders a full-width question with descriptions and free-form input", () => {
  const html = renderToString(
    <AskQuestionCard
      type="tool-call"
      toolCallId="question-1"
      toolName="ask_question"
      args={{}}
      argsText="{}"
      status={{ type: "requires-action", reason: "tool-calls" }}
      approval={{
        id: "approval-1",
        prompt: "Which deployment should Anchor use?",
        allowFreeform: true,
        options: [
          {
            id: "preview",
            label: "Preview",
            description: "Create an isolated deployment for review.",
            kind: "_custom",
          },
        ],
      }}
      addResult={() => undefined}
      resume={() => undefined}
      respondToApproval={async () => undefined}
    />,
  );

  assert.match(html, /Which deployment should Anchor use\?/);
  assert.match(html, /Create an isolated deployment for review\./);
  assert.match(html, /<textarea/);
  assert.match(html, /Needs your answer/);
  assert.doesNotMatch(html, /&quot;prompt&quot;/);
  assert.doesNotMatch(html, /max-w-sm/);
});

test("formats a settled question as a readable answer", () => {
  const html = renderToString(
    <AskQuestionCard
      type="tool-call"
      toolCallId="question-2"
      toolName="ask_question"
      args={{ prompt: "Where should this ship?" }}
      argsText="{}"
      result={{ answer: "Ship it to preview first." }}
      status={{ type: "complete" }}
      addResult={() => undefined}
      resume={() => undefined}
      respondToApproval={async () => undefined}
    />,
  );

  assert.match(html, /Where should this ship\?/);
  assert.match(html, /Ship it to preview first\./);
  assert.match(html, /Answered/);
  assert.doesNotMatch(html, /\{&quot;answer&quot;/);
});
