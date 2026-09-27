import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
neonConfig.webSocketConstructor = ws;
export interface RetainerDb {
  query(
    text: string,
    values?: any[],
  ): Promise<{ rows: any[]; rowCount?: number | null }>;
}
let pool: Pool | undefined;
let testDb:
  | (RetainerDb & {
      transaction<T>(fn: (db: RetainerDb) => Promise<T>): Promise<T>;
    })
  | undefined;
/** Isolated PostgreSQL test adapter; never enabled in the application runtime. */
export function setRetainerTestDatabase(db: typeof testDb) {
  if (process.env.NODE_ENV !== "test")
    throw new Error("Test database injection requires NODE_ENV=test");
  testDb = db;
}
export function retainerPool(): RetainerDb {
  if (testDb) return testDb;
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    pool.on("error", () =>
      console.error("[retainer-db] Idle connection failed"),
    );
  }
  return pool;
}
export async function retainerTransaction<T>(
  fn: (db: RetainerDb) => Promise<T>,
): Promise<T> {
  if (testDb) return testDb.transaction(fn);
  retainerPool();
  const db = await pool!.connect();
  try {
    await db.query("BEGIN");
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export function retainerError(message: string, status = 409): never {
  throw Object.assign(new Error(message), { status });
}
