import { ManagerLifetimeLock } from "../../src/auth/manager-lifetime-lock.js";
import { AuthCoreError } from "../../src/auth/password.js";

if (!process.argv[2] || !process.send) process.exit(2);
try {
  const owner = await ManagerLifetimeLock.acquire(process.argv[2]);
  await owner.release();
  process.send!({ result: "ACQUIRED", drained: true });
} catch (error) {
  if (error instanceof AuthCoreError && error.code === "AUTH_BUSY") process.send!({ result: "BUSY", drained: true });
  else { process.send!({ result: "UNKNOWN", drained: false }); process.exitCode = 1; }
}
process.disconnect();
