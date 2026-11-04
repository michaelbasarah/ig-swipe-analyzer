/**
 * Gemini does the watching. Slides ride inline; a reel's video goes through the Files API (a 20 MB
 * base64 blob would blow the request limit), is analysed as native video, then deleted.
 *
 * The client is created lazily and is injectable, so tests never need a key or the network.
 */
import { readFileSync } from "node:fs";
import { videoGuard } from "./ig.mjs";
import { log } from "./env.mjs";

const RUBRIC_PATH = process.env.SWIPE_RUBRIC_FILE || new URL("../rubric.md", import.meta.url);
export const loadRubric = () => readFileSync(RUBRIC_PATH, "utf8");

const MODEL = () => process.env.SWIPE_MODEL || "gemini-3.5-flash";

const score = (description) => ({ type: "INTEGER", description });
export const analysisSchema = {
  type: "OBJECT",
  properties: {
    type: { type: "STRING", enum: ["Carousel", "Reel"] },
    category: { type: "STRING", description: "Short label for the kind of post." },
    topic: { type: "STRING", description: "What the post is about, 8 words or fewer." },
    hook: { type: "STRING", description: "The hook, described precisely enough to reproduce." },
    hookScore: score("1 to 5"),
    structure: { type: "STRING", description: "The beat arc (timestamps for reels, slide roles for carousels)." },
    structureScore: score("1 to 5"),
    pacing: { type: "STRING", description: "Cut rhythm / slide rhythm and how audio or text carries it." },
    pacingScore: score("1 to 5"),
    whyItWorks: { type: "STRING", description: "The scroll-stop mechanism, 1-2 sentences." },
    reuseIdea: { type: "STRING", description: "One concrete way to re-point the borrowed shape at the user's niche." },
    verdict: { type: "STRING", enum: ["Use", "Skip"] },
  },
  required: ["type", "category", "topic", "hook", "hookScore", "structure", "structureScore", "pacing", "pacingScore", "whyItWorks", "reuseIdea", "verdict"],
};

const REEL_INSTRUCTIONS =
  "This is a REEL and the actual video is attached: WATCH it, do not infer from the caption. " +
  "In hook, quote the first 3 seconds (on-screen text verbatim). In structure, give beats with rough " +
  "timestamps. In pacing, cover cut rhythm, shot type, on-screen text and audio.";

/** Scores must be integers 1-5 whatever the model returns; a missing/garbled field becomes a clear error, not a bad row. */
export function normalize(raw) {
  const num = (v) => Math.min(5, Math.max(1, Math.round(Number(v)) || 1));
  const str = (v) => String(v ?? "").trim();
  for (const k of ["topic", "hook", "structure", "pacing"])
    if (!str(raw?.[k])) throw new Error(`Model output missing "${k}"`);
  return {
    type: raw.type === "Reel" ? "Reel" : "Carousel",
    category: str(raw.category) || "Uncategorised",
    topic: str(raw.topic),
    hook: str(raw.hook),
    hookScore: num(raw.hookScore),
    structure: str(raw.structure),
    structureScore: num(raw.structureScore),
    pacing: str(raw.pacing),
    pacingScore: num(raw.pacingScore),
    whyItWorks: str(raw.whyItWorks),
    reuseIdea: str(raw.reuseIdea),
    verdict: raw.verdict === "Skip" ? "Skip" : "Use",
  };
}

async function realClient() {
  if (!process.env.GEMINI_API_KEY) throw new Error("Set GEMINI_API_KEY.");
  const { GoogleGenAI } = await import("@google/genai");
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

/** Upload a video and wait until Gemini has finished processing it. */
async function uploadVideo(client, { buffer, mimeType }, { pollMs = 2000, timeoutMs = 120_000 } = {}) {
  let file = await client.files.upload({ file: new Blob([buffer], { type: mimeType }), config: { mimeType, displayName: "swipe-reel" } });
  const deadline = Date.now() + timeoutMs;
  while (file?.state && file.state !== "ACTIVE") {
    if (file.state === "FAILED") throw new Error("Gemini video processing FAILED");
    if (Date.now() >= deadline) throw new Error(`Gemini video not ACTIVE after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, pollMs));
    file = await client.files.get({ name: file.name });
  }
  if (!file?.uri) throw new Error("Gemini upload returned no uri");
  return { name: file.name, uri: file.uri, mimeType: file.mimeType || mimeType };
}

/**
 * Analyse a downloaded post -> { type, category, topic, hook, hookScore, ..., verdict, watchedVideo }.
 * If the reel video is within the caps it is attached; any trouble with it falls back to caption +
 * cover frame, so the video path can make a row better but never make one fail.
 */
export async function analyzeSwipe({ caption, images = [], type, video = null }, { client, pollMs } = {}) {
  client ??= await realClient();
  const guard = videoGuard({ video });
  let uploaded = null;
  if (guard.use) {
    try {
      uploaded = await uploadVideo(client, video, { pollMs });
    } catch (e) {
      log.warn("video_upload_failed", { msg: e?.message?.slice(0, 160) });
    }
  } else if (video || type === "Reel") {
    log.info("video_skipped", { reason: guard.reason });
  }

  try {
    const parts = images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } }));
    if (uploaded) parts.push({ fileData: { fileUri: uploaded.uri, mimeType: uploaded.mimeType } });
    parts.push({
      text:
        `Detected format: ${type}.\n\nCaption:\n${caption || "(no caption captured)"}\n\n` +
        (uploaded ? `${REEL_INSTRUCTIONS}\n\n` : "") +
        "Score this Instagram post against the rubric.",
    });
    const niche = process.env.SWIPE_NICHE ? `\n\nThe user's own niche: ${process.env.SWIPE_NICHE}` : "";
    const resp = await client.models.generateContent({
      model: MODEL(),
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: loadRubric() + niche,
        responseMimeType: "application/json",
        responseSchema: analysisSchema,
        temperature: 0.4,
      },
    });
    return { ...normalize(JSON.parse(resp.text)), watchedVideo: Boolean(uploaded) };
  } finally {
    // Uploaded files expire after 48h but count against the storage quota until then.
    if (uploaded) await client.files.delete({ name: uploaded.name }).catch((e) => log.warn("video_delete_failed", { msg: e?.message?.slice(0, 120) }));
  }
}
