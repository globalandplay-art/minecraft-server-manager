import { buildApp } from "./app.js";
import { createLocalAdapters, resolveManagerRoot } from "./config/bootstrap.js";
import { API_HOST, API_PORT, resolveMode } from "./config/runtime.js";
import { LocalRuntimeFactory } from "./infra/runtime/index.js";
import { JsonOperationStore } from "./services/operation-store.js";
import { TransactionJournalStore } from "./services/transaction-journal.js";
import { ActiveWorldStateStore } from "./services/active-world-state-store.js";
import { isLocalAdapter } from "./adapters/contract.js";

async function main(): Promise<void> {
  const mode = resolveMode(process.env.MCSM_MODE);
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

main().catch(() => {
  process.stderr.write("API startup failed; see safe application diagnostics.\n");
  process.exitCode = 1;
});
