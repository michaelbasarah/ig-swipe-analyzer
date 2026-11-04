/**
 * Instagram side: link parsing, gallery-dl download, and saved-collection listing.
 *
 * Instagram blocks plain link-fetching, so this shells out to `gallery-dl`. That is unofficial and
 * against Instagram's Terms of Use. Read the README's Terms-of-service section before using it.
 *
 * The session cookie comes from the IG_SESSIONID env var only. It is handed to gallery-dl through a
 * throwaway 0600 config file in a temp dir that is deleted in `finally` (so it never shows up in
 * `ps`, and no cookie file survives the run).
 */
import { mkdtemp, rm, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./proc.mjs";
import { envNum, envOn, requireTos } from "./env.mjs";

/** A single post / reel / IGTV permalink anywhere in a message. */
export const IG_URL_RE = /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+\/?/i;
export const extractIgUrl = (text) => String(text ?? "").match(IG_URL_RE)?.[0] || null;
export const shortcodeFromUrl = (url) =>
  String(url ?? "").match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i)?.[1] || null;

export const MAX_SLIDES = 12;
const VIDEO_MIME = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };
const gdl = () => process.env.GALLERY_DL_BIN || "gallery-dl";

export const reelVideoEnabled = () => envOn("SWIPE_REEL_VIDEO", true);

/**
 * Cost guard. Gemini bills video by the second (~300 tokens/s), so an unbounded upload is an
 * unbounded bill. An over-cap reel is not an error: it falls back to caption + cover frame.
 */
export function videoGuard({ video, enabled = reelVideoEnabled() } = {}) {
  const maxMb = envNum("SWIPE_REEL_MAX_MB", 20) || 20;
  const maxSec = envNum("SWIPE_REEL_MAX_SECONDS", 90) || 90;
  if (!enabled) return { use: false, reason: "flag_off" };
  if (!video) return { use: false, reason: "no_video" };
  if (!video.buffer) return { use: false, reason: "not_read" };
  const mb = (video.sizeBytes || 0) / 1_048_576;
  if (!mb) return { use: false, reason: "empty_video" };
  if (mb > maxMb) return { use: false, reason: `too_big:${mb.toFixed(1)}MB>${maxMb}MB` };
  // No ffmpeg to probe duration; gallery-dl's metadata is the only source, so unknown passes on size.
  if (video.durationSec && video.durationSec > maxSec)
    return { use: false, reason: `too_long:${Math.round(video.durationSec)}s>${maxSec}s` };
  return { use: true, reason: "ok" };
}

/** Write a one-off gallery-dl config carrying the session cookie; returns its dir + the args to use it. */
async function cookieArgs() {
  const sid = process.env.IG_SESSIONID;
  if (!sid) return { args: [], cleanup: async () => {} };
  const dir = await mkdtemp(join(tmpdir(), "swipe-cfg-"));
  const file = join(dir, "gdl.json");
  await writeFile(file, JSON.stringify({ extractor: { instagram: { cookies: { sessionid: sid } } } }), {
    mode: 0o600,
  });
  return { args: ["-c", file], cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * Download one post into a temp dir and read it back.
 * Returns { handle, caption, type, images:[{mimeType,data}], video }. `video` is the reel's file held
 * in memory ({ buffer, mimeType, sizeBytes, durationSec }) or null, because the temp dir is always
 * deleted before the upload happens.
 */
export async function downloadIg(url, { exec = run } = {}) {
  requireTos();
  const dir = await mkdtemp(join(tmpdir(), "swipe-"));
  const cookie = await cookieArgs();
  try {
    await exec(gdl(), ["--write-metadata", "-D", dir, "--range", `1-${MAX_SLIDES}`, ...cookie.args, url]);

    const files = await readdir(dir);
    const imgFiles = files.filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
    const vidFiles = files.filter((f) => /\.(mp4|mov|webm)$/i.test(f)).sort();
    // --write-metadata writes one .json PER FILE; sort so the same post always resolves to the same one.
    const metaFile = files.filter((f) => /\.json$/i.test(f)).sort()[0];

    let caption = "", handle = "", typename = "", durationSec = 0;
    if (metaFile) {
      const meta = JSON.parse(await readFile(join(dir, metaFile), "utf8"));
      caption = meta.description || meta.caption || "";
      handle = meta.username || meta.owner?.username || meta.uploader || "";
      typename = meta.typename || meta.__typename || (meta.video_url ? "GraphVideo" : "");
      durationSec = Number(meta.video_duration ?? meta.duration ?? meta.video_duration_s ?? 0) || 0;
    }

    const images = [];
    for (const f of imgFiles.slice(0, MAX_SLIDES)) {
      const mimeType = /\.png$/i.test(f) ? "image/png" : /\.webp$/i.test(f) ? "image/webp" : "image/jpeg";
      images.push({ mimeType, data: (await readFile(join(dir, f))).toString("base64") });
    }

    const isReel = /\/(reel|reels|tv)\//i.test(url) || /video/i.test(typename);

    // The video path is gated on the URL alone: a carousel's video slide carries video_url too, and
    // uploading it would apply the reel rubric to a carousel. A carousel is always /p/. IGTV (/tv/)
    // is excluded because it is long-form and its duration is usually missing from the metadata.
    let video = null;
    if (reelVideoEnabled() && /\/(reel|reels)\//i.test(url) && vidFiles.length) {
      const f = vidFiles[0];
      const path = join(dir, f);
      const { size } = await stat(path);
      const maxMb = envNum("SWIPE_REEL_MAX_MB", 20) || 20;
      video =
        size <= maxMb * 1_048_576 // check size BEFORE reading, so an oversized reel never hits memory
          ? { buffer: await readFile(path), mimeType: VIDEO_MIME[f.split(".").pop().toLowerCase()] || "video/mp4", sizeBytes: size, durationSec }
          : { buffer: null, mimeType: "video/mp4", sizeBytes: size, durationSec };
    }

    return { handle, caption, images, video, type: isReel ? "Reel" : "Carousel" };
  } finally {
    await rm(dir, { recursive: true, force: true });
    await cookie.cleanup();
  }
}

// ------------------------------------------------------------------ saved collection

const SHORTCODE_RE = /^[A-Za-z0-9_-]{5,24}$/;

/**
 * PURE: pull posts out of gallery-dl's `--dump-json` output, newest first, deduped -> [{shortcode, isReel}].
 * The shape differs by extractor and version, so instead of indexing into it we walk every object. A
 * carousel yields one entry PER SLIDE sharing one `post_shortcode`, hence the dedupe: without it a
 * 10-slide carousel looks like 10 posts and burns 10 Gemini calls.
 */
export function parsePosts(stdout) {
  let tree;
  try {
    tree = JSON.parse(stdout);
  } catch {
    return [];
  }
  const objects = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    objects.push(node);
    for (const v of Object.values(node)) if (v && typeof v === "object") walk(v);
  };
  walk(tree);

  const ok = (v) => typeof v === "string" && SHORTCODE_RE.test(v);
  // Prefer post_shortcode across the WHOLE walk: a slide's own `shortcode` must never win over it.
  const usePost = objects.some((o) => ok(o.post_shortcode));
  const seen = new Set();
  const out = [];
  for (const o of objects) {
    const code = usePost ? o.post_shortcode : o.shortcode;
    if (!ok(code) || seen.has(code)) continue;
    seen.add(code);
    out.push({ shortcode: code, isReel: /video/i.test(o.typename || o.__typename || "") || o.product_type === "clips" });
  }
  return out;
}

/** Canonical permalink. Reels keep /reel/ because Type and the video path are derived from the URL. */
export const postUrl = (p) => `https://www.instagram.com/${p.isReel ? "reel" : "p"}/${p.shortcode}/`;

/**
 * Newest posts in a saved collection, metadata only (--dump-json downloads no media).
 * `--range` counts FILES not posts, so it is generous and the real cap is the slice after dedupe.
 */
export async function listSavedPosts(url, { limit = envNum("SWIPE_SWEEP_LIST_LIMIT", 30) || 30, exec = run } = {}) {
  requireTos();
  if (!process.env.IG_SESSIONID) throw new Error("A saved collection is private: set IG_SESSIONID.");
  const cookie = await cookieArgs();
  try {
    const { out } = await exec(gdl(), ["--dump-json", "--range", `1-${limit * MAX_SLIDES}`, ...cookie.args, url]);
    return parsePosts(out).slice(0, limit);
  } finally {
    await cookie.cleanup();
  }
}
