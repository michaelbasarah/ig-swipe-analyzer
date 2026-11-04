/**
 * Sweep memory: which saved posts have been analysed. One small JSON file (SWIPE_STATE_FILE,
 * default .swipe-state.json, git-ignored). It holds shortcodes and outcomes only: no cookie, no content.
 */
import { readFileSync, writeFileSync, renameSync } from "node:fs";

const path = () => process.env.SWIPE_STATE_FILE || ".swipe-state.json";

function load() {
  try {
    return JSON.parse(readFileSync(path(), "utf8"));
  } catch {
    return { posts: {}, collections: {} };
  }
}
function save(s) {
  const tmp = `${path()}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, path()); // atomic: a crash never leaves half a file
}

/** Shortcodes the sweep should skip: done, seeded, or failed `maxAttempts` times already. */
export function settledShortcodes(maxAttempts = 3) {
  const out = new Set();
  for (const [code, r] of Object.entries(load().posts))
    if (r.status === "done" || r.status === "seed" || (r.status === "failed" && r.attempts >= maxAttempts)) out.add(code);
  return out;
}

/** True until a collection has been swept once. */
export const isFirstRun = (collectionUrl) => !load().collections[collectionUrl];

export function mark(shortcode, status, error, collectionUrl) {
  const s = load();
  const prev = s.posts[shortcode];
  s.posts[shortcode] = {
    status,
    attempts: status === "failed" ? (prev?.attempts || 0) + 1 : prev?.attempts || 0,
    error: error ? String(error).slice(0, 300) : undefined,
    at: new Date().toISOString(),
  };
  if (collectionUrl) s.collections[collectionUrl] = true;
  save(s);
}
