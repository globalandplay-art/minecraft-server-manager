import { ManagerLifetimeLock } from "../../../src/auth/manager-lifetime-lock.js";

try {
  const lock = await ManagerLifetimeLock.acquire(process.argv[2]!);
  process.stdout.write("LOCKED\n");
  process.stdin.resume();
  process.stdin.once("data", async () => {
    try { await lock.release(); process.stdout.write("RELEASED\n"); process.exit(0); }
    catch { process.exit(3); }
  });
} catch (error) {
  process.stdout.write(error instanceof Error ? error.message + "\n" : "FAILED\n");
  process.exit(2);
}
