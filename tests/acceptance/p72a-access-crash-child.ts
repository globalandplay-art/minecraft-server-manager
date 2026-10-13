import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ManagerLifetimeLock } from "../../apps/api/src/auth/manager-lifetime-lock.js";
import { createPrivateEntry, writePrivateNew, publishPrivateStageNew } from "../../apps/api/src/auth/private-publication.js";
import { WindowsPrivateAclVerifier } from "../../apps/api/src/auth/windows-private-acl.js";
import { AccessOperationStore } from "../../apps/api/src/services/access-operation-store.js";
import { AccessOperationService } from "../../apps/api/src/services/access-operation-service.js";
import { FakeAccessAdapter } from "../../apps/api/test/access-operation-fixture.js";

// Dedicated isolated test process: never constructed by production or HTTP inputs.
const [root, mode, boundary, revision, key] = process.argv.slice(2);
if (!root || !mode || !revision || !key || !process.send) throw new Error("FIXTURE_ARGUMENTS");
let owner: ManagerLifetimeLock | undefined;
try {
  owner = await ManagerLifetimeLock.acquire(root);
  const acl = new WindowsPrivateAclVerifier(); const adapter = new FakeAccessAdapter(); adapter.revision = revision;
  const effect = path.join(root, "fixture-effect.json");
  try { adapter.states = new Map(JSON.parse(await readFile(effect, "utf8"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const originalApply = adapter.apply.bind(adapter);
  adapter.apply = async (intent) => { await originalApply(intent); await writeFile(effect, JSON.stringify([...adapter.states]), { flag: "wx" }); };
  const publication = { createDirectory: (file: string) => createPrivateEntry(file, true, acl),
    writeNew: (file: string, bytes: Buffer) => writePrivateNew(file, bytes, acl),
    publishNew: async (stage: string, target: string) => {
      await publishPrivateStageNew(stage, target);
      const match = /\.([0-9]{4})\.json$/u.exec(target);
      if (mode === "run" && match?.[1] === boundary) {
        process.send!({ kind: "boundary", boundary });
        setInterval(() => {}, 1000);
        await new Promise<void>(() => {});
      }
    } };
  const store = await AccessOperationStore.open(root, owner, acl, publication);
  const service = new AccessOperationService({ store, adapter, configuration: async () => revision });
  await service.initialize();
  if (mode === "run") await service.submit("tailscale", "enable", { revision, confirm: true }, key, () => {});
  else {
    const chains = await store.scan(); const id = chains[0]![0]!.operation.id;
    const before = await service.get(id);
    const replay = await service.submit("tailscale", "enable", { revision, confirm: true }, key, () => {});
    const after = mode === "recover" ? await service.recover(id, { revision, confirm: true }, () => {}) : before;
    process.send({ kind: "result", before: before.state, after: after.state, replayId: replay.id === id, applyCalls: adapter.calls });
  }
  await service.close(); await owner.release(); owner = undefined;
} catch (error) {
  process.send!({ kind: "failure", code: typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : "NO_EXPLICIT_ERROR_CODE" });
  process.exitCode = 1;
} finally { if (owner) await owner.release(); }
