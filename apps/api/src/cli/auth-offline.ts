import { connect } from "node:net";
import { pathToFileURL } from "node:url";
import { resolveManagerRoot } from "../config/bootstrap.js";
import { CredentialReader } from "../auth/credential-reader.js";
import { CredentialWriter } from "../auth/credential-writer.js";
import { ManagerLifetimeLock, LockOwnershipUnknownError } from "../auth/manager-lifetime-lock.js";
import { validPassword, validUsername } from "../auth/password.js";

type OfflineOptions = { action: "init" | "reset" | "recover"; username?: string; managerRoot: string };
export function parseOfflineOptions(argv: string[], env: NodeJS.ProcessEnv): OfflineOptions {
  if (Object.entries(env).some(([name, value]) => value !== undefined && /^MCSM_(?:AUTH_)?(?:PASSWORD|PASSWD|SECRET|CREDENTIAL|TOKEN)/iu.test(name))) throw new Error("OFFLINE_SECRET_SOURCE_REJECTED");
  const [action, ...args] = argv;
  if (!["init", "reset", "recover"].includes(action ?? "")) throw new Error("OFFLINE_ACTION_REQUIRED");
  let username: string | undefined; let root: string | undefined;
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]; const value = args[index + 1];
    if (value === undefined) throw new Error("OFFLINE_OPTIONS_REJECTED");
    if (key === "--username" && username === undefined && validUsername(value) && action !== "recover") username = value;
    else if (key === "--manager-root" && root === undefined) root = value;
    else throw new Error("OFFLINE_OPTIONS_REJECTED");
  }
  if (action !== "recover" && !username) throw new Error("OFFLINE_USERNAME_REQUIRED");
  return { action: action as OfflineOptions["action"], ...(username ? { username } : {}), managerRoot: resolveManagerRoot(root ?? env.MCSM_MANAGER_ROOT) };
}

export function readHiddenPassword(prompt: string, input = process.stdin, output = process.stdout): Promise<string> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") return Promise.reject(new Error("OFFLINE_TTY_REQUIRED"));
  const wasRaw = input.isRaw; input.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      input.off("data", data); input.off("end", ended); input.off("error", failed);
      input.setRawMode(wasRaw); input.pause(); output.write("\n");
      if (error) { value = ""; reject(error); } else { resolve(value); value = ""; }
    };
    const data = (chunk: string) => {
      const points = [...chunk];
      for (let index = 0; index < points.length; index++) {
        const point = points[index]!;
        if (point === "\r" || point === "\n") {
          if (index !== points.length - 1) { finish(new Error("OFFLINE_INPUT_REJECTED")); return; }
          finish(); return;
        }
        if (point === "\u007f" || point === "\b") value = [...value].slice(0, -1).join("");
        else if (/[\u0000-\u001f\u007f]/u.test(point)) { finish(new Error("OFFLINE_INPUT_CANCELLED")); return; }
        else value += point;
        if (value.length > 256 || Buffer.byteLength(value, "utf8") > 512) { finish(new Error("OFFLINE_INPUT_REJECTED")); return; }
      }
    };
    const ended = () => finish(new Error("OFFLINE_INPUT_CANCELLED"));
    const failed = () => finish(new Error("OFFLINE_INPUT_CANCELLED"));
    input.on("data", data); input.once("end", ended); input.once("error", failed);
    try { input.setRawMode(true); output.write(prompt); input.resume(); }
    catch { finish(new Error("OFFLINE_TTY_REQUIRED")); }
  });
}

/** Secondary legacy-binary check only. The native lifetime lock supplies stopped evidence. */
async function rejectLegacyListener(): Promise<void> {
  const listening = await new Promise<boolean>((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port: 8080 });
    socket.setTimeout(1000);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      socket.destroy(); if (error.code === "ECONNREFUSED") resolve(false); else reject(new Error("OFFLINE_STOP_STATE_UNKNOWN"));
    });
    socket.once("timeout", () => { socket.destroy(); reject(new Error("OFFLINE_STOP_STATE_UNKNOWN")); });
  });
  if (listening) throw new Error("OFFLINE_MANAGER_MUST_STOP");
}
export async function runOfflineAuth(argv = process.argv.slice(2), env = process.env): Promise<void> {
  const options = parseOfflineOptions(argv, env);
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("OFFLINE_TTY_REQUIRED");
  const lock = await ManagerLifetimeLock.acquire(options.managerRoot);
  try {
    await rejectLegacyListener();
    const writer = new CredentialWriter(options.managerRoot, lock);
    if (options.action === "recover") {
      const result = await writer.recover();
      process.stdout.write(result.outcome === "committed" ? "Private credential publication committed and verified.\n" : "Interrupted publication cancelled; verified prior credential preserved.\n");
      process.stdout.write("Authentication HTTP is not enabled by this command.\n"); return;
    }
    let revision: string | undefined;
    if (options.action === "reset") revision = (await (await CredentialReader.open(options.managerRoot)).read()).revision;
    let password = await readHiddenPassword("New password (hidden): ");
    let confirmation = "";
    try {
      confirmation = await readHiddenPassword("Repeat password (hidden): ");
      if (!validPassword(password, true) || password !== confirmation) throw new Error("OFFLINE_PASSWORD_REJECTED");
      await writer.publish(options.action, options.username!, password, revision);
      process.stdout.write("Private credential stored. Authentication HTTP is not enabled by this command.\n");
    } finally { password = ""; confirmation = ""; }
  } finally { await lock.release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runOfflineAuth().catch((error: unknown) => {
    process.stderr.write(error instanceof LockOwnershipUnknownError ? "Offline credential action stopped: native lock ownership is uncertain; this process must exit.\n" : "Offline credential action refused; no secret or private path was printed.\n");
    process.exit(1);
  });
}
