import { buildAST } from "./query/builder.js";
import { buildPlan } from "./query/planner.js";
import { compileSQL } from "./query/compiler.js";
import { runQuery, closePool, getTransactionClient } from "./exec/client.js";
import { normalize } from "./exec/normalize.js";
import { buildInsertSQL, buildUpdateSQL, buildDeleteSQL } from "./exec/mutations.js";
import { validateInput } from "./schema/validator.js";
import { pushSchema, Table, TableConfig, SchemaDefinition, ColumnObject, ColumnBuilder, t } from "./schema/migrator.js";
import pg from "pg";

export type KadakConfig = {
  url: string;
};

export interface KadakQuery<T> extends Promise<T> {
  toSQL: () => { sql: string; values: unknown[] };
  explain: () => Promise<any[]>;
  trace: () => { ast: any; plan: any; sql: string; values: unknown[] };
}

// --- Type Inference Helpers ---
type RelationName<V> = V extends { ref: infer R } ? R : V extends `ref:${infer R}` ? R : never;

type TableQuery<S, T extends keyof S> = {
  where?: Record<string, any>;
  orderBy?: Record<string, "asc" | "desc">;
} & {
  [K in keyof S[T]]?: RelationName<S[T][K]> extends keyof S 
    ? TableQuery<S, RelationName<S[T][K]>> | true
    : any;
};

type TableInsert<S, T extends keyof S> = {
  [K in keyof S[T]]?: any;
} & { id?: any };

type TableUpdate<S, T extends keyof S> = {
  where: Record<string, any>;
  data: Partial<TableInsert<S, T>>;
};

type TableDelete<S, T extends keyof S> = {
  where: Record<string, any>;
};

export type InferredQuery<S> = {
  [K in keyof S]?: TableQuery<S, K>;
};

export interface KadakInstance<S extends Record<string, any> = any> {
  define<Tables extends Record<string, Table<any, any>>>(tables: Tables): KadakInstance<{
    [K in keyof Tables]: Tables[K]["config"]["columns"]
  }>;
  push(): Promise<void>;
  data<T = any>(input: InferredQuery<S>, options?: { debug?: boolean; client?: pg.PoolClient }): KadakQuery<T>;
  insert<T extends keyof S>(table: T, data: TableInsert<S, T>, options?: { client?: pg.PoolClient }): Promise<any>;
  update<T extends keyof S>(table: T, options: TableUpdate<S, T> & { client?: pg.PoolClient }): Promise<any[]>;
  delete<T extends keyof S>(table: T, options: TableDelete<S, T> & { client?: pg.PoolClient }): Promise<any[]>;
  transaction<T>(fn: (tx: Omit<KadakInstance<S>, "define" | "push" | "transaction" | "close">) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
// ------------------------------

export const kadak = (config: KadakConfig): KadakInstance<any> => {
  let _currentSchema: Record<string, Record<string, any>> = {};
  let _rawDefinition: SchemaDefinition = {};
  const _url = config.url;

  const data = <T = any>(input: Record<string, unknown>, options: { debug?: boolean; client?: pg.PoolClient } = {}): KadakQuery<T> => {
    validateInput(input, _currentSchema);
    const ast = buildAST(input);
    const plan = buildPlan(ast, _currentSchema);
    const { text: sql, values } = compileSQL(plan, _currentSchema);
    
    const execution = async () => {
      let rows: any[] = [];
      try {
        rows = await runQuery(sql, values, _url, options.client);
      } catch (e) {
        if (options.debug) console.error("❌ Kadak Execution Error:", (e as Error).message);
        rows = [];
      }
      const normalized = normalize(rows, ast, _currentSchema);
      return (options.debug ? { sql, values, rows, data: normalized } : normalized) as unknown as T;
    };

    const promise = execution();
    const queryObj = promise as KadakQuery<T>;
    queryObj.toSQL = () => ({ sql, values });
    queryObj.explain = async () => {
      const explainSql = `EXPLAIN ANALYZE ${sql}`;
      return await runQuery(explainSql, values, _url, options.client);
    };
    queryObj.trace = () => ({ ast, plan, sql, values });
    return queryObj;
  };

  const instance: KadakInstance<any> = {
    define(tables: Record<string, Table<any, any>>) {
      for (const [key, table] of Object.entries(tables)) {
        const tableName = table.config.name;
        const columns = table.config.columns;
        
        _rawDefinition[tableName] = columns;
        _currentSchema[tableName] = {};
        
        for (const [col, rawDef] of Object.entries(columns)) {
          const def: ColumnObject = (rawDef instanceof ColumnBuilder) ? (rawDef as any).build() : (typeof rawDef === "string" ? { type: rawDef } : rawDef);
          
          if (def.ref) {
            _currentSchema[tableName][col] = `${def.ref}.id`;
          } else if (typeof rawDef === "string" && rawDef.startsWith("ref:")) {
            _currentSchema[tableName][col] = `${rawDef.split(":")[1]}.id`;
          } else if (typeof rawDef === "string" && rawDef.includes(".")) {
            _currentSchema[tableName][col] = rawDef;
          } else {
            _currentSchema[tableName][col] = def;
          }
        }
      }
      return instance as any;
    },

    async push() {
      if (process.env.NODE_ENV === "production") {
        console.warn("⚠️ [Kadak] push() called in production. Ensure this is intentional.");
      }
      await pushSchema(_rawDefinition, _url);
    },

    async insert<T extends keyof any>(table: T, data: any, options: { client?: pg.PoolClient } = {}) {
      const tableName = String(table);
      const tableSchema = _currentSchema[tableName];
      if (!tableSchema) {
        throw new Error(`❌ Kadak Error: Table '${tableName}' not found in defined schema.`);
      }

      for (const field of Object.keys(data)) {
        if (field !== "id" && !tableSchema[field]) {
          throw new Error(`❌ Kadak Error: Invalid field '${field}' on table '${tableName}'.`);
        }
      }

      const { sql, values } = buildInsertSQL(tableName, data);
      const rows = await runQuery(sql, values, _url, options.client);
      
      const ast = { root: tableName, relations: [] };
      return normalize(rows, ast, _currentSchema)[0];
    },

    async update<T extends keyof any>(table: T, options: any) {
      const tableName = String(table);
      const tableSchema = _currentSchema[tableName];
      if (!tableSchema) {
        throw new Error(`❌ Kadak Error: Table '${tableName}' not found in defined schema.`);
      }

      if (!options.where || Object.keys(options.where).length === 0) {
        throw new Error(`❌ Kadak Error: Update mutation requires a 'where' clause.`);
      }

      for (const [col, def] of Object.entries(tableSchema)) {
        if (typeof def === "object" && def !== null && (def as any).autoUpdate) {
          options.data[col] = "NOW()";
        }
      }

      for (const field of Object.keys(options.data)) {
        if (field !== "id" && !tableSchema[field]) {
          throw new Error(`❌ Kadak Error: Invalid field '${field}' on table '${tableName}'.`);
        }
      }

      for (const field of Object.keys(options.where)) {
        if (field !== "id" && !tableSchema[field]) {
          throw new Error(`❌ Kadak Error: Invalid filter field '${field}' on table '${tableName}'.`);
        }
      }

      const { sql, values } = buildUpdateSQL(tableName, options.where, options.data);
      const rows = await runQuery(sql, values, _url, options.client);
      
      const ast = { root: tableName, relations: [] };
      return normalize(rows, ast, _currentSchema);
    },

    async delete<T extends keyof any>(table: T, options: any) {
      const tableName = String(table);
      const tableSchema = _currentSchema[tableName];
      if (!tableSchema) {
        throw new Error(`❌ Kadak Error: Table '${tableName}' not found in defined schema.`);
      }

      if (!options.where || Object.keys(options.where).length === 0) {
        throw new Error(`❌ Kadak Error: Delete mutation requires a 'where' clause.`);
      }

      for (const field of Object.keys(options.where)) {
        if (field !== "id" && !tableSchema[field]) {
          throw new Error(`❌ Kadak Error: Invalid filter field '${field}' on table '${tableName}'.`);
        }
      }

      const { sql, values } = buildDeleteSQL(tableName, options.where);
      const rows = await runQuery(sql, values, _url, options.client);
      
      const ast = { root: tableName, relations: [] };
      return normalize(rows, ast, _currentSchema);
    },

    async transaction<T>(fn: any) {
      const client = await getTransactionClient(_url);
      try {
        await client.query("BEGIN");
        const tx = {
          data: (input: any, opts: any = {}) => data(input, { ...opts, client }),
          insert: (table: any, d: any, opts: any = {}) => instance.insert(table, d, { ...opts, client }),
          update: (table: any, opts: any) => instance.update(table, { ...opts, client }),
          delete: (table: any, opts: any) => instance.delete(table, { ...opts, client })
        };
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (e) {
        try {
          await client.query("ROLLBACK");
        } catch (err) {
          // Ignore rollback errors to avoid shadowing original error
        }
        throw e;
      } finally {
        client.release();
      }
    },

    data,
    close: closePool
  };

  return instance;
};

kadak.table = <N extends string, C extends Record<string, any>>(config: TableConfig<N, C>): Table<N, C> => {
  return { config };
};

kadak.t = t;

export * from "./query/index.js";
export * from "./exec/index.js";
export { t } from "./schema/migrator.js";
