"use client";

import type { ComponentProps } from "react";
import { CheckIcon, MessageCircleQuestionIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { field, inkButton, paper } from "@/lib/surfaces";

export type ElicitationState = "request" | "accepted" | "declined";

type ElicitationFieldBase = {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly required?: boolean;
};

export type ElicitationChoice = {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
};

export type ElicitationField =
  | (ElicitationFieldBase & {
      readonly kind: "text";
      readonly placeholder?: string;
    })
  | (ElicitationFieldBase & {
      readonly kind: "choice";
      readonly options: readonly ElicitationChoice[];
    })
  | (ElicitationFieldBase & {
      readonly kind: "toggle";
    });

export function ElicitationForm({
  server,
  message,
  fields,
  state,
  onAccept,
  onDecline,
  onFieldChange,
  hideDecline = false,
  settledLabel,
  busy = false,
  className,
  ...props
}: Omit<
  ComponentProps<"div">,
  "children" | "server" | "message" | "fields" | "state" | "onAccept" | "onDecline"
> & {
  server: string;
  message: string;
  fields: readonly ElicitationField[];
  state: ElicitationState;
  onAccept?: () => void;
  onDecline?: () => void;
  /** Presence makes choice pills selectable and text fields editable. */
  onFieldChange?: (name: string, value: string) => void;
  hideDecline?: boolean;
  /** Overrides the settled "Sent to {server}" line. */
  settledLabel?: string;
  busy?: boolean;
}) {
  return (
    <div
      data-slot="elicitation-form"
      className={cn(paper, "flex w-full flex-col gap-4 rounded-2xl p-4", className)}
      {...props}
    >
      <div className="flex items-center gap-2.5">
        <span className="bg-foreground/[0.05] text-foreground/45 flex size-7 shrink-0 items-center justify-center rounded-lg">
          <MessageCircleQuestionIcon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{server}</span>
        {state === "request" ? (
          <span className="text-muted-foreground shrink-0 text-xs">Needs your answer</span>
        ) : null}
      </div>

      <p className="text-foreground text-base leading-6 font-medium whitespace-pre-wrap">
        {message}
      </p>

      <div className="flex flex-col gap-3">
        {fields.map((item) => (
          <div key={item.name} className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs font-medium">
              {item.label}
              {item.required ? <span aria-hidden> *</span> : null}
            </span>
            {item.kind === "choice" ? (
              <div className="flex flex-col gap-2">
                {item.options.map((option) => {
                  const selected = option.value === item.value;
                  const content = (
                    <>
                      <span className="text-sm font-medium">{option.label}</span>
                      {option.description ? (
                        <span
                          className={cn(
                            "text-xs leading-5",
                            selected ? "text-background/75" : "text-muted-foreground",
                          )}
                        >
                          {option.description}
                        </span>
                      ) : null}
                    </>
                  );
                  return onFieldChange ? (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => onFieldChange(item.name, option.value)}
                      aria-pressed={selected}
                      disabled={busy}
                      className={cn(
                        "focus-visible:ring-foreground/20 flex w-full flex-col items-start rounded-xl px-3 py-2.5 text-left outline-none transition-[background-color,color,scale] focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60",
                        selected
                          ? "bg-foreground text-background"
                          : cn(field, "text-foreground hover:bg-foreground/[0.07]"),
                        "active:scale-[0.99]",
                      )}
                    >
                      {content}
                    </button>
                  ) : (
                    <div
                      key={option.value}
                      className={cn(
                        field,
                        "text-foreground flex flex-col items-start rounded-xl px-3 py-2.5",
                      )}
                    >
                      {content}
                    </div>
                  );
                })}
              </div>
            ) : item.kind === "toggle" ? (
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    "flex h-4 w-7 items-center rounded-full p-0.5 transition-colors duration-200",
                    item.value === "true" ? "bg-foreground/80" : "bg-foreground/15",
                  )}
                >
                  <span
                    className={cn(
                      "bg-background size-3 rounded-full transition-transform duration-200 motion-reduce:transition-none",
                      item.value === "true" && "translate-x-3",
                    )}
                  />
                </span>
                <span className="text-foreground/55 text-xs">
                  {item.value === "true" ? "On" : "Off"}
                </span>
              </span>
            ) : onFieldChange ? (
              <Textarea
                className={cn(
                  field,
                  "text-foreground placeholder:text-muted-foreground min-h-24 resize-y rounded-xl border-0 px-3 py-2.5 text-sm leading-5 shadow-none outline-none focus-visible:ring-2",
                )}
                value={item.value}
                onChange={(event) => onFieldChange(item.name, event.target.value)}
                aria-label={item.label}
                placeholder={item.placeholder}
                disabled={busy}
              />
            ) : (
              <span
                className={cn(
                  field,
                  "text-foreground rounded-xl px-3 py-2.5 text-sm leading-5 whitespace-pre-wrap",
                )}
              >
                {item.value}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="flex h-8 items-center justify-end gap-2">
        {state === "request" ? (
          <>
            {hideDecline ? null : (
              <button
                type="button"
                onClick={onDecline}
                disabled={busy}
                className="text-foreground/55 hover:bg-foreground/[0.06] hover:text-foreground/90 h-8 rounded-full px-3.5 text-xs font-medium transition-[background-color,color,scale] duration-150 active:scale-[0.96]"
              >
                Decline
              </button>
            )}
            <button
              type="button"
              onClick={onAccept}
              disabled={busy}
              className={cn(
                inkButton,
                "flex h-8 items-center rounded-full px-3.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60",
              )}
            >
              {busy ? "Sending..." : "Send"}
            </button>
          </>
        ) : (
          <span
            key={state}
            className="fade-in animate-in text-foreground/55 flex items-center gap-2 text-xs duration-300"
          >
            {state === "accepted" ? (
              <>
                <CheckIcon className="size-3.5 text-emerald-500" />
                {settledLabel ?? `Sent to ${server}`}
              </>
            ) : (
              <>
                <XIcon className="text-foreground/45 size-3.5" />
                Declined
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
