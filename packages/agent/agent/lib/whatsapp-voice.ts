import Cartesia from "@cartesia/cartesia-js";
import { DeepgramClient } from "@deepgram/sdk";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const DEEPGRAM_MODEL = "nova-3";
const CARTESIA_MODEL = "sonic-3";

export const WHATSAPP_VOICE_TRANSCRIPTION_FAILURE_MESSAGE =
  "I could not transcribe that voice note. Please resend the instruction as text.";

type VoiceEnvironment = Readonly<Record<string, string | undefined>>;

export type PreparedVoiceMessage =
  | { readonly kind: "ready"; readonly text: string }
  | { readonly kind: "empty" }
  | { readonly kind: "failed"; readonly error: unknown };

type VoiceTranscriber = (audio: Buffer, mediaType: string) => Promise<string>;

type VoiceDelivery =
  | { readonly kind: "voice" }
  | { readonly kind: "text"; readonly error: unknown };

function requiredVoiceSetting(
  env: VoiceEnvironment,
  name: "CARTESIA_API_KEY" | "CARTESIA_VOICE_ID" | "DEEPGRAM_API_KEY",
): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for WhatsApp voice support`);
  return value;
}

export async function transcribeWhatsAppVoiceNote(
  audio: Buffer,
  mediaType: string,
  env: VoiceEnvironment = process.env,
): Promise<string> {
  const client = new DeepgramClient({
    apiKey: requiredVoiceSetting(env, "DEEPGRAM_API_KEY"),
  });
  const response = await client.listen.v1.media.transcribeFile(
    { data: audio, contentType: mediaType },
    { model: DEEPGRAM_MODEL, punctuate: true, smart_format: true },
  );
  if (!("results" in response)) return "";
  return response.results.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
}

export async function prepareWhatsAppVoiceMessage(
  audio: Buffer,
  mediaType: string,
  transcribe: VoiceTranscriber = transcribeWhatsAppVoiceNote,
): Promise<PreparedVoiceMessage> {
  try {
    const transcript = (await transcribe(audio, mediaType)).trim();
    return transcript === ""
      ? { kind: "empty" }
      : { kind: "ready", text: `Voice message transcript: ${transcript}` };
  } catch (error) {
    return { kind: "failed", error };
  }
}

async function findFfmpegExecutable(): Promise<string> {
  const candidates = [
    resolve(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
    ffmpegPath,
  ];
  for (const candidate of candidates) {
    if (candidate === null) continue;
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error("ffmpeg-static did not provide an executable for this platform");
}

export async function convertToWhatsAppVoiceNote(
  sourceAudio: Buffer,
  executable?: string,
): Promise<Buffer> {
  const ffmpeg = executable ?? (await findFfmpegExecutable());
  return new Promise((resolveConversion, rejectConversion) => {
    const process = spawn(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-vn",
        "-avoid_negative_ts",
        "make_zero",
        "-ac",
        "1",
        "-c:a",
        "libopus",
        "-b:a",
        "32k",
        "-f",
        "ogg",
        "pipe:1",
      ],
      { stdio: "pipe" },
    );
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    process.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    process.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    process.once("error", rejectConversion);
    process.once("close", (code) => {
      if (code === 0) {
        resolveConversion(Buffer.concat(output));
        return;
      }
      rejectConversion(
        new Error(`ffmpeg exited with code ${code}: ${Buffer.concat(errors).toString().trim()}`),
      );
    });
    process.stdin.end(sourceAudio);
  });
}

export async function synthesizeWhatsAppVoiceNote(
  text: string,
  env: VoiceEnvironment = process.env,
): Promise<Buffer> {
  const client = new Cartesia({ apiKey: requiredVoiceSetting(env, "CARTESIA_API_KEY") });
  const response = await client.tts.generate({
    language: "en",
    model_id: CARTESIA_MODEL,
    output_format: { bit_rate: 128_000, container: "mp3", sample_rate: 44_100 },
    transcript: text,
    voice: { id: requiredVoiceSetting(env, "CARTESIA_VOICE_ID") },
  });
  return convertToWhatsAppVoiceNote(Buffer.from(await response.arrayBuffer()));
}

export async function deliverWhatsAppVoiceOrText(input: {
  readonly text: string;
  readonly synthesize?: (text: string) => Promise<Buffer>;
  readonly sendVoice: (audio: Buffer) => Promise<void>;
  readonly sendText: (text: string) => Promise<void>;
}): Promise<VoiceDelivery> {
  try {
    const audio = await (input.synthesize ?? synthesizeWhatsAppVoiceNote)(input.text);
    await input.sendVoice(audio);
    return { kind: "voice" };
  } catch (error) {
    await input.sendText(input.text);
    return { kind: "text", error };
  }
}
