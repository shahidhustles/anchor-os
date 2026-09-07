import { describe, expect, test } from "bun:test";

import {
  convertToWhatsAppVoiceNote,
  deliverWhatsAppVoiceOrText,
  prepareWhatsAppVoiceMessage,
} from "./whatsapp-voice";

function silentWav(): Buffer {
  const samples = 800;
  const dataSize = samples * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8_000, 24);
  wav.writeUInt32LE(16_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);
  return wav;
}

describe("WhatsApp voice transcription", () => {
  test("turns a non-empty transcript into Eve text", async () => {
    const result = await prepareWhatsAppVoiceMessage(
      Buffer.from("audio"),
      "audio/ogg",
      async () => "  change a work order priority  ",
    );
    expect(result).toEqual({
      kind: "ready",
      text: "Voice message transcript: change a work order priority",
    });
  });

  test("rejects empty and failed transcripts without creating message text", async () => {
    expect(
      await prepareWhatsAppVoiceMessage(Buffer.from("audio"), "audio/ogg", async () => " "),
    ).toEqual({ kind: "empty" });

    const failure = new Error("provider unavailable");
    expect(
      await prepareWhatsAppVoiceMessage(Buffer.from("audio"), "audio/ogg", async () => {
        throw failure;
      }),
    ).toEqual({ kind: "failed", error: failure });
  });
});

describe("WhatsApp voice replies", () => {
  test("sends converted voice audio when synthesis succeeds", async () => {
    const sent: string[] = [];
    const result = await deliverWhatsAppVoiceOrText({
      text: "Priority changed",
      synthesize: async () => Buffer.from("ogg"),
      sendVoice: async (audio) => {
        sent.push(`voice:${audio.toString()}`);
      },
      sendText: async (text) => {
        sent.push(`text:${text}`);
      },
    });
    expect(result).toEqual({ kind: "voice" });
    expect(sent).toEqual(["voice:ogg"]);
  });

  test("falls back to the same text when synthesis or voice delivery fails", async () => {
    const sent: string[] = [];
    const failure = new Error("conversion failed");
    const result = await deliverWhatsAppVoiceOrText({
      text: "Priority changed",
      synthesize: async () => {
        throw failure;
      },
      sendVoice: async () => undefined,
      sendText: async (text) => {
        sent.push(text);
      },
    });
    expect(result).toEqual({ kind: "text", error: failure });
    expect(sent).toEqual(["Priority changed"]);

    const deliveryFailure = new Error("socket rejected audio");
    const deliveryResult = await deliverWhatsAppVoiceOrText({
      text: "Priority changed again",
      synthesize: async () => Buffer.from("ogg"),
      sendVoice: async () => {
        throw deliveryFailure;
      },
      sendText: async (text) => {
        sent.push(text);
      },
    });
    expect(deliveryResult).toEqual({ kind: "text", error: deliveryFailure });
    expect(sent).toEqual(["Priority changed", "Priority changed again"]);
  });

  test("converts audio to an Ogg Opus voice note", async () => {
    const result = await convertToWhatsAppVoiceNote(silentWav());
    expect(result.subarray(0, 4).toString()).toBe("OggS");
    expect(result.includes(Buffer.from("OpusHead"))).toBe(true);
  });
});
