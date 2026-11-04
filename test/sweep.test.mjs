import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planSweep, runSweep, digestText } from "../src/sweep.mjs";
import { settledShortcodes, isFirstRun, mark } from "../src/state.mjs";
import { withEnv, GOOD } from "./helpers.mjs";

const P = (n) => ({ shortcode: `POST000${n}`, isReel: false });
const posts = (n) => Array.from({ length: n }, (_, i) => P(i));

test("plan: small fresh collection is processed, big one is seeded", () => {
  assert.equal(planSweep({ posts: posts(3), settled: new Set(), firstRun: true, maxPerRun: 5 }).toAnalyze.length, 3);
  const big = planSweep({ posts: posts(20), settled: new Set(), firstRun: true, maxPerRun: 5 });
  assert.equal(big.toSeed.length, 20);
  assert.equal(big.toAnalyze.length, 0);
});

test("plan: later runs take only unseen posts, capped per run", () => {
  const settled = new Set(["POST0000", "POST0001"]);
  const plan = planSweep({ posts: posts(20), settled, firstRun: false, maxPerRun: 5 });
  assert.deepEqual(plan.toAnalyze.map((p) => p.shortcode), ["POST0002", "POST0003", "POST0004", "POST0005", "POST0006"]);
});

function harness({ swipeImpl, listed = posts(3), firstRun = false }) {
  const marks = [];
  return {
    marks,
    opts: {
      url: "https://www.instagram.com/u/saved/c/1/",
      list: async () => listed,
      swipe: swipeImpl,
      settledFn: () => new Set(),
      firstRunFn: () => firstRun,
      markFn: (...a) => marks.push(a),
      wait: async () => {},
      delayMs: 0, maxPerRun: 5, maxAttempts: 3,
    },
  };
}

test("sweep: done only when the row was written; soft failures are retryable; one bad post never stops the batch", async () => {
  await withEnv({ SWIPE_ACCEPT_TOS: "1" }, async () => {
    const outcomes = [
      { ok: true, analysis: { ...GOOD } },
      { ok: false, summary: "Could not pull any media" },
    ];
    const h = harness({ swipeImpl: null });
    let calls = 0;
    h.opts.swipe = async () => { calls++; if (calls === 3) throw new Error("gemini 503"); return outcomes[calls - 1]; };
    const res = await runSweep(h.opts);
    assert.deepEqual([res.analyzed, res.failed], [1, 2]);
    assert.deepEqual(h.marks.map((m) => m[1]), ["done", "failed", "failed"]);
    assert.match(res.text, /1 new post/);
    assert.match(res.text, /2 failed/);
  });
});

test("sweep: first run on a big collection seeds and analyses nothing", async () => {
  await withEnv({ SWIPE_ACCEPT_TOS: "1" }, async () => {
    let swiped = 0;
    const h = harness({ listed: posts(20), firstRun: true, swipeImpl: async () => { swiped++; } });
    const res = await runSweep(h.opts);
    assert.equal(res.seeded, 20);
    assert.equal(swiped, 0);
    assert.ok(h.marks.every((m) => m[1] === "seed"));
    assert.match(digestText({ seeded: 20 }), /armed/);
  });
});

test("sweep: no URL is a no-op, and no ToS opt-in refuses", async () => {
  assert.match((await runSweep({ url: "" })).skipped, /SWIPE_SAVED_URL/);
  await withEnv({ SWIPE_ACCEPT_TOS: undefined }, async () => {
    await assert.rejects(runSweep({ url: "https://www.instagram.com/u/saved/c/1/" }), /SWIPE_ACCEPT_TOS/);
  });
});

test("state file: settles done/seed, retries failures up to the cap, holds no content", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swipe-state-test-"));
  const file = join(dir, "state.json");
  await withEnv({ SWIPE_STATE_FILE: file }, async () => {
    const url = "https://www.instagram.com/u/saved/c/1/";
    assert.equal(isFirstRun(url), true);
    mark("DONE00001", "done", null, url);
    mark("SEED00001", "seed", null, url);
    mark("FAIL00001", "failed", "x", url);
    assert.equal(isFirstRun(url), false);
    assert.deepEqual([...settledShortcodes(3)].sort(), ["DONE00001", "SEED00001"]);
    mark("FAIL00001", "failed", "x", url);
    mark("FAIL00001", "failed", "x", url);
    assert.ok(settledShortcodes(3).has("FAIL00001"));
    assert.doesNotMatch(readFileSync(file, "utf8"), /sessionid|cookie/i);
  });
  rmSync(dir, { recursive: true, force: true });
});
