/** UNWIRED, strict proposed publisher-Name subset. This only compares a DER
 * Name supplied by the caller. It does not verify a certificate, signature,
 * issuer, chain, EKU, timestamp or compiler. Never use as build authority. */
const expected = new Map([
  ["550403", "Microsoft Corporation"], ["55040a", "Microsoft Corporation"],
  ["550407", "Redmond"], ["550408", "Washington"], ["550406", "US"],
]);
type Element = Readonly<{ tag: number; start: number; value: number; end: number }>;
const fail = (): never => { throw new Error("COMPILER_PUBLISHER_SUBJECT_UNSAFE"); };

/** Proposed narrow policy: exactly one EKU extension, containing only the
 * code-signing OID. Unknown/additional usages are unsupported, not ignored.
 * Caller must supply actual verified-leaf extension bytes, never display names. */
export function matchesCompiledCodeSigningEku(ekuExtensions: readonly Buffer[]): boolean {
  return Array.isArray(ekuExtensions) && ekuExtensions.length === 1 &&
    Buffer.isBuffer(ekuExtensions[0]) && ekuExtensions[0].equals(Buffer.from("300a06082b06010505070303", "hex"));
}

export function matchesCompiledPublisherSubject(input: Buffer): boolean {
  if (!Buffer.isBuffer(input) || input.length < 2 || input.length > 4096) return fail();
  const bytes = Buffer.from(input);
  const read = (offset: number, limit: number): Element => {
    const start = offset;
    if (offset + 2 > limit) return fail();
    const tag = bytes[offset++]!;
    // This schema has only one-byte tags and strict definite DER lengths.
    if ((tag & 31) === 31) return fail();
    let length = bytes[offset++]!;
    if ((length & 128) !== 0) {
      const count = length & 127;
      if (count < 1 || count > 2 || offset + count > limit || bytes[offset] === 0) return fail();
      length = 0;
      for (let index = 0; index < count; index++) length = length * 256 + bytes[offset++]!;
      if (length < 128 || (count === 2 && length < 256)) return fail();
    }
    if (offset + length > limit) return fail();
    return { tag, start, value: offset, end: offset + length };
  };
  const root = read(0, bytes.length);
  if (root.tag !== 0x30 || root.end !== bytes.length || root.value === root.end) return fail();
  let cursor = root.value;
  let count = 0;
  let matches = true;
  const seen = new Set<string>();
  while (cursor < root.end) {
    const rdn = read(cursor, root.end);
    if (rdn.tag !== 0x31 || rdn.value === rdn.end) return fail();
    let position = rdn.value;
    let previous: Buffer | undefined;
    let setCount = 0;
    while (position < rdn.end) {
      if (++count > 32 || ++setCount > 4) return fail();
      const attribute = read(position, rdn.end);
      if (attribute.tag !== 0x30) return fail();
      const encoded = bytes.subarray(attribute.start, attribute.end);
      if (previous && Buffer.compare(previous, encoded) >= 0) return fail();
      previous = encoded;
      const oid = read(attribute.value, attribute.end);
      if (oid.tag !== 6 || oid.end - oid.value < 1 || oid.end - oid.value > 32) return fail();
      // OID subidentifiers use minimal base128, including the combined first one.
      let atStart = true;
      for (let index = oid.value; index < oid.end; index++) {
        const octet = bytes[index]!;
        if (atStart && octet === 128) return fail();
        atStart = (octet & 128) === 0;
      }
      if (!atStart) return fail();
      const key = bytes.subarray(oid.value, oid.end).toString("hex");
      if (seen.has(key)) return fail();
      seen.add(key);
      const value = read(oid.end, attribute.end);
      if (value.end !== attribute.end || (value.tag !== 0x0c && value.tag !== 0x13) || value.end - value.value > 1024) return fail();
      const raw = bytes.subarray(value.value, value.end);
      // All allowed policy values are exact ASCII. No Unicode/display-string
      // normalization, case folding, whitespace trimming or decoded escapes.
      for (const octet of raw) if (octet < 32 || octet > 126) return fail();
      const text = raw.toString("ascii");
      if (value.tag === 0x13 && !/^[A-Za-z0-9 '()+,\-./:=?]*$/u.test(text)) return fail();
      if (!expected.has(key) || text !== expected.get(key)) matches = false;
      position = attribute.end;
    }
    cursor = rdn.end;
  }
  return matches && seen.size === expected.size;
}
