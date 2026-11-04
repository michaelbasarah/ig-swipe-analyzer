import { test } from "node:test";
import assert from "node:assert/strict";
import { handleSwipe } from "../src/swipe.mjs";
import { handleMessage } from "../src/discord.mjs";
import { downloadIg } from "../src/ig.mjs";
import { fakeGemini, fakeGalleryDl, withEnv } from "./helpers.mjs";

const URL_ = "https://www.instagram.com/reel/Abcde1/";

test("end to end with fakes: download -> Gemini -> one sheet row -> summary", async () => {
  await withEnv({ SWIPE_ACCEPT_TOS: "1", IG_SESSIONID: undefined }, async () => {
    const rows = [];
    const res = await handleSwipe(URL_, {
      download: (u) => downloadIg(u, { exec: fakeGalleryDl("reel") }),
      append: async (r) => rows.push(r),
      client: fakeGemini(),
      pollMs: 1,
    });
    assert.equal(res.ok, true);
    assert.equal(rows.length, 1);
    assert.equal(rows[0][1], "@example_creator");
    assert.equal(rows[0][16], URL_);
    assert.match(res.summary, /Hook 4\/5/);
    assert.match(res.summary, /Verdict: Use \(12\/15\)/);
  });
});

test("--dry style call writes no row", async () => {
  await withEnv({ SWIPE_ACCEPT_TOS: "1" }, async () => {
    let wrote = false;
    const res = await handleSwipe(URL_, {
      download: (u) => downloadIg(u, { exec: fakeGalleryDl("reel") }),
      append: async () => (wrote = true),
      write: false,
      client: fakeGemini(),
      pollMs: 1,
    });
    assert.equal(res.ok, true);
    assert.equal(wrote, false);
  });
});

test("an empty download is reported, not written", async () => {
  await withEnv({ SWIPE_ACCEPT_TOS: "1" }, async () => {
    let wrote = false;
    const res = await handleSwipe(URL_, {
      download: (u) => downloadIg(u, { exec: fakeGalleryDl("empty") }),
      append: async () => (wrote = true),
      client: fakeGemini(),
    });
    assert.equal(res.ok, false);
    assert.equal(wrote, false);
  });
});

const env = { DISCORD_CHANNEL_ID: "C1", DISCORD_USER_IDS: "U1, U2" };
const swipe = async (u) => ({ summary: `done ${u}` });
const sweep = async () => ({ text: "swept" });

test("discord: link from an allowed user in the right channel gets a reply", async () => {
  const r = await handleMessage({ content: `try ${URL_} please`, authorId: "U2", channelId: "C1" }, { swipe, sweep, env });
  assert.equal(r, `done ${URL_}`);
  assert.equal(await handleMessage({ content: "!sweep", authorId: "U1", channelId: "C1" }, { swipe, sweep, env }), "swept");
});

test("discord: ignores bots, strangers, other channels, and an empty allowlist", async () => {
  const m = { content: URL_, authorId: "U1", channelId: "C1" };
  assert.equal(await handleMessage({ ...m, isBot: true }, { swipe, sweep, env }), null);
  assert.equal(await handleMessage({ ...m, authorId: "NOPE" }, { swipe, sweep, env }), null);
  assert.equal(await handleMessage({ ...m, channelId: "C2" }, { swipe, sweep, env }), null);
  assert.equal(await handleMessage(m, { swipe, sweep, env: { ...env, DISCORD_USER_IDS: "" } }), null);
  assert.equal(await handleMessage({ ...m, content: "hello" }, { swipe, sweep, env }), null);
});
