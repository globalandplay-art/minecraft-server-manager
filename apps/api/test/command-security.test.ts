import { describe, expect, it } from "vitest";

import { isReservedMinecraftCommand } from "../src/services/server-service.js";

describe("Minecraft command lifecycle boundary", () => {
  it.each([
    "stop",
    "/stop",
    "minecraft:restart",
    "execute as run run stop",
    "execute as @a run minecraft:save-all"
  ])("rejects reserved command %s", (command) => {
    expect(isReservedMinecraftCommand(command)).toBe(true);
  });

  it.each(["list", "say hello", "execute as @a run tellraw @s {\"text\":\"ready\"}"])(
    "allows non-lifecycle command %s",
    (command) => {
      expect(isReservedMinecraftCommand(command)).toBe(false);
    }
  );
});
