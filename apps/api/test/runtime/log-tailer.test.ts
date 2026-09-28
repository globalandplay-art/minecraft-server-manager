import { appendFile, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BoundedLogTailer } from "../../src/infra/runtime/log-tailer.js";
import { createRedactor } from "../../src/infra/runtime/redactor.js";

const temporaryDirectories: string[] = [];

async function temporaryLog(initial: Buffer | string = ""): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "mcsm-log-tailer-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "latest.log");
  await writeFile(path, initial);
  return { directory, path };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe("BoundedLogTailer", () => {
  it("preserves half-lines and split UTF-8 without duplicates", async () => {
    const encoded = Buffer.from("[Server/INFO] 你好世界\n", "utf8");
    const split = encoded.indexOf(Buffer.from("你", "utf8")) + 1;
    const { path } = await temporaryLog(encoded.subarray(0, split));
    const tailer = new BoundedLogTailer({ filePath: path, cursorPrefix: "test" });

    await tailer.pollNow();
    expect(tailer.recent()).toEqual([]);
    await appendFile(path, encoded.subarray(split));
    await tailer.pollNow();
    await tailer.pollNow();

    expect(tailer.recent()).toHaveLength(1);
    expect(tailer.recent()[0]).toMatchObject({
      level: "info",
      text: "[Server/INFO] 你好世界",
      source: "latest.log"
    });
  });

  it("handles truncation and file rotation without replaying old lines", async () => {
    const { directory, path } = await temporaryLog("[Server/INFO] first long line\n");
    const tailer = new BoundedLogTailer({ filePath: path, cursorPrefix: "rotate" });
    await tailer.pollNow();

    await writeFile(path, "new\n");
    await tailer.pollNow();
    await rename(path, join(directory, "latest.log.1"));
    await writeFile(path, "rotated\n");
    await tailer.pollNow();

    expect(tailer.recent().map((entry) => entry.text)).toEqual([
      "[Server/INFO] first long line",
      "new",
      "rotated"
    ]);
  });

  it("bounds lines and the ring while reporting cursor gaps", async () => {
    const { path } = await temporaryLog("123456789\ntwo\nthree\n");
    const tailer = new BoundedLogTailer({
      filePath: path,
      cursorPrefix: "bounded",
      maxLines: 2,
      maxLineBytes: 4,
      initialTailBytes: 100
    });
    await tailer.pollNow();

    expect(tailer.recent().map((entry) => entry.text)).toEqual(["two", "thre"]);
    expect(tailer.page("bounded:0", 200)).toMatchObject({ truncated: true });
    expect(tailer.page("bounded:1", 1)).toMatchObject({
      truncated: false,
      items: [{ text: "two" }]
    });
  });

  it("redacts latest.log and stderr before entries leave the tailer", async () => {
    const secret = "rcon-password-value";
    const { path } = await temporaryLog(`password=${secret}\n`);
    const tailer = new BoundedLogTailer({
      filePath: path,
      cursorPrefix: "redacted",
      redactor: createRedactor({ secrets: () => [secret] })
    });
    await tailer.pollNow();
    tailer.appendStderr(`token=abc ${secret}`);
    tailer.flushStderr();

    expect(tailer.recent()).toHaveLength(2);
    expect(tailer.recent().every((entry) => !entry.text.includes(secret))).toBe(true);
    expect(tailer.recent().map((entry) => entry.text).join(" ")).not.toContain("abc");
  });

  it("caps initial reads to a recent window and discards the first partial line", async () => {
    const { path } = await temporaryLog("old-one\nold-two\nnew-one\nnew-two\n");
    const tailer = new BoundedLogTailer({
      filePath: path,
      cursorPrefix: "initial",
      initialTailBytes: 18
    });
    await tailer.pollNow();

    expect(tailer.recent().map((entry) => entry.text)).toEqual(["new-one", "new-two"]);
  });
});
