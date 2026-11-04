import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { extractIgUrl, shortcodeFromUrl, parsePosts, postUrl, videoGuard, downloadIg, listSavedPosts } from "../src/ig.mjs";
import { fakeGalleryDl, withEnv } from "./helpers.mjs";

const TOS = { SWIPE_ACCEPT_TOS: "1" };

test("extracts permalinks from free text", () => {
  assert.equal(extractIgUrl("look https://www.instagram.com/p/Cabc123_-/ nice"), "https://www.instagram.com/p/Cabc123_-/");
  assert.equal(extractIgUrl("https://instagram.com/reel/XyZ_9/?igsh=1"), "https://instagram.com/reel/XyZ_9/");
  assert.equal(extractIgUrl("https://instagram.com/someone/"), null);
  assert.equal(extractIgUrl(undefined), null);
  assert.equal(shortcodeFromUrl("https://www.instagram.com/reels/AbC12/"), "AbC12");
});

test("refuses to touch Instagram without the ToS opt-in", async () => {
  await withEnv({ SWIPE_ACCEPT_TOS: undefined }, async () => {
    let called = false;
    await assert.rejects(downloadIg("https://www.instagram.com/p/Aaaaa1/", { exec: async () => (called = true) }), /SWIPE_ACCEPT_TOS/);
    assert.equal(called, false);
  });
});

test("downloads a reel: images, metadata, video in memory, temp dir cleaned", async () => {
  let workDir;
  const inner = fakeGalleryDl("reel");
  const exec = async (cmd, args) => { workDir = args[args.indexOf("-D") + 1]; return inner(cmd, args); };
  await withEnv({ ...TOS, IG_SESSIONID: undefined, SWIPE_REEL_VIDEO: undefined }, async () => {
    const dl = await downloadIg("https://www.instagram.com/reel/Abcde1/", { exec });
    assert.equal(dl.type, "Reel");
    assert.equal(dl.handle, "example_creator");
    assert.equal(dl.images.length, 1);
    assert.equal(dl.video.buffer.toString(), "vid");
    assert.equal(dl.video.durationSec, 12);
  });
  assert.equal(existsSync(workDir), false);
});

test("a /p/ carousel never takes the video path", async () => {
  await withEnv(TOS, async () => {
    const dl = await downloadIg("https://www.instagram.com/p/Abcde1/", { exec: fakeGalleryDl("reel") });
    assert.equal(dl.type, "Carousel");
    assert.equal(dl.video, null);
  });
});

test("the session cookie goes through a temp config, never argv, and is deleted afterwards", async () => {
  let seenArgs, cfgPath, cfgBody;
  const { readFileSync, existsSync, statSync } = await import("node:fs");
  const exec = async (cmd, args) => {
    seenArgs = args;
    cfgPath = args[args.indexOf("-c") + 1];
    cfgBody = readFileSync(cfgPath, "utf8");
    assert.equal((statSync(cfgPath).mode & 0o777), 0o600);
    return fakeGalleryDl("carousel")(cmd, args);
  };
  await withEnv({ ...TOS, IG_SESSIONID: "TESTSESSIONVALUE" }, async () => {
    await downloadIg("https://www.instagram.com/p/Abcde1/", { exec });
  });
  assert.ok(!seenArgs.join(" ").includes("TESTSESSIONVALUE"));
  assert.ok(cfgBody.includes("TESTSESSIONVALUE"));
  assert.equal(existsSync(cfgPath), false);
});

test("video guard: size, duration, flag", async () => {
  const mk = (mb, sec) => ({ buffer: Buffer.from("x"), sizeBytes: mb * 1_048_576, durationSec: sec });
  assert.equal(videoGuard({ video: mk(5, 30), enabled: true }).use, true);
  assert.match(videoGuard({ video: mk(50, 30), enabled: true }).reason, /too_big/);
  assert.match(videoGuard({ video: mk(5, 300), enabled: true }).reason, /too_long/);
  assert.equal(videoGuard({ video: mk(5, 0), enabled: true }).use, true); // unknown duration passes on size
  assert.equal(videoGuard({ video: mk(5, 30), enabled: false }).reason, "flag_off");
  assert.equal(videoGuard({ video: { buffer: null, sizeBytes: 1 }, enabled: true }).reason, "not_read");
});

test("parsePosts dedupes carousel slides and prefers post_shortcode", () => {
  const dump = JSON.stringify([
    [3, "https://x/1.jpg", { shortcode: "SLIDE0001", post_shortcode: "POST00001", typename: "GraphImage" }],
    [3, "https://x/2.jpg", { shortcode: "SLIDE0002", post_shortcode: "POST00001" }],
    [3, "https://x/3.mp4", { shortcode: "SLIDE0003", post_shortcode: "POST00002", typename: "GraphVideo" }],
    [3, "https://x/4.jpg", { shortcode: "!!", post_shortcode: "bad shortcode" }],
  ]);
  const posts = parsePosts(dump);
  assert.deepEqual(posts.map((p) => p.shortcode), ["POST00001", "POST00002"]);
  assert.equal(postUrl(posts[1]), "https://www.instagram.com/reel/POST00002/");
  assert.deepEqual(parsePosts("not json"), []);
});

test("listing a collection needs the cookie and caps at the limit", async () => {
  const dump = JSON.stringify(Array.from({ length: 6 }, (_, i) => [3, "u", { post_shortcode: `POST000${i}` }]));
  await withEnv({ ...TOS, IG_SESSIONID: undefined }, async () => {
    await assert.rejects(listSavedPosts("https://www.instagram.com/u/saved/c/1/", { exec: async () => ({ out: dump }) }), /IG_SESSIONID/);
  });
  await withEnv({ ...TOS, IG_SESSIONID: "x" }, async () => {
    const posts = await listSavedPosts("https://www.instagram.com/u/saved/c/1/", { limit: 4, exec: async () => ({ out: dump }) });
    assert.equal(posts.length, 4);
  });
});
