/**
 * In-process stand-in for the Kysely `db` instance.
 *
 * Real Kysely, real query compiler -- only the driver is fake. Every
 * query the code under test builds is compiled to real Postgres SQL and
 * recorded, and results come from responders the test registers. So the
 * tests exercise the actual query construction (filters, columns, params)
 * without needing a database, and no test ever touches a real one.
 *
 * Unmatched queries return zero rows, which is what the auth middleware
 * needs by default (not banned, no restriction, IP log insert is a no-op).
 */
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from "kysely"
import type { Database } from "../../src/db/index.js"

export interface RecordedQuery {
  sql: string
  parameters: readonly unknown[]
}

interface Responder {
  match: RegExp
  rows: unknown[]
  numAffectedRows: bigint
}

export function createFakeDb() {
  const queries: RecordedQuery[] = []
  let responders: Responder[] = []

  const connection: DatabaseConnection = {
    async executeQuery(compiled): Promise<QueryResult<any>> {
      const query = { sql: compiled.sql, parameters: compiled.parameters }
      queries.push(query)
      const hit = responders.find((r) => r.match.test(query.sql))
      return {
        rows: hit?.rows ?? [],
        numAffectedRows: hit?.numAffectedRows ?? 0n,
      }
    },
    // eslint-disable-next-line require-yield
    async *streamQuery() {
      throw new Error("streamQuery is not supported by the fake db")
    },
  }

  const driver: Driver = {
    async init() {},
    async acquireConnection() {
      return connection
    },
    async beginTransaction() {},
    async commitTransaction() {},
    async rollbackTransaction() {},
    async releaseConnection() {},
    async destroy() {},
  }

  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })

  return {
    db,
    queries,

    /** Answer queries whose SQL matches `match` (first registered wins). */
    when(match: RegExp, rows: unknown[] = [], numAffectedRows = 0n) {
      responders.push({ match, rows, numAffectedRows })
    },

    reset() {
      queries.length = 0
      responders = []
    },

    /** Recorded queries whose SQL matches. */
    find(match: RegExp) {
      return queries.filter((q) => match.test(q.sql))
    },

    /**
     * Column -> value map for an INSERT (Kysely parameterizes every
     * value, so columns and $n params line up positionally).
     */
    insertedValues(query: RecordedQuery): Record<string, unknown> {
      const cols = /\(([^)]+)\) values/.exec(query.sql)?.[1]
      if (!cols) throw new Error(`Not an INSERT: ${query.sql}`)
      const names = cols.split(",").map((c) => c.trim().replace(/"/g, ""))
      return Object.fromEntries(names.map((n, i) => [n, query.parameters[i]]))
    },
  }
}

export type FakeDb = ReturnType<typeof createFakeDb>

/** Shared instance -- test/setup.ts wires it in as `db/index.js`'s `db`. */
export const fakeDb = createFakeDb()
