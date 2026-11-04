#!/usr/bin/env node
/**
 * ig-swipe <instagram-link> [--dry]   analyse one post or reel, append a row to your sheet
 * ig-swipe sweep                       analyse new saves in your SWIPE_SAVED_URL collection
 * ig-swipe discord                     run the optional Discord trigger
 *
 * --dry prints the breakdown and skips the sheet (handy for a first try, no Google setup needed).
 */
import { extractIgUrl } from "./ig.mjs";
import { handleSwipe } from "./swipe.mjs";
import { runSweep } from "./sweep.mjs";

try { process.loadEnvFile(); } catch { /* no .env: fine, env may come from the shell */ }

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const cmd = args.find((a) => a !== "--dry");
const usage = () => {
  console.error("usage: ig-swipe <instagram-link> [--dry] | ig-swipe sweep | ig-swipe discord");
  process.exit(2);
};

try {
  if (!cmd || cmd === "-h" || cmd === "--help") usage();
  if (cmd === "sweep") {
    console.log((await runSweep()).text);
  } else if (cmd === "discord") {
    const { startDiscord } = await import("./discord.mjs");
    await startDiscord();
  } else {
    const url = extractIgUrl(cmd);
    if (!url) usage();
    const res = await handleSwipe(url, { write: !dry });
    console.log(res.summary);
    process.exitCode = res.ok ? 0 : 1;
  }
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exit(1);
}
