import { execFile } from "node:child_process";
import { compilerObservationScript, parseCompilerObservation, type CompilerObservation } from "./compiled-compiler-observation.js";

export type ObservationRun = Readonly<{
  category: string; observation: CompilerObservation | null;
  exitCode: number | null; exitSignal: string | null; terminationRequested: boolean; helperClosed: boolean;
}>;

/** Test-only runner. Injection is for Fake CLI tests, never a production request
 * or environment option. No observation or successful exit grants build trust. */
export function runCompilerObservation(cwd: string, execute: typeof execFile = execFile): Promise<ObservationRun> {
  return new Promise((resolve) => {
    let observation: CompilerObservation | null = null;
    let category = "helper-unavailable";
    let terminationRequested = false;
    let settled = false;
    let closeDeadline: ReturnType<typeof setTimeout> | undefined;
    const finish = (exitCode: number | null, exitSignal: string | null, helperClosed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(closeDeadline);
      resolve(Object.freeze({ category, observation, exitCode, exitSignal, terminationRequested, helperClosed }));
    };
    try {
      const child = execute("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
          Buffer.from(compilerObservationScript(), "utf16le").toString("base64")], {
          cwd, windowsHide: true, shell: false, timeout: 15000, maxBuffer: 16384, encoding: "utf8",
          env: { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows", PSModulePath: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules" },
        }, (error, stdout) => {
          if (settled) return;
          if (error) {
            terminationRequested = error.killed === true;
            category = terminationRequested ? "helper-termination-requested" : "helper-failed";
          } else {
            try { observation = parseCompilerObservation(Buffer.from(stdout, "utf8")); category = "observation-recorded"; }
            catch { category = "helper-output-rejected"; }
          }
        });
      // Separate drain ceiling. A transport detach never proves OS process exit.
      closeDeadline = setTimeout(() => {
        if (settled) return;
        category = "CLEANUP_BLOCKED"; observation = null;
        finish(null, null, false);
        child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy();
        child.unref();
      }, 20000);
      child.once("close", (code, signal) => { finish(code, signal, true); });
    } catch {
      category = "helper-start-failed";
      finish(null, null, false);
    }
  });
}
