import { test } from "node:test";
import assert from "node:assert/strict";
import { HEADER, toRow, appendRow, a1 } from "../src/sheet.mjs";
import { getAccessToken, _resetTokenCache } from "../src/google.mjs";
import { fakeServiceAccount, GOOD, withEnv } from "./helpers.mjs";

test("row matches the header, in order, with a computed total", () => {
  const row = toRow({ date: "2026-01-02", source: "@example_creator", link: "https://www.instagram.com/reel/Abcde1/", a: { ...GOOD, watchedVideo: true } });
  assert.equal(row.length, HEADER.length);
  assert.equal(row[HEADER.indexOf("Total /15")], 12);
  assert.equal(row[HEADER.indexOf("Watched Video")], "Yes");
  assert.equal(row[HEADER.indexOf("Link")], "https://www.instagram.com/reel/Abcde1/");
  assert.equal(row[HEADER.indexOf("Verdict")], "Use");
});

test("tab names are quoted when needed", () => {
  assert.equal(a1("Swipes", "A:Q"), "Swipes!A:Q");
  assert.equal(a1("My tab's", "A:Q"), "'My tab''s'!A:Q");
  assert.equal(a1(undefined, "A:Q"), "A:Q");
});

function fakeSheets({ headerPresent }) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });
    const ok = (j) => ({ ok: true, json: async () => j, text: async () => "" });
    if (!init.method) return ok(headerPresent ? { values: [HEADER] } : {});
    return ok({ updates: { updatedRows: 1 } });
  };
  return { calls, fetchImpl };
}

test("writes the header once when the sheet is empty, then appends RAW", async () => {
  const { calls, fetchImpl } = fakeSheets({ headerPresent: false });
  await appendRow(["a"], { sheetId: "SHEET_ID_FOR_TEST", fetchImpl, getToken: async () => "tok" });
  assert.deepEqual(calls.map((c) => c.method), ["GET", "PUT", "POST"]);
  assert.deepEqual(calls[1].body.values[0], HEADER);
  assert.match(calls[2].url, /valueInputOption=RAW/);
  assert.match(calls[2].url, /SHEET_ID_FOR_TEST/);
});

test("skips the header when it already exists", async () => {
  const { calls, fetchImpl } = fakeSheets({ headerPresent: true });
  await appendRow(["a"], { sheetId: "S", fetchImpl, getToken: async () => "tok" });
  assert.deepEqual(calls.map((c) => c.method), ["GET", "POST"]);
});

test("the sheet id comes from env, with a clear error when missing", async () => {
  await withEnv({ SWIPE_SHEET_ID: undefined }, async () => {
    await assert.rejects(appendRow(["a"], { fetchImpl: async () => {} }), /SWIPE_SHEET_ID/);
  });
});

test("a non-OK Sheets response surfaces as an error", async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => "forbidden" });
  await assert.rejects(appendRow(["a"], { sheetId: "S", fetchImpl, getToken: async () => "t" }), /403/);
});

test("service-account JWT exchange signs and caches", async () => {
  _resetTokenCache();
  await withEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: fakeServiceAccount(), GOOGLE_SERVICE_ACCOUNT_FILE: undefined }, async () => {
    let n = 0, body;
    const fetchImpl = async (url, init) => { n++; body = init.body; return { ok: true, json: async () => ({ access_token: "tok123", expires_in: 3600 }) }; };
    assert.equal(await getAccessToken({ fetchImpl }), "tok123");
    assert.equal(await getAccessToken({ fetchImpl }), "tok123");
    assert.equal(n, 1);
    assert.equal(new URLSearchParams(body).get("assertion").split(".").length, 3);
  });
  _resetTokenCache();
});
