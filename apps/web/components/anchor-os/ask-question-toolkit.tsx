"use client";

import { defineToolkit } from "@assistant-ui/react";
import type { ToolApprovalResponse, ToolCallMessagePartProps } from "@assistant-ui/react";
import { useState } from "react";

import {
  ElicitationForm,
  type ElicitationField,
} from "@/components/assistant-ui/elements/elicitation-form";

type QuestionOption = {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
};

type AskQuestionArgs = {
  readonly prompt?: string;
  readonly options?: readonly QuestionOption[];
  readonly allowFreeform?: boolean;
};

type QuestionView = {
  readonly prompt: string;
  readonly options: readonly QuestionOption[];
  readonly allowFreeform: boolean;
};

const REJECT_KINDS = new Set(["reject-once", "reject-always"]);

function readQuestion(
  args: AskQuestionArgs,
  approval: ToolCallMessagePartProps["approval"],
): QuestionView {
  const options =
    approval?.options?.map((option) => ({
      id: option.id,
      label: option.label ?? option.id,
      kind: option.kind,
    })) ??
    args.options?.map((option) => ({ ...option, kind: "_custom" })) ??
    [];
  return {
    prompt: approval?.prompt ?? args.prompt ?? "",
    options,
    allowFreeform: approval?.allowFreeform ?? args.allowFreeform ?? options.length === 0,
  };
}

function answeredText(
  question: QuestionView,
  approval: ToolCallMessagePartProps["approval"],
  result: unknown,
): string | null {
  if (approval?.resolution !== undefined) {
    return approval.resolution === "cancelled" ? "Cancelled" : "Expired";
  }
  if (approval?.text) return approval.text;
  if (approval?.optionId) {
    return question.options.find((option) => option.id === approval.optionId)?.label ?? null;
  }
  if (typeof result === "string" && result.trim() !== "") return result;
  if (typeof result === "object" && result !== null) {
    const candidate = result as { text?: unknown; answer?: unknown };
    if (typeof candidate.text === "string") return candidate.text;
    if (typeof candidate.answer === "string") return candidate.answer;
  }
  return null;
}

function AskQuestionCard({
  args,
  approval,
  respondToApproval,
  result,
  status,
}: ToolCallMessagePartProps<AskQuestionArgs, unknown>) {
  const [textValue, setTextValue] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const question = readQuestion(args, approval);
  const isRequest =
    status.type === "requires-action" &&
    approval?.approved === undefined &&
    approval?.resolution === undefined;

  if (!isRequest) {
    const answer = answeredText(question, approval, result);
    if (answer === null) return null;

    return (
      <ElicitationForm
        server="Anchor OS"
        message={question.prompt}
        fields={[{ name: "answer", label: "Answer", value: answer, kind: "text" }]}
        state="accepted"
        settledLabel="Answered"
      />
    );
  }

  if (question.prompt === "") return null;

  const answer = async (response: ToolApprovalResponse) => {
    setError(null);
    try {
      await respondToApproval(response);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  const submit = () => {
    const text = textValue.trim();
    if (text !== "") return void answer({ text });
    if (selectedId !== null) {
      const selected = question.options.find((option) => option.id === selectedId);
      // Custom-kind options (eve's ask_question uses `_` kinds) require an
      // explicit approved value; picking a declared option is an answer.
      const approved = selected !== undefined && !REJECT_KINDS.has(selected.kind);
      return void answer({ optionId: selectedId, approved });
    }
    setError("Pick an option or type an answer first.");
  };

  const labelOf = (id: string) => question.options.find((option) => option.id === id)?.label;
  const fields: ElicitationField[] = [];
  if (question.options.length > 0) {
    fields.push({
      name: "option",
      label: "Choose one",
      value: selectedId !== null ? (labelOf(selectedId) ?? "") : "",
      kind: "choice",
      options: question.options.map((option) => option.label),
    });
  }
  if (question.allowFreeform) {
    fields.push({
      name: "answer",
      label: question.options.length > 0 ? "Or type your own" : "Your answer",
      value: textValue,
      kind: "text",
    });
  }

  return (
    <div className="w-full max-w-sm">
      <ElicitationForm
        server="Anchor OS"
        message={question.prompt}
        fields={fields}
        state="request"
        hideDecline
        onFieldChange={(name, value) => {
          if (name === "option") {
            setSelectedId(question.options.find((option) => option.label === value)?.id ?? null);
            return;
          }
          setTextValue(value);
        }}
        onAccept={submit}
      />
      {error !== null && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

export const askQuestionToolkit = defineToolkit({
  ask_question: {
    type: "backend",
    display: "standalone",
    render: AskQuestionCard,
  },
});

export default askQuestionToolkit;
