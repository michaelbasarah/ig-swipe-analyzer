import { spawn } from "node:child_process";

/** Spawn a command, collect stdout/stderr, hard timeout. Never echoes the args (they may be sensitive). */
export function run(cmd, args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e.code === "ENOENT" ? new Error(`${cmd} not found. Is gallery-dl installed?`) : e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve({ out, err })
        : reject(new Error(`${cmd} exited ${code}: ${(err || out).slice(0, 400)}`));
    });
  });
}
