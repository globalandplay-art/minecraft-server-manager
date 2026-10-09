import { execFile } from "node:child_process";
import path from "node:path";
import { AuthCoreError } from "./password.js";

/** Trusted fixed scripts only. Values must be encoded as data by the caller. */
export async function runWindowsNativeScript(script: string): Promise<unknown> {
  if (process.platform !== "win32") throw new AuthCoreError("AUTH_PRIVATE_UNSAFE");
  const executable = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const output = await new Promise<string>((resolve, reject) => {
    execFile(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      { windowsHide: true, timeout: 15_000, maxBuffer: 16 * 1024, encoding: "utf8" },
      (error, stdout) => error ? reject(new AuthCoreError("AUTH_PRIVATE_UNSAFE")) : resolve(stdout));
  });
  try { return JSON.parse(output.replace(/^\uFEFF/u, "")); }
  catch { throw new AuthCoreError("AUTH_PRIVATE_UNSAFE"); }
}
export const nativePathData = (file: string) => `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(file, "utf8").toString("base64")}'))`;
