/** Env helpers. Everything is read per call (not at import), so tests and restarts can flip flags. */
export const envOn = (name, dflt = false) => {
  const v = process.env[name];
  if (v === undefined || v === "") return dflt;
  return /^(1|true|yes|on)$/i.test(v);
};

export const envNum = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 && process.env[name] !== "" ? n : fallback;
};

/** Nothing may touch Instagram until the user has explicitly opted in. */
export function requireTos() {
  if (!envOn("SWIPE_ACCEPT_TOS")) {
    throw new Error(
      "Refusing to contact Instagram: set SWIPE_ACCEPT_TOS=1 to confirm you have read the " +
        "Terms-of-service section of the README (personal account, low volume, at your own risk).",
    );
  }
}

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const emit = (level, event, fields) => {
  if (LEVELS[level] > (LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info)) return;
  const extra = Object.entries(fields || {})
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" ");
  console.error(`[${level}] ${event}${extra ? " | " + extra : ""}`);
};
export const log = {
  error: (e, f) => emit("error", e, f),
  warn: (e, f) => emit("warn", e, f),
  info: (e, f) => emit("info", e, f),
  debug: (e, f) => emit("debug", e, f),
};
