import { createRequire } from "node:module";
import { accessSync, chmodSync, constants, copyFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Cloud-safe FFmpeg/FFprobe resolution. The binaries ship inside the deployed function
 * (@ffmpeg-installer/<platform>, @ffprobe-installer/<platform>), so rendering never depends
 * on a developer PC. FFMPEG_PATH / FFPROBE_PATH override; PATH is only a last-resort dev fallback.
 */
export type MediaBinary = "ffmpeg" | "ffprobe";

const require = createRequire(import.meta.url);
const cache = new Map<MediaBinary, string>();

function packagedBinary(name: MediaBinary): string | null {
  const scope = name === "ffmpeg" ? "@ffmpeg-installer" : "@ffprobe-installer";
  try {
    const dir = dirname(require.resolve(`${scope}/${process.platform}-${process.arch}/package.json`));
    const file = join(dir, process.platform === "win32" ? `${name}.exe` : name);
    return existsSync(file) ? file : null;
  } catch {
    return null;
  }
}

function ensureExecutable(path: string, name: MediaBinary) {
  if (process.platform === "win32") return path;
  try {
    accessSync(path, constants.X_OK);
    return path;
  } catch {
    // Function bundles can drop the exec bit: copy once into the writable tmp dir.
    const target = join(tmpdir(), `post-automatici-${name}`);
    if (!existsSync(target)) copyFileSync(path, target);
    chmodSync(target, 0o755);
    return target;
  }
}

export function resolveMediaBinary(name: MediaBinary): string {
  const cached = cache.get(name);
  if (cached) return cached;
  const override = (name === "ffmpeg" ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH)?.trim();
  const packaged = override ? null : packagedBinary(name);
  const resolved = override || (packaged ? ensureExecutable(packaged, name) : name);
  cache.set(name, resolved);
  return resolved;
}

export type ProcessResult = { code: number; stdout: string; stderrTail: string; durationMs: number };

/** Runs a media binary with a hard timeout; never uses a shell, arguments are passed verbatim. */
export function runMediaBinary(name: MediaBinary, args: string[], options: { timeoutMs: number; cwd?: string }): Promise<ProcessResult> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(resolveMediaBinary(name), args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${name.toUpperCase()}_TIMEOUT`));
    }, options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { if (stdout.length < 2_000_000) stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-6_000); });
    child.on("error", (error) => { clearTimeout(timer); reject(new Error(`${name.toUpperCase()}_UNAVAILABLE: ${error.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderrTail: stderr, durationMs: Date.now() - started });
    });
  });
}
