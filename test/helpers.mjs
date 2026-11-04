import { generateKeyPairSync } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/** A throwaway RSA service-account key, so google.mjs can really sign a JWT with no real credentials. */
export function fakeServiceAccount() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return JSON.stringify({
    client_email: "test@example.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  });
}

/** A fake gallery-dl: writes files into whatever `-D <dir>` it is handed, so no scraper or network runs. */
export function fakeGalleryDl(kind = "reel") {
  return async (_cmd, args) => {
    const dir = args[args.indexOf("-D") + 1];
    if (kind === "empty") return { out: "", err: "" };
    await writeFile(join(dir, "01.jpg"), "img");
    if (kind === "reel") await writeFile(join(dir, "01.mp4"), "vid");
    await writeFile(join(dir, "01.json"), JSON.stringify({ description: "cap", username: "example_creator", video_duration: kind === "reel" ? 12 : 0 }));
    return { out: "", err: "" };
  };
}

export const GOOD = {
  type: "Reel", category: "Listicle", topic: "Three desk setup mistakes",
  hook: "Text on screen: 'Stop doing this'", hookScore: 4,
  structure: "0-3s hook, 3-20s three mistakes, 20-25s CTA", structureScore: 5,
  pacing: "Cut every 1.5s, voice-over over b-roll", pacingScore: 3,
  whyItWorks: "Negative framing plus a countdown.", reuseIdea: "Use the countdown for a study-tips reel.", verdict: "Use",
};

/** A stand-in Gemini client that records what it was asked and returns canned JSON. */
export function fakeGemini(result = GOOD) {
  const calls = { generate: [], uploaded: 0, deleted: [] };
  return {
    calls,
    files: {
      upload: async () => { calls.uploaded++; return { name: "files/abc", uri: "https://example.test/files/abc", mimeType: "video/mp4", state: "PROCESSING" }; },
      get: async () => ({ name: "files/abc", uri: "https://example.test/files/abc", mimeType: "video/mp4", state: "ACTIVE" }),
      delete: async ({ name }) => { calls.deleted.push(name); },
    },
    models: { generateContent: async (req) => { calls.generate.push(req); return { text: JSON.stringify(result) }; } },
  };
}

export const withEnv = async (vars, fn) => {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) { prev[k] = process.env[k]; v === undefined ? delete process.env[k] : (process.env[k] = v); }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(prev)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
};
