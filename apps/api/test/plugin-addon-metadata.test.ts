import { expect, it } from "vitest";
import { parsePluginAddonMetadata } from "../src/services/plugin-addon-metadata.js";
const parse = (text: string) => parsePluginAddonMetadata(Buffer.from(text));
it("reads inert strings without claiming Minecraft compatibility", () => {
  expect(parse("name: Demo\nversion: '1.0'\nmain: example.Plugin\napi-version: '26.2'"))
    .toEqual({ name: "Demo", version: "1.0", loader: "paper", apiVersion: "26.2", compatibility: "unknown" });
});
it.each(["name: &x Demo", "name: *x", "!!js/function function(){}", "name: Demo\nname: Other", "- Demo", "name: ../path", "name: Demo\nversion: 1", "name: Demo\nversion: 1\nmain: shell command", "name: Demo\nversion: 1\nmain: example.Plugin\n---\nname: Other"])("rejects unsafe/invalid metadata %s", (text) => expect(parse(text)).toBeNull());
it("rejects oversized and invalid UTF8 metadata", () => {
  expect(parse("x".repeat(256 * 1024 + 1))).toBeNull();
  expect(parsePluginAddonMetadata(Buffer.from([0xff]))).toBeNull();
});
it("rejects complex YAML keys rather than coercing them into required string fields", () => {
  expect(parse("? [name]\n: Demo\nversion: '1.0'\nmain: example.Plugin")).toBeNull();
  expect(parse("{[name]: Demo, version: '1.0', main: example.Plugin}")).toBeNull();
  expect(parse("? name\n: Demo\nversion: '1.0'\nmain: example.Plugin")).toBeNull();
});
