import { existsSync } from "node:fs";
import { createDatabase } from "./db/pools.js";
import { readConfig } from "./config.js";
import { readPlatformConfig } from "./platform-config.js";
import { Jobs } from "./jobs.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const database = createDatabase(readConfig());
const jobs = new Jobs(database.primary, database.reader, readPlatformConfig());
await jobs.start(true);
let stopping = false;
const stop = async () => { if (stopping) return; stopping = true; await jobs.stop(); await database.close(); };
process.once("SIGINT", () => { void stop(); });
process.once("SIGTERM", () => { void stop(); });
