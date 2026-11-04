import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeSwipe, normalize, loadRubric } from "../src/analyze.mjs";
import { fakeGemini, GOOD, withEnv } from "./helpers.mjs";

const reel = { caption: "cap", images: [{ mimeType: "image/jpeg", data: "AAAA" }], type: "Reel", video: { buffer: Buffer.from("v"), mimeType: "video/mp4", sizeBytes: 1_000_000, durationSec: 12 } };

test("rubric ships generic: no business-specific text", () => {
  const r = loadRubric();
  assert.match(r, /borrow the format/i);
  assert.match(r, /Hook/);
  assert.doesNotMatch(r, /whatsapp|funnel|TOFU|karyawan/i);
});

test("a reel is watched as video, then the upload is deleted", async () => {
  const g = fakeGemini();
  const out = await analyzeSwipe(reel, { client: g, pollMs: 1 });
  assert.equal(out.watchedVideo, true);
  assert.equal(g.calls.uploaded, 1);
  assert.deepEqual(g.calls.deleted, ["files/abc"]);
  const parts = g.calls.generate[0].contents[0].parts;
  assert.ok(parts.some((p) => p.fileData?.fileUri));
  assert.match(parts.at(-1).text, /WATCH it/);
  assert.equal(out.hookScore, 4);
});

test("video off -> caption + cover frame only, nothing uploaded", async () => {
  await withEnv({ SWIPE_REEL_VIDEO: "0" }, async () => {
    const g = fakeGemini();
    const out = await analyzeSwipe(reel, { client: g });
    assert.equal(out.watchedVideo, false);
    assert.equal(g.calls.uploaded, 0);
  });
});

test("a failed upload degrades to the image path instead of failing the row", async () => {
  const g = fakeGemini();
  g.files.upload = async () => { throw new Error("boom"); };
  const out = await analyzeSwipe(reel, { client: g });
  assert.equal(out.watchedVideo, false);
  assert.equal(g.calls.generate.length, 1);
});

test("the niche env var reaches the system prompt", async () => {
  await withEnv({ SWIPE_NICHE: "home cooking for students" }, async () => {
    const g = fakeGemini();
    await analyzeSwipe({ ...reel, video: null }, { client: g });
    assert.match(g.calls.generate[0].config.systemInstruction, /home cooking for students/);
  });
});

test("normalize clamps scores and rejects empty analyses", () => {
  const n = normalize({ ...GOOD, hookScore: 9, structureScore: "0", pacingScore: 2.6, verdict: "weird" });
  assert.deepEqual([n.hookScore, n.structureScore, n.pacingScore, n.verdict], [5, 1, 3, "Use"]);
  assert.throws(() => normalize({ ...GOOD, hook: "" }), /missing "hook"/);
});
