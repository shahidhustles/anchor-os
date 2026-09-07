import { describe, expect, test } from "bun:test";

import {
  DEFAULT_WHATSAPP_ALLOWED_SENDER,
  DEFAULT_WHATSAPP_RECEIVING_NUMBER,
  WHATSAPP_BROWSER_UNAVAILABLE_MESSAGE,
  canDispatchBrowserTask,
  disconnectStatusCode,
  isAllowedWhatsAppSender,
  isExpectedWhatsAppReceiver,
  isResetCommand,
  normalizePhoneNumber,
  readWhatsAppConfig,
  renderWhatsAppInputRequest,
  shouldDeliverAssistantMessage,
  shouldReconnectWhatsApp,
  splitWhatsAppText,
  whatsappContinuationAddress,
  whatsappUserAuth,
} from "./whatsapp";

describe("WhatsApp startup configuration", () => {
  test("stays disabled unless the opt-in value is exactly 1", () => {
    expect(readWhatsAppConfig({})).toEqual({ enabled: false });
    expect(readWhatsAppConfig({ ANCHOR_WHATSAPP_ENABLED: "true" })).toEqual({ enabled: false });
  });

  test("uses safe demo defaults only after opt-in", () => {
    expect(readWhatsAppConfig({ ANCHOR_WHATSAPP_ENABLED: "1" })).toEqual({
      enabled: true,
      allowedSender: DEFAULT_WHATSAPP_ALLOWED_SENDER,
      authDir: "./auth_info_baileys",
      receivingNumber: DEFAULT_WHATSAPP_RECEIVING_NUMBER,
    });
  });

  test("checks that saved credentials belong to the demo receiving account", () => {
    expect(
      isExpectedWhatsAppReceiver("917276411669@s.whatsapp.net", DEFAULT_WHATSAPP_RECEIVING_NUMBER),
    ).toBe(true);
    expect(
      isExpectedWhatsAppReceiver("919999999999@s.whatsapp.net", DEFAULT_WHATSAPP_RECEIVING_NUMBER),
    ).toBe(false);
  });
});

describe("sender routing", () => {
  test("accepts only the approved phone JID, including LID messages with a phone alternate", () => {
    expect(
      isAllowedWhatsAppSender({ remoteJid: "917028546994@s.whatsapp.net" }, "+91 70285 46994"),
    ).toBe(true);
    expect(
      isAllowedWhatsAppSender(
        {
          remoteJid: "123456789@lid",
          remoteJidAlt: "917028546994@s.whatsapp.net",
        },
        DEFAULT_WHATSAPP_ALLOWED_SENDER,
      ),
    ).toBe(true);
    expect(
      isAllowedWhatsAppSender(
        { remoteJid: "919999999999@s.whatsapp.net" },
        DEFAULT_WHATSAPP_ALLOWED_SENDER,
      ),
    ).toBe(false);
    expect(
      isAllowedWhatsAppSender(
        { remoteJid: "120363123456789@g.us" },
        DEFAULT_WHATSAPP_ALLOWED_SENDER,
      ),
    ).toBe(false);
  });

  test("uses the stable phone JID as the continuation address", () => {
    const key = {
      remoteJid: "123456789@lid",
      remoteJidAlt: "917028546994@s.whatsapp.net",
    };
    expect(whatsappContinuationAddress(key)).toBe("917028546994@s.whatsapp.net");
    expect(whatsappContinuationAddress(key)).toBe(whatsappContinuationAddress(key));
    expect(isResetCommand("  /RESET ")).toBe(true);
    expect(isResetCommand("reset")).toBe(false);
  });

  test("creates a stable browser-enabled user principal", () => {
    expect(whatsappUserAuth("+91 70285 46994")).toEqual({
      attributes: { anchorOsBrowserControl: "on" },
      authenticator: "whatsapp-demo",
      principalId: "whatsapp:917028546994",
      principalType: "user",
    });
    expect(normalizePhoneNumber("+91 70285-46994")).toBe(DEFAULT_WHATSAPP_ALLOWED_SENDER);
  });
});

test("browser preflight admits only the on state", () => {
  expect(canDispatchBrowserTask({ status: "on" })).toBe(true);
  expect(canDispatchBrowserTask({ status: "off" })).toBe(false);
  expect(canDispatchBrowserTask({ status: "starting" })).toBe(false);
  expect(canDispatchBrowserTask({ status: "error", error: "offline" })).toBe(false);
  expect(WHATSAPP_BROWSER_UNAVAILABLE_MESSAGE).toContain("enable Browser control");
});

test("delivery keeps final text and drops tool-call or empty messages", () => {
  expect(shouldDeliverAssistantMessage({ finishReason: "stop", message: "Done" })).toBe(true);
  expect(
    shouldDeliverAssistantMessage({ finishReason: "tool-calls", message: "I will check." }),
  ).toBe(false);
  expect(shouldDeliverAssistantMessage({ finishReason: "stop", message: "   " })).toBe(false);
  expect(shouldDeliverAssistantMessage({ finishReason: "stop", message: null })).toBe(false);
});

test("formats HITL choices and splits oversized final messages", () => {
  expect(
    renderWhatsAppInputRequest({
      prompt: "Choose a priority",
      options: [{ label: "Low" }, { label: "High" }],
    }),
  ).toBe("Choose a priority\n\n1. Low\n2. High\n\nReply with a number.");
  expect(splitWhatsAppText("x".repeat(65_537)).map((part) => part.length)).toEqual([65_536, 1]);
});

test("reconnects recoverable disconnects but not logout or replacement", () => {
  expect(disconnectStatusCode({ output: { statusCode: 401 } })).toBe(401);
  expect(disconnectStatusCode({ data: { statusCode: 428 } })).toBe(428);
  expect(shouldReconnectWhatsApp(500, [401, 440])).toBe(true);
  expect(shouldReconnectWhatsApp(401, [401, 440])).toBe(false);
});
