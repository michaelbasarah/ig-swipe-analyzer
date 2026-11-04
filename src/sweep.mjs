/**
 * Saved-collection sweep: save posts into ONE dedicated Instagram collection while you scroll, run
 * this now and then, and every new save goes through the same pipeline as a pasted link.
 *
 * Built to stay small and quiet: a hard cap per run, a delay between posts, and a first run against
 * a big collection that only SEEDS (marks everything already-seen, analyses nothing) so it never
 * bills hundreds of Gemini calls or hits Instagram hard.
 */
import { listSavedPosts, postUrl } from "./ig.mjs";
import { handleSwipe } from "./swipe.mjs";
import { settledShortcodes, isFirstRun, mark } from "./state.mjs";
import { envNum, requireTos } from "./env.mjs";

/**
 * PURE: decide what a run does. A first run against a collection with more fresh posts than one run
 * may analyse seeds instead; a small fresh collection is processed normally.
 */
export function planSweep({ posts, settled, firstRun, maxPerRun }) {
  const fresh = posts.filter((p) => !settled.has(p.shortcode));
  if (firstRun && fresh.length > maxPerRun) return { toAnalyze: [], toSeed: fresh };
  return { toAnalyze: fresh.slice(0, maxPerRun), toSeed: [] };
}

export function digestText({ analyzed, failed, seeded }) {
  if (seeded) return `Sweep armed: ${seeded} saved posts marked as already seen, nothing analysed. Save something new and run again.`;
  const lines = [`Sweep: ${analyzed.length} new post${analyzed.length === 1 ? "" : "s"} added.`];
  lines.push(...analyzed.map((t) => `- ${t}`));
  if (failed.length) lines.push(`${failed.length} failed (will retry):`, ...failed.map((f) => `- ${f.shortcode}: ${f.error}`));
  return lines.join("\n");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run one sweep. A post is marked done only once its sheet row was written; anything else is
 * "failed" and retried next time (up to maxAttempts), so an expired cookie never silently swallows
 * saves. One bad post never stops the batch; only a failure to LIST propagates.
 */
export async function runSweep({
  url = process.env.SWIPE_SAVED_URL,
  list = listSavedPosts,
  swipe = handleSwipe,
  settledFn = settledShortcodes,
  firstRunFn = isFirstRun,
  markFn = mark,
  wait = sleep,
  maxPerRun = envNum("SWIPE_SWEEP_MAX_PER_RUN", 5) || 5,
  maxAttempts = envNum("SWIPE_SWEEP_MAX_ATTEMPTS", 3) || 3,
  delayMs = envNum("SWIPE_SWEEP_DELAY_SECONDS", 20) * 1000,
  swipeOpts = {},
} = {}) {
  if (!url) return { skipped: "no SWIPE_SAVED_URL", text: "Set SWIPE_SAVED_URL to your collection's URL." };
  requireTos();

  const posts = await list(url);
  const { toAnalyze, toSeed } = planSweep({ posts, settled: settledFn(maxAttempts), firstRun: firstRunFn(url), maxPerRun });

  if (toSeed.length) {
    for (const p of toSeed) markFn(p.shortcode, "seed", null, url);
    return { listed: posts.length, seeded: toSeed.length, analyzed: 0, failed: 0, text: digestText({ seeded: toSeed.length }) };
  }

  const analyzed = [];
  const failed = [];
  for (const [i, p] of toAnalyze.entries()) {
    if (i > 0 && delayMs) await wait(delayMs);
    try {
      const res = await swipe(postUrl(p), swipeOpts);
      if (!res.ok) {
        markFn(p.shortcode, "failed", res.summary, url);
        failed.push({ shortcode: p.shortcode, error: "no media or caption (cookie expired, or post gone?)" });
        continue;
      }
      markFn(p.shortcode, "done", null, url);
      analyzed.push(`${res.analysis.topic} (${res.analysis.verdict}, ${res.analysis.hookScore + res.analysis.structureScore + res.analysis.pacingScore}/15)`);
    } catch (e) {
      const error = e?.message || String(e);
      markFn(p.shortcode, "failed", error, url);
      failed.push({ shortcode: p.shortcode, error: error.slice(0, 120) });
    }
  }
  return { listed: posts.length, seeded: 0, analyzed: analyzed.length, failed: failed.length, text: digestText({ analyzed, failed }) };
}
