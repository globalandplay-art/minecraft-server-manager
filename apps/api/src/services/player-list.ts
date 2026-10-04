/** Only the complete, bounded Vanilla English `list` response is verified. */
export function parsePlayerList(output: string): string[] | null {
  if (Buffer.byteLength(output, "utf8") > 200_000) return null;
  const match = /^There are (\d{1,5}) of a max of (\d{1,5}) players online: ?([^\r\n]*)$/u.exec(output.trim());
  if (!match) return null;
  const online = Number(match[1]);
  const maximum = Number(match[2]);
  if (maximum < 1 || maximum > 10000 || online > maximum) return null;
  const names = match[3] === "" ? [] : match[3]!.split(", ");
  if (names.length !== online || names.some((name) => !/^[A-Za-z0-9_]{1,16}$/u.test(name)) ||
    new Set(names.map((name) => name.toLowerCase())).size !== names.length) return null;
  return names;
}
