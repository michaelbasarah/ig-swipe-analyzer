/**
 * Append one analysis as a row in a Google Sheet (raw REST, no SDK).
 *
 * The header row writes itself if the sheet is empty. Rows go in with valueInputOption=RAW so free
 * text that starts with "=" (captions, model output) is stored as text, never as a live formula.
 */
import { getAccessToken } from "./google.mjs";

export const HEADER = [
  "Date", "Source", "Type", "Category", "Topic",
  "Hook", "Hook /5", "Structure", "Structure /5", "Pacing", "Pacing /5", "Total /15",
  "Why It Works", "How I'd Reuse It", "Verdict", "Watched Video", "Link",
];
const LAST_COL = "Q"; // HEADER.length === 17
const API = "https://sheets.googleapis.com/v4/spreadsheets";

/** A tab name as a valid A1 prefix: bare when simple, single-quoted (doubled quotes) otherwise. */
export const a1 = (tab, range) => {
  if (!tab) return range;
  const name = /^[A-Za-z0-9_]+$/.test(tab) ? tab : `'${tab.replace(/'/g, "''")}'`;
  return `${name}!${range}`;
};

/** Turn a finished analysis into the cell values, in HEADER order. */
export function toRow({ date, source, link, a }) {
  return [
    date, source, a.type, a.category, a.topic,
    a.hook, a.hookScore, a.structure, a.structureScore, a.pacing, a.pacingScore,
    a.hookScore + a.structureScore + a.pacingScore,
    a.whyItWorks, a.reuseIdea, a.verdict, a.watchedVideo ? "Yes" : "No", link,
  ];
}

export async function appendRow(values, { sheetId = process.env.SWIPE_SHEET_ID, tab = process.env.SWIPE_SHEET_TAB, fetchImpl = fetch, getToken = getAccessToken } = {}) {
  if (!sheetId) throw new Error("Set SWIPE_SHEET_ID (the long id in the sheet's URL).");
  const token = await getToken();
  const call = async (path, init = {}) => {
    const resp = await fetchImpl(`${API}/${encodeURIComponent(sheetId)}/values/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!resp.ok) throw new Error(`Sheets ${init.method || "GET"} failed (${resp.status}): ${(await resp.text()).slice(0, 300)}`);
    return resp.json();
  };

  const head = await call(encodeURIComponent(a1(tab, `A1:${LAST_COL}1`)));
  if (!head.values?.length) {
    await call(`${encodeURIComponent(a1(tab, `A1:${LAST_COL}1`))}?valueInputOption=RAW`, {
      method: "PUT",
      body: JSON.stringify({ values: [HEADER] }),
    });
  }
  return call(`${encodeURIComponent(a1(tab, `A:${LAST_COL}`))}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ values: [values] }),
  });
}
