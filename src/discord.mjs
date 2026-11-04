/**
 * Optional Discord trigger. Post an Instagram link in the configured channel and the bot replies with
 * the breakdown (and the row lands in your sheet). `!sweep` runs the saved-collection sweep.
 *
 * Hard allowlist: DISCORD_USER_IDS, and EMPTY MEANS NOBODY. One channel only, never DMs.
 * `handleMessage` holds all the logic and takes plain data, so tests need no Discord connection.
 */
import { extractIgUrl } from "./ig.mjs";
import { handleSwipe } from "./swipe.mjs";
import { runSweep } from "./sweep.mjs";
import { log } from "./env.mjs";

const csv = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);

/** -> the reply text, or null when the message should be ignored. */
export async function handleMessage({ content, authorId, channelId, isBot = false }, { swipe = handleSwipe, sweep = runSweep, env = process.env } = {}) {
  if (isBot) return null;
  if (!env.DISCORD_CHANNEL_ID || channelId !== env.DISCORD_CHANNEL_ID) return null;
  if (!csv(env.DISCORD_USER_IDS).includes(authorId)) return null;

  const text = String(content ?? "").trim();
  if (/^!sweep\b/i.test(text)) return (await sweep()).text;
  const url = extractIgUrl(text);
  if (!url) return null;
  return (await swipe(url)).summary;
}

// One at a time: two quick links must not race the same sheet append or hammer Instagram.
let tail = Promise.resolve();
const serialized = (fn) => (tail = tail.then(fn, fn));

const chunk = (s, n = 1900) => (s.length <= n ? [s] : s.match(new RegExp(`[\\s\\S]{1,${n}}`, "g")));

export async function startDiscord() {
  if (!process.env.DISCORD_TOKEN) throw new Error("Set DISCORD_TOKEN.");
  let discord;
  try {
    discord = await import("discord.js");
  } catch {
    throw new Error("discord.js is not installed (it is an optional dependency): npm install discord.js");
  }
  const { Client, GatewayIntentBits } = discord;
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });
  client.on("messageCreate", (m) => {
    if (m.author.bot || !m.guildId) return;
    serialized(async () => {
      try {
        const reply = await handleMessage({ content: m.content, authorId: m.author.id, channelId: m.channelId });
        if (reply) for (const part of chunk(reply)) await m.reply(part);
      } catch (e) {
        log.error("discord_handler_failed", { msg: e?.message });
        await m.reply(`Failed: ${String(e?.message || e).slice(0, 300)}`).catch(() => {});
      }
    });
  });
  client.once("clientReady", () => log.info("discord_ready", { user: client.user?.tag }));
  await client.login(process.env.DISCORD_TOKEN);
}
