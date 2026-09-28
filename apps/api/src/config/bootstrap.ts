import path from "node:path";

import type { MinecraftServerAdapter } from "../adapters/contract.js";
import { LocalJavaAdapter } from "../adapters/local.js";
import type { RuntimeFactory } from "../infra/runtime-contract.js";
import { loadLocalRegistrations } from "./local-config.js";

export function resolveManagerRoot(configured: string | undefined): string {
  if (configured === undefined || configured.length === 0) {
    return path.resolve(import.meta.dirname, "../../../..", ".manager");
  }
  if (!path.isAbsolute(configured) || configured.startsWith("\\\\") || configured.startsWith("//")) {
    throw new Error("MCSM_MANAGER_ROOT must be an absolute local path.");
  }
  return path.resolve(configured);
}

export async function createLocalAdapters(
  managerRoot: string,
  runtimeFactory: RuntimeFactory
): Promise<MinecraftServerAdapter[]> {
  const registrations = await loadLocalRegistrations(managerRoot);
  return Promise.all(
    registrations.map(async (registration) =>
      new LocalJavaAdapter(registration, await runtimeFactory.create(registration.plan))
    )
  );
}
