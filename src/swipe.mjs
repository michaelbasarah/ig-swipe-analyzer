/** One link, end to end: download -> Gemini -> sheet row -> a short text summary. */
import { downloadIg } from "./ig.mjs";
import { analyzeSwipe } from "./analyze.mjs";
import { appendRow, toRow } from "./sheet.mjs";

export const formatSummary = (a, source, link) =>
  [
    `${a.topic} (${source}, ${a.type}${a.watchedVideo ? ", watched the video" : ""})`,
    `Hook ${a.hookScore}/5: ${a.hook}`,
    `Structure ${a.structureScore}/5: ${a.structure}`,
    `Pacing ${a.pacingScore}/5: ${a.pacing}`,
    `Why it works: ${a.whyItWorks}`,
    `Reuse: ${a.reuseIdea}`,
    `Verdict: ${a.verdict} (${a.hookScore + a.structureScore + a.pacingScore}/15) ${link}`,
  ].join("\n");

/**
 * Returns { ok: true, analysis, summary } or { ok: false, summary } when the download came back empty
 * (expired cookie, deleted or private post). Throws on hard failures. `write:false` skips the sheet.
 */
export async function handleSwipe(url, { download = downloadIg, append = appendRow, write = true, ...analyzeDeps } = {}) {
  const dl = await download(url);
  if (!dl.images.length && !dl.caption && !dl.video?.buffer) {
    return { ok: false, summary: "Could not pull any media or caption from that link. Is the post public, and is IG_SESSIONID still valid?" };
  }
  const analysis = await analyzeSwipe(dl, analyzeDeps);
  const source = dl.handle ? `@${String(dl.handle).replace(/^@/, "")}` : "(unknown)";
  if (write) {
    await append(toRow({ date: new Date().toISOString().slice(0, 10), source, link: url, a: analysis }));
  }
  return { ok: true, analysis, summary: formatSummary(analysis, source, url) };
}
