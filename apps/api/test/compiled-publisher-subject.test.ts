import { describe, expect, it } from "vitest";
import { matchesCompiledCodeSigningEku, matchesCompiledPublisherSubject } from "./fixtures/compiled-publisher-subject.js";

const tlv = (tag: number, bytes: Buffer) => Buffer.concat([Buffer.from([tag, bytes.length]), bytes]);
const attribute = (oid: string, text: string, tag = 0x0c) => tlv(0x30,
  Buffer.concat([tlv(6, Buffer.from(oid, "hex")), tlv(tag, Buffer.from(text, "utf8"))]));
const fields = () => [["550406", "US"], ["550408", "Washington"], ["550407", "Redmond"],
  ["55040a", "Microsoft Corporation"], ["550403", "Microsoft Corporation"]] as const;
const subject = (values: readonly (readonly [string, string])[] = fields()) => {
  const data = Buffer.concat(values.map(([oid, text]) => tlv(0x31, attribute(oid, text))));
  return data.length < 128 ? tlv(0x30, data) : Buffer.concat([Buffer.from([0x30, 0x81, data.length]), data]);
};

describe("proposed strict publisher DER Name subset, not trust", () => {
  it("matches exact values without depending on RDN order", () => {
    expect(matchesCompiledPublisherSubject(subject())).toBe(true);
    expect(matchesCompiledPublisherSubject(subject([...fields()].reverse()))).toBe(true);
  });
  it.each(["microsoft Corporation", "Microsoft Corporation ", "Microsoft Corporation, CN=Other", "Other Publisher"])("rejects a different exact organization: %s", (name) => {
    const values = fields().map(([oid, text]) => [oid, oid === "55040a" ? name : text] as const);
    expect(matchesCompiledPublisherSubject(subject(values))).toBe(false);
  });
  it("rejects missing and unknown subject attributes", () => {
    expect(matchesCompiledPublisherSubject(subject(fields().slice(1)))).toBe(false);
    expect(matchesCompiledPublisherSubject(subject([...fields(), ["55040b", "Other"]]))).toBe(false);
  });
  it("rejects duplicate attributes rather than selecting a favorable one", () => {
    expect(() => matchesCompiledPublisherSubject(subject([...fields(), ["55040a", "Microsoft Corporation"]]))).toThrow("COMPILER_PUBLISHER_SUBJECT_UNSAFE");
  });
  it.each([Buffer.from([0x30, 0x80, 0, 0]), Buffer.from([0x30, 0x81, 0]), Buffer.from([0x30, 0]), Buffer.from([0x30, 2, 0x31, 0]), Buffer.from([0x30, 0x82, 0, 128]), Buffer.alloc(4097)])("rejects invalid or unbounded DER", (bytes) => {
    expect(() => matchesCompiledPublisherSubject(bytes)).toThrow("COMPILER_PUBLISHER_SUBJECT_UNSAFE");
  });
  it("rejects truncated and trailing bytes", () => {
    const bytes = subject();
    expect(() => matchesCompiledPublisherSubject(bytes.subarray(0, -1))).toThrow();
    expect(() => matchesCompiledPublisherSubject(Buffer.concat([bytes, Buffer.from([0])]))).toThrow();
  });
  it("rejects nonminimal and unfinished OID subidentifiers", () => {
    for (const oid of ["80550403", "5580"]) {
      expect(() => matchesCompiledPublisherSubject(subject([[oid, "Microsoft Corporation"]]))).toThrow();
    }
  });
  it("rejects unsupported string encodings and non-ASCII identity tricks", () => {
    const bmp = tlv(0x30, tlv(0x31, attribute("550403", "Microsoft Corporation", 0x1e)));
    expect(() => matchesCompiledPublisherSubject(bmp)).toThrow();
    expect(() => matchesCompiledPublisherSubject(subject([["550403", "Mіcrosoft Corporation"]]))).toThrow();
  });
  it("accepts PrintableString without normalizing it", () => {
    const data = Buffer.concat(fields().map(([oid, text]) => tlv(0x31, attribute(oid, text, 0x13))));
    const bytes = data.length < 128 ? tlv(0x30, data) : Buffer.concat([Buffer.from([0x30, 0x81, data.length]), data]);
    expect(matchesCompiledPublisherSubject(bytes)).toBe(true);
  });
  it("requires canonical SET order and rejects duplicate OIDs in a multivalue RDN", () => {
    const attributes = [attribute("550403", "Microsoft Corporation"), attribute("55040a", "Microsoft Corporation")].sort(Buffer.compare);
    const others = fields().filter(([oid]) => oid !== "550403" && oid !== "55040a").map(([oid, text]) => tlv(0x31, attribute(oid, text)));
    const pack = (values: Buffer[]) => {
      const data = Buffer.concat([tlv(0x31, Buffer.concat(values)), ...others]);
      return data.length < 128 ? tlv(0x30, data) : Buffer.concat([Buffer.from([0x30, 0x81, data.length]), data]);
    };
    expect(matchesCompiledPublisherSubject(pack(attributes))).toBe(true);
    expect(() => matchesCompiledPublisherSubject(pack([...attributes].reverse()))).toThrow();
    expect(() => matchesCompiledPublisherSubject(pack([attributes[0]!, attributes[0]!]))).toThrow();
  });
  it("requires exactly one unambiguous code-signing-only EKU extension", () => {
    const valid = Buffer.from("300a06082b06010505070303", "hex");
    expect(matchesCompiledCodeSigningEku([valid])).toBe(true);
    for (const extensions of [[], [valid, valid], [Buffer.from("3000", "hex")],
      [Buffer.from("300406025500", "hex")], [Buffer.concat([valid, Buffer.from([0])])],
      [Buffer.from("301406082b0601050507030306082b06010505070303", "hex")]]) {
      expect(matchesCompiledCodeSigningEku(extensions)).toBe(false);
    }
  });
});
