import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assertSafeRegistrationRoots,
  loadLocalRegistrations,
  parseLocalConfigDocument
} from "../src/config/local-config.js";
import { parseProperties, updatePropertiesText } from "../src/config/properties.js";
import { parseVersionMetadata } from "../src/services/detection-service.js";

describe("Java properties parser", () => {
  it("handles comments, escaped separators, unicode, continuation and last duplicate wins", () => {
    const properties = parseProperties([
      "  # comment",
      "escaped\\ key\\:part = first\\ value",
      "unicode=J\\u0061va\\u002025",
      "continued=alpha\\",
      "   beta\\",
      "\tgamma",
      "duplicate=old",
      "duplicate:new"
    ].join("\r\n"));

    expect(properties.get("escaped key:part")).toBe("first value");
    expect(properties.get("unicode")).toBe("Java 25");
    expect(properties.get("continued")).toBe("alphabetagamma");
    expect(properties.get("duplicate")).toBe("new");
  });

  it("rejects malformed unicode escapes", () => {
    expect(() => parseProperties("secret=bad\\u12xz")).toThrow("Unicode");
  });

  it("replaces only the last logical entry and preserves unrelated lines", () => {
    const original = [
      "# generated file",
      "rcon.password=old",
      "motd=hello\\",
      "  world",
      "rcon.password=last\\",
      "  value",
      "white-list=true",
      ""
    ].join("\r\n");
    const updated = updatePropertiesText(original, {
      "rcon.password": "new-secret",
      "enable-rcon": "true"
    });

    expect(updated).toContain("# generated file\r\n");
    expect(updated).toContain("rcon.password=old\r\n");
    expect(updated).toContain("motd=hello\\\r\n  world\r\n");
    expect(updated).toContain("rcon.password=new-secret\r\n");
    expect(updated).not.toContain("last\\");
    expect(updated).toContain("white-list=true\r\nenable-rcon=true\r\n");
  });
});

describe("local config allowlist", () => {
  const base = {
    id: "vanilla-test",
    name: "Vanilla test",
    root: "C:\\server",
    javaExecutable: "C:\\java\\java.exe",
    jarFile: "server.jar",
    jvmArgs: ["-Xms512M", "-Xmx2G"],
    serverArgs: ["nogui"]
  };

  it("accepts only the typed Phase 2 launch arguments", () => {
    expect(parseLocalConfigDocument(JSON.stringify({ schemaVersion: 1, servers: [base] }))).toHaveLength(1);
  });

  it.each([
    { ...base, jvmArgs: ["-Xms512M", "-jar"] },
    { ...base, jvmArgs: ["-Xms512M", "-javaagent:evil.jar"] },
    { ...base, jvmArgs: ["@args.txt", "-Xmx2G"] },
    { ...base, serverArgs: ["nogui", "--universe", "..\\outside"] },
    { ...base, jarFile: "..\\other.jar" }
  ])("rejects argument and launch-target bypasses", (server) => {
    expect(() =>
      parseLocalConfigDocument(JSON.stringify({ schemaVersion: 1, servers: [server] }))
    ).toThrow("配置无效");
  });

  it("rejects duplicate and nested canonical server roots", () => {
    expect(() =>
      assertSafeRegistrationRoots("C:\\manager", ["C:\\servers\\one", "C:\\servers\\one"])
    ).toThrow("本地配置无效");
    expect(() =>
      assertSafeRegistrationRoots("C:\\manager", ["C:\\servers\\one", "C:\\servers\\one\\child"])
    ).toThrow("本地配置无效");
  });

  it("rejects managerRoot inside a registered server root", () => {
    expect(() =>
      assertSafeRegistrationRoots("C:\\servers\\one\\.manager", ["C:\\servers\\one"])
    ).toThrow("本地配置无效");
  });

  it("does not mistake a contained directory beginning with two dots for an escape", () => {
    expect(() =>
      assertSafeRegistrationRoots("C:\\manager", ["C:\\servers\\root", "C:\\servers\\root\\..manager"])
    ).toThrow();
  });

  it("does not confuse sibling server roots with nesting", () => {
    expect(() =>
      assertSafeRegistrationRoots("C:\\manager", ["C:\\servers\\one", "C:\\servers\\one-copy"])
    ).not.toThrow();
  });

  it("keeps a missing manager root equivalent to an empty registration set", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "mcsm-missing-manager-"));
    const missing = path.join(parent, "not-created");
    try {
      await expect(loadLocalRegistrations(missing)).resolves.toEqual([]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

describe("version metadata", () => {
  it("accepts the numeric Java major used by Minecraft 26.3", () => {
    expect(parseVersionMetadata(JSON.stringify({ id: "26.3", java_version: 25 }))).toEqual({
      minecraftVersion: "26.3",
      requiredMajor: 25
    });
  });

  it("retains compatibility with object-shaped Java metadata", () => {
    expect(
      parseVersionMetadata(JSON.stringify({ id: "1.21.1", java_version: { majorVersion: 21 } }))
    ).toEqual({ minecraftVersion: "1.21.1", requiredMajor: 21 });
  });
});
