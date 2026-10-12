import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Bound concurrent native helpers and durable filesystem transactions on Windows.
    maxWorkers: 2,
    include: ["test/**/*.test.ts"],
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/main.ts"]
    }
  }
});
