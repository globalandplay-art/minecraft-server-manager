import { DomainError } from "./domain-errors.js";
import { safeRestorePath } from "./restore-files.js";
import { orderedActivationHistory } from "./world-activation-history.js";
import type { TransactionJournalRecord } from "./transaction-journal.js";

/** Historical catalog/path-bound directory identity. This is NOT the rename-
 * stable staged directoryObjectIdentity; original replacement checkpoints must
 * independently prove that object and its containment before normalization.
 */
export type TransitionWorld = Readonly<{ worldId: string; levelName: string; directoryIdentity: string }>;
export type WorldTransitionGenesis = Readonly<{ serverId: string; catalogId: string; rootIdentity: string;
  activeWorldId: string; worlds: readonly TransitionWorld[] }>;
/** Normalized structural evidence, not a replacement journal schema or authority.
 * Future journal readers must verify the original record/checkpoints and supply
 * the staged object identity. No producer/executor is enabled by this module.
 */
export type WorldTransitionEvent = Readonly<{
  kind: "activation" | "replacement";
  serverId: string; transactionId: string; operationId: string; guardBackupId: string;
  rootIdentity: string; catalogId: string; sequence: number; predecessorTransactionId: string | null;
  previous: TransitionWorld; next: TransitionWorld;
}>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const worldId = /^worldv2-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const hash = /^[0-9a-f]{64}$/u;
const invalid = () => new DomainError(409, "RECOVERY_REQUIRED", "World transition history requires inspection", "world-transition-history-unverified", true);
const nameKey = (name: string) => name.normalize("NFC").toLowerCase();
const validWorld = (world: TransitionWorld) => world && worldId.test(world.worldId) && hash.test(world.directoryIdentity) &&
  typeof world.levelName === "string" && world.levelName.length >= 1 && world.levelName.length <= 128 &&
  world.levelName.normalize("NFC") === world.levelName && !world.levelName.startsWith(".") &&
  !world.levelName.includes("/") && safeRestorePath(world.levelName);

/** Compatibility projection only: old source-guard/chain checks run first.
 * The original schema1/2 journal bytes and head digest remain authoritative;
 * callers may not use these normalized events to replace their verification.
 */
export function activationTransitionEvents(serverId: string, records: readonly TransactionJournalRecord[]): WorldTransitionEvent[] {
  if (records.some(record => record.intent.serverId === serverId &&
      ((record.intent.kind as string) === "world-replace" || "worldReplacement" in record.intent))) throw invalid();
  return orderedActivationHistory(serverId, records).map(record => {
    const value = record.intent.worldActivation!;
    return { kind: "activation", serverId, transactionId: record.transactionId.toLowerCase(), operationId: record.intent.operationId.toLowerCase(),
      guardBackupId: value.guardBackupId.toLowerCase(), rootIdentity: value.rootIdentity, catalogId: value.catalogId.toLowerCase(),
      sequence: value.sequence, predecessorTransactionId: value.predecessorTransactionId?.toLowerCase() ?? null,
      previous: { worldId: value.previousWorldId, levelName: value.previousName, directoryIdentity: value.currentDirectoryIdentity },
      next: { worldId: value.worldId, levelName: value.nextName, directoryIdentity: value.targetDirectoryIdentity } };
  });
}

/** Projects explicit retirement without weakening historical name/ID bindings.
 * Does not read files, accept active state, clear locks or verify any snapshot.
 * The durable head and exact journal set must additionally bind this projection.
 */
export function projectWorldTransitions(serverId: string, input: readonly WorldTransitionEvent[]) {
  return projectTransitions(serverId, input);
}

/** Pure structural projection from independently verified genesis metadata.
 * Not a journal verifier, filesystem proof, catalog migration or ready permit.
 * Generation is the initial state, never an invented activation event. */
export function projectWorldTransitionsFromGenesis(serverId: string, input: readonly WorldTransitionEvent[], genesis: WorldTransitionGenesis) {
  if (!genesis || genesis.serverId !== serverId || !uuid.test(genesis.catalogId) || !hash.test(genesis.rootIdentity) ||
      !worldId.test(genesis.activeWorldId) || !Array.isArray(genesis.worlds) || genesis.worlds.length !== 2 ||
      genesis.worlds.some(world => !validWorld(world)) ||
      new Set(genesis.worlds.map(world => world.worldId)).size !== genesis.worlds.length ||
      !genesis.worlds.some(world => world.worldId === genesis.activeWorldId)) throw invalid();
  return projectTransitions(serverId, input, genesis);
}

function projectTransitions(serverId: string, input: readonly WorldTransitionEvent[], genesis?: WorldTransitionGenesis) {
  if (!Array.isArray(input) || input.length > 10_000) throw invalid();
  if (input.some(event => !event || typeof event !== "object" || !Number.isSafeInteger(event.sequence))) throw invalid();
  // Do not silently ignore another server: an exact scoped history is required.
  const history = [...input].sort((a, b) => a.sequence - b.sequence);
  const transactions = new Set<string>(), operations = new Set<string>(), guards = new Set<string>();
  const worlds = new Map<string, TransitionWorld>(), liveNames = new Map<string, string>();
  const directoryOwners = new Map<string, string>(), retired = new Set<string>();
  const first = history[0];
  const bind = (world: TransitionWorld) => {
    const known = worlds.get(world.worldId), key = nameKey(world.levelName);
    if ((known && (known.levelName !== world.levelName || known.directoryIdentity !== world.directoryIdentity)) ||
        retired.has(world.worldId) || (liveNames.has(key) && liveNames.get(key) !== world.worldId) ||
        (directoryOwners.has(world.directoryIdentity) && directoryOwners.get(world.directoryIdentity) !== world.worldId)) throw invalid();
    worlds.set(world.worldId, { ...world }); liveNames.set(key, world.worldId);
    directoryOwners.set(world.directoryIdentity, world.worldId);
  };
  if (genesis) for (const world of genesis.worlds) bind(world);
  for (const [index, event] of history.entries()) {
    const previousEvent = history[index - 1];
    if (event.serverId !== serverId || !["activation", "replacement"].includes(event.kind) ||
        !uuid.test(event.transactionId) || !uuid.test(event.operationId) || !uuid.test(event.guardBackupId) ||
        !uuid.test(event.catalogId) || !hash.test(event.rootIdentity) || !validWorld(event.previous) || !validWorld(event.next) ||
        !Number.isSafeInteger(event.sequence) || event.sequence !== index + 1 ||
        event.rootIdentity !== first!.rootIdentity || event.catalogId !== first!.catalogId ||
        (genesis && (event.rootIdentity !== genesis.rootIdentity || event.catalogId !== genesis.catalogId ||
          (index === 0 && event.previous.worldId !== genesis.activeWorldId))) ||
        transactions.has(event.transactionId) || operations.has(event.operationId) || guards.has(event.guardBackupId) ||
        event.previous.worldId === event.next.worldId ||
        (previousEvent ? event.predecessorTransactionId !== previousEvent.transactionId ||
          event.previous.worldId !== previousEvent.next.worldId : event.predecessorTransactionId !== null)) throw invalid();
    transactions.add(event.transactionId); operations.add(event.operationId); guards.add(event.guardBackupId);
    bind(event.previous);
    if (event.kind === "replacement") {
      // An explicit replacement alone may release a live name. The retired ID,
      // old name and old object identity remain permanently in historical maps.
      if (event.previous.levelName !== event.next.levelName || worlds.has(event.next.worldId) ||
          event.previous.directoryIdentity === event.next.directoryIdentity) throw invalid();
      retired.add(event.previous.worldId); liveNames.delete(nameKey(event.previous.levelName));
    }
    bind(event.next);
  }
  return { activeWorldId: history.at(-1)?.next.worldId ?? genesis?.activeWorldId ?? null,
    retiredWorldIds: [...retired], worlds: [...worlds.values()].map(world => ({ ...world, state: retired.has(world.worldId) ? "retired" as const : "present" as const })),
    transactionIds: history.map(event => event.transactionId) };
}
