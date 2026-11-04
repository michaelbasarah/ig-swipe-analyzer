# ig-swipe-analyzer

Paste an Instagram post or reel link, or sweep your own saved collection, and Gemini watches it and
scores the **hook**, **structure** and **pacing**. Each result becomes one row in your Google Sheet,
so a pile of "I should remember this" saves turns into a searchable, scored swipe file.

Extracted from a private content-research tool I use myself. Plain Node, one runtime dependency
(`@google/genai`), no Sheets SDK, no database.

---

## READ THIS FIRST: Instagram's Terms of Use

**This tool downloads Instagram content with [`gallery-dl`](https://github.com/mikf/gallery-dl) and a
logged-in session cookie. That is unofficial scraping and is against Instagram's Terms of Use.**
Instagram can throttle, challenge, restrict or ban an account that does it. The saved-collection
sweep is the riskier half because it reads a private area of your account.

- **Personal use only.** Your own research, your own swipe file. Not a service, not for clients, not
  for redistribution of anyone's content.
- **Low volume.** A handful of posts a day. The sweep caps itself (5 posts per run, a 20 second
  pause between posts) and its first run only *seeds*; do not raise those limits to "go faster".
- **Your own session cookie, from env.** Set `IG_SESSIONID` in your environment. It is never
  written to a cookie file, never put on a command line, and never logged.
- **NEVER use an Instagram account that is linked to a business**: no brand account, no account in
  a Meta Business portfolio, nothing attached to a WhatsApp Business or ads account. Enforcement is
  not always surgical about linked assets. Use a personal or secondary login you can afford to lose.
- **Use at your own risk.** No warranty (see `LICENSE`). If your account gets restricted, that is on you.
- Nothing contacts Instagram until you set `SWIPE_ACCEPT_TOS=1`. That is a speed bump so you read
  this section, not a legal shield.

---

## What it does

```
link or saved collection --> gallery-dl --> Gemini (watches the reel / reads the slides) --> Google Sheet row
```

- **Reels** are uploaded to the Gemini Files API and analysed as native video, so the model sees the
  first 3 seconds, the cuts and the on-screen text instead of guessing from the caption. Capped at
  `SWIPE_REEL_MAX_MB` (20) and `SWIPE_REEL_MAX_SECONDS` (90); over the cap, or if the upload fails,
  it falls back to caption + cover frame, so a row is still written.
- **Carousels** are read slide by slide.
- Scoring follows [`rubric.md`](rubric.md): hook, structure and pacing, 1 to 5 each, plus a
  Use/Skip verdict and one concrete way to reuse the borrowed shape. The rule is *steal the shape,
  not the subject*. The rubric is a plain file; edit it to fit your niche (or set `SWIPE_NICHE`).
- **Saved-collection sweep:** save posts into one dedicated collection while you scroll; run
  `npm run sweep` now and then and every new save is analysed. A first run against a big collection
  only marks everything as already seen, so it never bills hundreds of Gemini calls.
- **Optional Discord trigger:** post a link in one channel and the bot replies with the breakdown.

A made-up example of the output is in [`examples/sample-output.md`](examples/sample-output.md).

## Setup

Needs Node 20.12+, [`gallery-dl`](https://github.com/mikf/gallery-dl#installation) on your PATH
(`pipx install gallery-dl`), a Gemini API key, and a Google Sheet.

```bash
git clone <this repo> && cd ig-swipe-analyzer
npm install
cp .env.example .env        # then fill it in
```

**Google Sheet:** create a sheet, GCP console, enable the Sheets API, make a service account and a
JSON key (keep it outside the repo), then **share the sheet with the service account's
`client_email` as Editor**. Skipping that gives a 403 that looks like a bad key. Put the long id from
the sheet URL in `SWIPE_SHEET_ID`. The header row writes itself.

**Instagram session:** in a browser logged in to your personal account, copy the `sessionid` cookie
value (DevTools, Application, Cookies) into `IG_SESSIONID`. It expires every few weeks; re-copy it
when downloads start coming back empty.

## Use

```bash
npm run swipe -- https://www.instagram.com/reel/XXXXXXXXXXX/ --dry   # print the breakdown, skip the sheet
npm run swipe -- https://www.instagram.com/reel/XXXXXXXXXXX/         # analyse and append a row
npm run sweep                                                        # analyse new saves in SWIPE_SAVED_URL
npm run discord                                                      # optional bot
```

For the sweep, make an Instagram collection (for example `swipe`), open it on the web and put its
URL in `SWIPE_SAVED_URL`. Use a collection rather than your whole saved pile: it keeps "save to
swipe" a deliberate signal. Run it from cron if you like, and keep it infrequent:

```
0 9,21 * * * cd /path/to/ig-swipe-analyzer && /usr/bin/env npm run sweep
```

Sweep progress lives in `.swipe-state.json` (shortcodes and outcomes only, git-ignored). A post is
marked done only after its row is written; failures retry up to 3 times, so an expired cookie never
silently swallows your saves.

**Discord (optional):** create a bot, enable the Message Content intent, invite it to your own server,
`npm install discord.js` if it was skipped, set `DISCORD_TOKEN`, `DISCORD_CHANNEL_ID` and
`DISCORD_USER_IDS`. The user allowlist **defaults to nobody**. The bot reads that one channel only,
never DMs. Post a link, or `!sweep`.

## Sheet columns

Date, Source, Type, Category, Topic, Hook, Hook /5, Structure, Structure /5, Pacing, Pacing /5,
Total /15, Why It Works, How I'd Reuse It, Verdict, Watched Video, Link. Scores are real numbers.
Rows are written raw, so a caption starting with `=` is stored as text, not a formula. Append-only,
no dedupe: merge near-duplicates by hand.

## Cost

Gemini bills video by the second, roughly 300 tokens per second, so a 60 second reel costs a few
cents on a Flash model and a carousel less. Pick the model with `SWIPE_MODEL`. Set
`SWIPE_REEL_VIDEO=0` to skip video entirely.

## Tests

```bash
npm test
```

Every test runs against fakes: a fake `gallery-dl`, a fake Gemini client, a fake Sheets endpoint and a
throwaway RSA key. No API keys, no network, no Instagram, nothing to install first. CI runs the same
command on Node 20 and 22.

## Layout

```
src/ig.mjs        link parsing, gallery-dl download, collection listing, video cost guard
src/analyze.mjs   Gemini call (slides inline, reel via Files API), output normalising
src/sheet.mjs     header + row append over raw REST        src/google.mjs   service-account token
src/sweep.mjs     saved-collection sweep                   src/state.mjs    sweep memory
src/discord.mjs   optional trigger                         src/cli.mjs      entry point
rubric.md         the scoring prompt, edit me
```

## Notes

- Not affiliated with or endorsed by Instagram, Meta or Google.
- The session cookie is handed to `gallery-dl` through a throwaway `0600` config file in a temp
  directory that is deleted when the call ends, so it never appears in `ps` output and no cookie
  file survives a run.

MIT licensed.
