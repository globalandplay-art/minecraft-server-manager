import type { ServerType } from "@mcsm/contracts";
import { describe, expect, it } from "vitest";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { LocalJavaAdapter } from "../src/adapters/local.js";
import type { ValidatedRegistration } from "../src/config/local-config.js";
import type { MinecraftRuntime } from "../src/infra/runtime-contract.js";

function adapterFor(type: ServerType) {
  const adapter = new LocalJavaAdapter({ plan: { serverInfo: { type } } } as unknown as ValidatedRegistration,
    {} as MinecraftRuntime);
  return adapter as LocalMinecraftServerAdapter;
}

describe("LocalJavaAdapter addon capabilities", () => {
  it.each([
    ["paper", false, true],
    ["fabric", true, false],
    ["vanilla", false, false],
    ["unknown", false, false],
    ["forge", false, false],
    ["neoforge", false, false]
  ] as const)("exposes only the addon capability for trusted type %s", async (type, mods, plugins) => {
    await expect(adapterFor(type).getCapabilities()).resolves.toMatchObject({ mods, plugins });
  });
});
