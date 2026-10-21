import { buildApp } from "./app.js";
import { createLocalAdapters, resolveManagerRoot } from "./config/bootstrap.js";
import { API_HOST, API_PORT, resolveMode } from "./config/runtime.js";
import { LocalRuntimeFactory } from "./infra/runtime/index.js";
import { JsonOperationStore } from "./services/operation-store.js";
import { TransactionJournalStore } from "./services/transaction-journal.js";
import { ActiveWorldStateStore } from "./services/active-world-state-store.js";
import { isLocalAdapter } from "./adapters/contract.js";
import { DomainError } from "./services/domain-errors.js";
import { ManagerLifetimeLock, LockOwnershipUnknownError } from "./auth/manager-lifetime-lock.js";
import { AuthCoreError } from "./auth/password.js";
import { initializeHttpAuthentication } from "./auth/bootstrap.js";
import { AccessPrivateStore } from "./services/access-private-store.js";
import { AccessOperationStore } from "./services/access-operation-store.js";
import { AccessOperationService } from "./services/access-operation-service.js";

async function main(): Promise<void> {
  const mode = resolveMode(process.env.MCSM_MODE);
  const importCleanup = process.env.MCSM_IMPORT_AUTO_CLEANUP;
  if (importCleanup !== undefined && !["true","false"].includes(importCleanup)) throw new Error("Invalid import cleanup option");
  const managerRoot = resolveManagerRoot(process.env.MCSM_MANAGER_ROOT);
  // Offline credential actions share this OS-owned exclusion before adapters/startup recovery.
  // Unsupported platforms retain legacy local runtime; the Windows offline CLI fails closed there.
  // Keep native handles until OS process exit, including any admitted background operation.
  const accessOwner = process.platform === "win32" ? await ManagerLifetimeLock.acquire(managerRoot) : undefined;
  let app: ReturnType<typeof buildApp> | undefined;
  let adapters: Awaited<ReturnType<typeof createLocalAdapters>> | undefined;
  let adapterCreationComplete = mode === "mock";
  try {
  const authentication = await initializeHttpAuthentication(managerRoot, process.env.MCSM_AUTH);
  let accessOperations = new AccessOperationService();
  if (accessOwner) {
    try {
      const privateAccess = await AccessPrivateStore.open(managerRoot, accessOwner);
      const accessStore = await AccessOperationStore.open(managerRoot, accessOwner);
      accessOperations = new AccessOperationService({ store: accessStore,
        configuration: async (provider) => (await privateAccess.read(provider))?.revision ?? null });
    } catch {
      // Access corruption blocks this resource only; local authentication/lifecycle remain available.
      accessOperations = new AccessOperationService({ blocked: true });
      process.stderr.write("Access initialization blocked: ACCESS_PRIVATE_UNSAFE.\n");
    }
  }
  const localRuntimeFactory = new LocalRuntimeFactory();
  adapters = mode === "mock" ? undefined : await createLocalAdapters(managerRoot, localRuntimeFactory);
  adapterCreationComplete = true;
  const localAdapters = adapters?.filter(isLocalAdapter) ?? [];
  const transactionJournal = mode === "local" ? new TransactionJournalStore(managerRoot) : undefined;
  app = buildApp({
    localRuntimeFactory,
    accessOperations,
    ...(authentication === undefined ? {} : { authentication }),
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

  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    try {
      await app!.close();
    } catch {
      process.stderr.write("API shutdown failed; manager lock is retained until this process exits.\n");
      process.exit(1);
    }
  })();
  process.once("SIGINT", close);
  process.once("SIGTERM", close);

  await app.listen({ host: API_HOST, port: API_PORT });
  } catch (error) {
    // Never release exclusion while a constructed app or adapter observer may remain live.
    if (app) await app.close();
    else if (!adapterCreationComplete) throw error; // Force process exit; partially created observers cannot be proven closed.
    else if (adapters) await Promise.all(adapters.filter(isLocalAdapter).map((adapter) => adapter.closeObserver()));
    throw error;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(error instanceof LockOwnershipUnknownError ? "API startup blocked: AUTH_LOCK_OWNERSHIP_UNKNOWN; owner process must exit.\n"
    : error instanceof AuthCoreError ? `API startup blocked: ${error.code}.\n`
    : error instanceof Error && error.message === "AUTH_HTTP_INTEGRATION_PENDING" ? "API startup blocked: AUTH_HTTP_INTEGRATION_PENDING; credentials require explicit authenticated mode and completed offline publication.\n"
    : error instanceof Error && error.message === "AUTH_PROFILE_INVALID" ? "API startup blocked: AUTH_PROFILE_INVALID.\n"
    : error instanceof DomainError && error.code === "RECOVERY_REQUIRED"
    ? `API startup blocked: RECOVERY_REQUIRED — ${error.safeMessage}\n`
    : "API startup failed; see safe application diagnostics.\n");
  process.exit(1);
});
