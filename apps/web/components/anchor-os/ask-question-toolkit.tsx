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
  readonly kind?: string;
  readonly description?: string;
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
      ...(option.description ? { description: option.description } : {}),
    })) ??
    args.options?.map((option) => ({ ...option, kind: option.kind ?? "_custom" })) ??
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
  if (isRecord(result)) {
    if (typeof result.text === "string") return result.text;
    if (typeof result.answer === "string") return result.answer;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function AskQuestionCard({
  args,
  approval,
  respondToApproval,
  result,
  status,
}: ToolCallMessagePartProps<AskQuestionArgs, unknown>) {
  const [textValue, setTextValue] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
        className="-mx-2 w-auto"
      />
    );
  }

  if (question.prompt === "") return null;

  const answer = async (response: ToolApprovalResponse) => {
    setError(null);
    setSubmitting(true);
    try {
      await respondToApproval(response);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSubmitting(false);
    }
  };

  const submit = () => {
    if (submitting) return;
    const text = textValue.trim();
    if (text !== "") return void answer({ text });
    if (selectedId !== null) {
      const selected = question.options.find((option) => option.id === selectedId);
      // Custom-kind options (eve's ask_question uses `_` kinds) require an
      // explicit approved value; picking a declared option is an answer.
      const approved = selected !== undefined && !REJECT_KINDS.has(selected.kind ?? "_custom");
      return void answer({ optionId: selectedId, approved });
    }
    setError("Pick an option or type an answer first.");
  };

  const fields: ElicitationField[] = [];
  if (question.options.length > 0) {
    fields.push({
      name: "option",
      label: "Choose one",
      value: selectedId ?? "",
      kind: "choice",
      options: question.options.map((option) => ({
        value: option.id,
        label: option.label,
        ...(option.description ? { description: option.description } : {}),
      })),
    });
  }
  if (question.allowFreeform) {
    fields.push({
      name: "answer",
      label: question.options.length > 0 ? "Or type your own" : "Your answer",
      value: textValue,
      kind: "text",
      placeholder: "Type your answer",
    });
  }

  return (
    <div className="-mx-2 w-auto">
      <ElicitationForm
        server="Anchor OS"
        message={question.prompt}
        fields={fields}
        state="request"
        hideDecline
        busy={submitting}
        onFieldChange={(name, value) => {
          setError(null);
          if (name === "option") {
            setSelectedId(question.options.some((option) => option.id === value) ? value : null);
            return;
          }
          setTextValue(value);
        }}
        onAccept={submit}
      />
      {error !== null && (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive mt-2 rounded-xl px-3 py-2 text-sm"
        >
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
