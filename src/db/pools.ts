import { Pool } from "pg";
import { Kysely, PostgresDialect } from "kysely";
import type { Config } from "../config.js";

export interface Database {
  "core.services": {
    id: string;
    display_name: string;
    state: "active" | "disabled";
    created_at: Date;
    updated_at: Date;
  };
}

export function createPool(connectionString: string, max: number, name: string): Pool {
  return new Pool({
    connectionString,
    max,
    application_name: name,
    connectionTimeoutMillis: 1000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 1000,
    lock_timeout: 300,
    idle_in_transaction_session_timeout: 2000,
  });
}

export function createDatabase(config: Config) {
  const primary = createPool(config.databaseUrl, 3, "sm-core");
  const reader = createPool(config.readDatabaseUrl, 2, "sm-reader");
  const sql = new Kysely<Database>({ dialect: new PostgresDialect({ pool: primary }) });
  return {
    primary,
    reader,
    sql,
    async close() {
      await Promise.all([sql.destroy(), reader.end()]);
    },
  };
}

export type DatabaseResources = ReturnType<typeof createDatabase>;
