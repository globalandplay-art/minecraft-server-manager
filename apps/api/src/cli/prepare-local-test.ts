import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";

import { resolveManagerRoot } from "../config/bootstrap.js";
import { loadLocalRegistrations } from "../config/local-config.js";
import {
  SERVER_PROPERTIES_LIMIT,
  parseProperties,
  readBoundedRegularFile,
  updatePropertiesText
} from "../config/properties.js";
import { probeMinecraftStatus } from "../infra/runtime/status-probe.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535 ? parsed : fallback;
}

const normalized = (value: string) =>
  process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);

async function main(): Promise<void> {
  const serverId = argument("--server-id");
  const apply = process.argv.includes("--apply");
  if (serverId === undefined) throw new Error("Usage: --server-id <registered-id> [--apply]");

  const managerRoot = resolveManagerRoot(process.env.MCSM_MANAGER_ROOT);
  const registrations = await loadLocalRegistrations(managerRoot);
  const registration = registrations.find((entry) => entry.plan.id === serverId);
  if (registration === undefined) throw new Error("Registered server not found");
  if (registration.plan.serverInfo.type !== "vanilla") throw new Error("Only Vanilla test setup is allowed");

  const propertiesPath = path.join(registration.plan.rootPath, "server.properties");
  const metadata = await lstat(propertiesPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Unsafe server.properties");
  if (normalized(await realpath(propertiesPath)) !== normalized(propertiesPath)) {
    throw new Error("Linked server.properties is not allowed");
  }
  const original = await readBoundedRegularFile(
    propertiesPath,
    SERVER_PROPERTIES_LIMIT,
    "server.properties"
  );
  const properties = parseProperties(original);
  const port = parsePort(properties.get("server-port"), 25_565);
  const probe = await probeMinecraftStatus({ host: "127.0.0.1", port }, 2_000);
  if (probe !== "stopped") throw new Error("Server must be reliably stopped before test setup");

  const rconPort = parsePort(properties.get("rcon.port"), 25_575);
  const preview = {
    mode: apply ? "apply" : "dry-run",
    serverId,
    stopped: true,
    changes: {
      "server-ip": "127.0.0.1",
      "enable-rcon": "true",
      "rcon.port": String(rconPort),
      "rcon.password": "<generated-43-character-secret>"
    },
    untouched: ["eula", "management-server-enabled", "enable-query"]
  };
  process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
  if (!apply) return;

  await registration.revalidateBeforeStart();

  const backupDirectory = path.join(managerRoot, "setup-backups", serverId);
  await mkdir(backupDirectory, { recursive: true });
  const backupPath = path.join(
    backupDirectory,
    `server.properties.${new Date().toISOString().replace(/[:.]/gu, "-")}.${randomUUID()}.bak`
  );
  await copyFile(propertiesPath, backupPath, constants.COPYFILE_EXCL);
  process.stdout.write("Original server.properties backup created in manager private data.\n");

  const password = randomBytes(32).toString("base64url");
  const updated = updatePropertiesText(original, {
    "server-ip": "127.0.0.1",
    "enable-rcon": "true",
    "rcon.port": String(rconPort),
    "rcon.password": password
  });
  const temporaryPath = path.join(registration.plan.rootPath, `.server.properties.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(updated, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    const currentMetadata = await lstat(propertiesPath);
    if (!currentMetadata.isFile() || currentMetadata.isSymbolicLink()) {
      throw new Error("server.properties changed during setup");
    }
    if (
      normalized(await realpath(registration.plan.rootPath)) !==
        normalized(registration.plan.rootPath) ||
      normalized(await realpath(propertiesPath)) !== normalized(propertiesPath) ||
      (await readBoundedRegularFile(
        propertiesPath,
        SERVER_PROPERTIES_LIMIT,
        "server.properties"
      )) !== original
    ) {
      throw new Error("server.properties changed during setup");
    }
    await rename(temporaryPath, propertiesPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
  process.stdout.write("Test setup applied; secret was generated and was not printed.\n");
}

main().catch(() => {
  process.stderr.write("Test setup failed; no secret or private path was printed.\n");
  process.exitCode = 1;
});
