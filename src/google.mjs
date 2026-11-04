/**
 * Service-account auth, the smallest thing that yields a Sheets access token: sign a JWT with node's
 * built-in crypto (RS256), exchange it at Google's token endpoint, cache until ~1 min before expiry.
 * No `googleapis` dependency.
 *
 * Creds come from GOOGLE_SERVICE_ACCOUNT_JSON (raw JSON, one line) or GOOGLE_SERVICE_ACCOUNT_FILE.
 */
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

const b64url = (input) => Buffer.from(input).toString("base64url");
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

function loadCreds() {
  const raw =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    (process.env.GOOGLE_SERVICE_ACCOUNT_FILE && readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_FILE, "utf8"));
  if (!raw) throw new Error("No Google creds: set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_FILE");
  const creds = JSON.parse(raw);
  if (!creds.client_email || !creds.private_key) throw new Error("Service-account JSON is missing client_email / private_key");
  creds.private_key = creds.private_key.replace(/\\n/g, "\n"); // PEM newlines arrive escaped inside env vars
  return creds;
}

let cached = null; // { token, exp }

export async function getAccessToken({ fetchImpl = fetch } = {}) {
  const now = Math.floor(Date.now() / 1000);
  if (cached && now < cached.exp - 60) return cached.token;

  const { client_email, private_key } = loadCreds();
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({ iss: client_email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }),
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${claim}`).sign(private_key);
  const resp = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claim}.${b64url(signature)}`,
    }),
  });
  if (!resp.ok) throw new Error(`Google token exchange failed (${resp.status}): ${(await resp.text()).slice(0, 200)}`);
  const json = await resp.json();
  cached = { token: json.access_token, exp: now + (json.expires_in ?? 3600) };
  return cached.token;
}

export const _resetTokenCache = () => (cached = null);
