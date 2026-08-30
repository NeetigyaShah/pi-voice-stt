import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FfmpegCaptureConfig } from "../config/types";
import { formatError, truncate } from "../utils/text";
import type { AudioRecorder, RecordingHandle } from "./types";

const MAX_STDERR_BYTES = 24 * 1024;

const collectStderr = (stream: NodeJS.ReadableStream): (() => string) => {
  let stderr = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    stderr += chunk;
    if (Buffer.byteLength(stderr, "utf8") > MAX_STDERR_BYTES) {
      stderr = stderr.slice(-MAX_STDERR_BYTES);
    }
  });
  return () => stderr;
};

const waitForExit = (process: ChildProcess): Promise<string> => {
  return new Promise((resolve) => {
    process.once("error", (error) => resolve(`process error: ${formatError(error)}`));
    process.once("close", (code, signal) => resolve(signal ? `signal ${signal}` : `exit ${code ?? "unknown"}`));
  });
};

export const createFfmpegRecorder = (config: FfmpegCaptureConfig): AudioRecorder => ({
  start() {
    const tempDir = mkdtempSync(join(tmpdir(), "pi-voice-stt-"));
    const outputPath = join(tempDir, "recording.wav");
    const isDshow = config.inputFormat === "dshow";
    const args = [
      "-hide_banner",
      "-loglevel",
      "warning",
      "-f",
      config.inputFormat,
      ...(isDshow ? ["-audio_buffer_size", "20"] : []),
      "-i",
      config.input,
      "-vn",
      "-acodec",
      "pcm_s16le",
      "-ar",
      String(config.sampleRate),
      "-ac",
      String(config.channels),
      "-y",
      outputPath,
    ];
    const child = spawn(config.ffmpegPath, args, {
      stdio: ["pipe", "ignore", "pipe"],
    });

    const getStderr = collectStderr(child.stderr);
    const exited = waitForExit(child);
    const startTime = Date.now();
    let stopped = false;

    const terminate = () => {
      if (child.exitCode !== null) return;
      if (process.platform === "win32") {
        try {
          if (child.stdin && !child.stdin.destroyed && child.stdin.writable) {
            child.stdin.write("q\n");
            child.stdin.end();
            return;
          }
        } catch { /* ignore */ }
      }
      try { child.kill("SIGINT"); } catch { /* already dead */ }
    };

    const forceKill = () => {
      if (child.exitCode !== null) return;
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
    };

    const stop = async () => {
      if (!stopped) {
        stopped = true;
        terminate();
      }
      const killTimer = setTimeout(forceKill, 3000);
      const exitResult = await exited;
      clearTimeout(killTimer);
      const stderrText = getStderr();

      let size = 0;
      try {
        size = (await stat(outputPath)).size;
      } catch {
        throw new Error(`ffmpeg did not create an audio file (${exitResult}). ${truncate(stderrText)}`);
      }

      const effectiveMinBytes = 44;
      if (size <= effectiveMinBytes) {
        throw new Error(
          `Recording is empty (${size} bytes). ` +
            truncate(stderrText),
        );
      }
      return outputPath;
    };

    const dispose = async () => {
      if (!stopped) {
        stopped = true;
        terminate();
      }
      const killTimer = setTimeout(forceKill, 3000);
      await exited.catch((error: unknown) => {
        console.warn(`Pi Voice STT recording cleanup failed: ${formatError(error)}`);
      });
      clearTimeout(killTimer);
      await rm(tempDir, { force: true, recursive: true }).catch((error: unknown) => {
        console.warn(`Pi Voice STT temp cleanup failed: ${formatError(error)}`);
      });
    };

    return {
      outputPath,
      stop,
      dispose,
    } satisfies RecordingHandle;
  },
});
