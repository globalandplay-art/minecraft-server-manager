export interface WorldVersionObservation {
  readable: boolean;
  version: string | null;
  dataVersion: number | null;
}

/** Storage locations observed in the authorized 26.3/5023 fresh-world run.
 * This is a layout allowlist, never a claim of successful Minecraft loading.
 * Unknown/custom dimensions and mixed legacy/namespaced storage stay closed.
 */
export function supportsVanillaWorldLayout(files: readonly { path: string }[], metadata: WorldVersionObservation): boolean {
  if (!metadata.readable || metadata.version !== "26.3" || metadata.dataVersion === null ||
      !Number.isSafeInteger(metadata.dataVersion) || metadata.dataVersion < 0) return false;
  const namespaced = files.filter(file => file.path.toLowerCase().startsWith("dimensions/"));
  if (!namespaced.length) return true;
  if (metadata.dataVersion !== 5023 || namespaced.some(file =>
    !/^dimensions\/minecraft\/(?:overworld|the_nether|the_end)\//u.test(file.path))) return false;
  return !files.some(file => /^(?:region|entities|poi|DIM-1|DIM1)\//iu.test(file.path));
}

export type CompatibilityFinding =
  | "WORLD_METADATA_UNREADABLE"
  | "WORLD_PROFILE_UNVERIFIED"
  | "WORLD_VERSION_UNKNOWN"
  | "WORLD_VERSION_UNVERIFIED"
  | "WORLD_DATA_VERSION_UNKNOWN"
  | "WORLD_DATA_VERSION_NEWER"
  | "WORLD_DATA_VERSION_DIFFERENT";

export interface WorldCompatibility {
  status: "compatible" | "warning" | "blocked" | "unknown";
  findings: CompatibilityFinding[];
  /** Always false: preflight cannot establish that Minecraft can load a world. */
  loadVerified: false;
}

/** Pure policy over trusted backend observations; never accepts browser claims. */
export function assessWorldCompatibility(
  source: WorldVersionObservation,
  target: { serverType: string; version: string | null; dataVersion: number | null }
): WorldCompatibility {
  const result = (status: WorldCompatibility["status"], ...findings: CompatibilityFinding[]): WorldCompatibility =>
    ({ status, findings, loadVerified: false });
  if (!source.readable) return result("blocked", "WORLD_METADATA_UNREADABLE");
  if (target.serverType !== "vanilla" || target.version !== "26.3") {
    return result("unknown", "WORLD_PROFILE_UNVERIFIED");
  }
  if (!source.version) return result("unknown", "WORLD_VERSION_UNKNOWN");
  const validDataVersion = (value: number | null): value is number =>
    value !== null && Number.isSafeInteger(value) && value >= 0;
  if (validDataVersion(source.dataVersion) && validDataVersion(target.dataVersion)
      && source.dataVersion > target.dataVersion) {
    return result("blocked", "WORLD_DATA_VERSION_NEWER");
  }
  // No lexicographic version comparison and no implicit conversion of older worlds.
  if (source.version !== target.version) return result("unknown", "WORLD_VERSION_UNVERIFIED");
  if (!validDataVersion(source.dataVersion) || !validDataVersion(target.dataVersion)) {
    return result("unknown", "WORLD_DATA_VERSION_UNKNOWN");
  }
  if (source.dataVersion !== target.dataVersion) return result("unknown", "WORLD_DATA_VERSION_DIFFERENT");
  return result("compatible");
}
