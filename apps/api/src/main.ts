import { buildApp } from "./app.js";
import { createLocalAdapters, resolveManagerRoot } from "./config/bootstrap.js";
import { API_HOST, API_PORT, resolveMode } from "./config/runtime.js";
import { LocalRuntimeFactory } from "./infra/runtime/index.js";
import { JsonOperationStore } from "./services/operation-store.js";
import { TransactionJournalStore } from "./services/transaction-journal.js";
import { ActiveWorldStateStore } from "./services/active-world-state-store.js";
import { isLocalAdapter } from "./adapters/contract.js";
import { DomainError } from "./services/domain-errors.js";

async function main(): Promise<void> {
  const mode = resolveMode(process.env.MCSM_MODE);
  const importCleanup = process.env.MCSM_IMPORT_AUTO_CLEANUP;
  if (importCleanup !== undefined && !["true","false"].includes(importCleanup)) throw new Error("Invalid import cleanup option");
  const managerRoot = resolveManagerRoot(process.env.MCSM_MANAGER_ROOT);
  const adapters =
    mode === "mock" ? undefined : await createLocalAdapters(managerRoot, new LocalRuntimeFactory());
  const localAdapters = adapters?.filter(isLocalAdapter) ?? [];
  const transactionJournal = mode === "local" ? new TransactionJournalStore(managerRoot) : undefined;
  const app = buildApp({
    logger: {
      level: "info",
      serializers: {
        req: (request) => ({ method: request.method })
      }
    },
    mode,
    importAutomaticCleanup: importCleanup === "true",
    ...(adapters === undefined ? {} : { adapters }),
    operationStore: new JsonOperationStore(managerRoot),
    ...(mode === "local" ? {
      transactionRecovery: transactionJournal!,
      transactionJournal: transactionJournal!,
      managerRoot,
      activeWorldState: new ActiveWorldStateStore(managerRoot, localAdapters)
    } : {})
  });

  const close = async () => {
    await app.close();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);

  await app.listen({ host: API_HOST, port: API_PORT });
}

main().catch((error: unknown) => {
  process.stderr.write(error instanceof DomainError && error.code === "RECOVERY_REQUIRED"
    ? `API startup blocked: RECOVERY_REQUIRED — ${error.safeMessage}\n`
    : "API startup failed; see safe application diagnostics.\n");
  process.exitCode = 1;
});
