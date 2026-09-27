import { buildApp } from "./app.js";
import { API_HOST, API_PORT, assertMockMode } from "./config/runtime.js";

async function main(): Promise<void> {
  assertMockMode(process.env.MCSM_MODE);
  const app = buildApp({ logger: true });

  const close = async () => {
    await app.close();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);

  await app.listen({ host: API_HOST, port: API_PORT });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "API startup failed";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
