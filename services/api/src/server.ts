import { createApp } from "./app";
import { pool } from "./db/pool";
import { env } from "./config/env";

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`bifrost-api listening on :${env.PORT}`);
});

// ECS/Fargate (and any orchestrator) sends SIGTERM before killing a container. Node won't stop
// accepting connections or close the pool on its own — skipping this risks exactly the kind of
// mid-flight-request data loss the idempotency design exists to prevent.
function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(async (err) => {
    if (err) {
      console.error(err);
      process.exitCode = 1;
    }
    await pool.end();
    process.exit();
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
