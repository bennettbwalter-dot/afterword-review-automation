import pg, { type Pool as PgPool, type PoolClient } from "pg";
import { databaseTlsOptions } from "./database-tls.js";
import type { ActorContext } from "./types.js";

const { Pool } = pg;

export function createPool(connectionString: string, requireSsl = false, applicationName = "afterword-api") {
  return new Pool({
    connectionString,
    max: 12,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: databaseTlsOptions(requireSsl),
    application_name: applicationName,
  });
}

export async function inTransaction<T>(client: PoolClient, operation: () => Promise<T>) {
  await client.query("begin");
  try {
    const value = await operation();
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export async function setActorContext(client: PoolClient, actor: ActorContext) {
  await client.query(
    "select app_private.set_request_context_from_session($1, $2::uuid)",
    [actor.sessionTokenHash, actor.supportSessionId ?? null],
  );
  if (actor.supportSessionId) {
    await client.query(
      "select app_private.touch_support_session($1::uuid)",
      [actor.supportSessionId],
    );
  }
}

export async function withActorTransaction<T>(pool: PgPool, actor: ActorContext, operation: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    return await inTransaction(client, async () => {
      await setActorContext(client, actor);
      return operation(client);
    });
  } finally {
    client.release();
  }
}
