import { buildAST } from "./query/builder.js";
import { buildPlan } from "./query/planner.js";
import { compileSQL } from "./query/compiler.js";
import { runQuery, closePool, getTransactionClient } from "./exec/client.js";
import { normalize } from "./exec/normalize.js";
import { buildInsertSQL, buildUpdateSQL, buildDeleteSQL } from "./exec/mutations.js";
import { validateInput } from "./schema/validator.js";
import { pushSchema, Table, TableConfig, SchemaDefinition, ColumnObject, ColumnBuilder, types } from "./schema/migrator.js";
import pg from "pg";

export type KadakConfig = {
  url: string;
};

type SchemaMap = Record<string, Record<string, unknown>>;
type ColumnInput = string | ColumnObject | ColumnBuilder;
type TableColumns<T> = T extends { config: { columns: infer C } } ? C : never;
type DefinedSchema<Tables extends Record<string, Table<string, Record<string, ColumnInput>>>> = {
  [K in keyof Tables & string]: TableColumns<Tables[K]>;
};

type BuiltColumn<C> = C extends ColumnBuilder<infer O>
  ? O
  : C extends string
    ? { type: C }
    : C;

type RelationFromColumn<C> = BuiltColumn<C> extends { ref: { table: infer Table extends string; as: infer As extends string } }
  ? { table: Table; as: As }
  : never;

type RelationNames<Columns> = {
  [K in keyof Columns & string as RelationFromColumn<Columns[K]> extends never ? never : RelationFromColumn<Columns[K]>["as"]]: RelationFromColumn<Columns[K]>["table"];
};

type RelationFieldNames<Columns> = keyof RelationNames<Columns> & string;
type QueryFields<Columns> = {
  [K in keyof Columns & string]: K;
};
type QueryFieldKeys<Columns> = keyof QueryFields<Columns> & string;
type MutationFieldKeys<Columns> = keyof Columns & string;

type WhereInput<Columns> = Partial<Record<QueryFieldKeys<Columns>, unknown>> & { id?: unknown };
type SelectInput<Columns> = Partial<Record<QueryFieldKeys<Columns>, true>>;
type OrderByInput<Columns> = Partial<Record<QueryFieldKeys<Columns>, "asc" | "desc">>;

type RelationTargetSchema<S, TableName extends keyof S, RelationName extends string> = {
  [K in keyof S[TableName] & string]: RelationFromColumn<S[TableName][K]> extends { as: RelationName }
    ? RelationFromColumn<S[TableName][K]>["table"] extends keyof S
      ? RelationFromColumn<S[TableName][K]>["table"]
      : never
    : never;
}[keyof S[TableName] & string];

type NestedNode<S extends SchemaMap, TableName extends keyof S> = {
  where?: WhereInput<S[TableName]>;
  orderBy?: OrderByInput<S[TableName]>;
  select?: SelectInput<S[TableName]>;
} & {
  [R in RelationFieldNames<S[TableName]>]?: NestedNode<S, RelationTargetSchema<S, TableName, R>> | true;
};

type RootNode<S extends SchemaMap, TableName extends keyof S> = NestedNode<S, TableName> & {
  take?: number;
  skip?: number;
};

export interface KadakQuery<T> extends Promise<T> {
  toSQL: () => { sql: string; values: unknown[] };
  explain: () => Promise<unknown[]>;
  trace: () => { ast: unknown; plan: unknown; sql: string; values: unknown[] };
}

// --- Type Inference Helpers ---
type TableQuery<S extends SchemaMap, T extends keyof S> = RootNode<S, T>;

type TableInsert<S extends SchemaMap, T extends keyof S> = Partial<Record<MutationFieldKeys<S[T]>, unknown>> & { id?: unknown };

type TableUpdate<S extends SchemaMap, T extends keyof S> = {
  where: WhereInput<S[T]>;
  data: Partial<TableInsert<S, T>>;
};

type TableDelete<S extends SchemaMap, T extends keyof S> = {
  where: WhereInput<S[T]>;
};

export type InferredQuery<S extends SchemaMap> = {
  [K in keyof S]?: TableQuery<S, K>;
};

type RelationDefinition = {
  table: string;
  as: string;
  to: string;
  source: string;
};

type SchemaEntry = string | Record<string, any> | RelationDefinition;

export interface KadakInstance<S extends SchemaMap = SchemaMap> {
  readonly schema: Readonly<SchemaDefinition>;
  define<Tables extends Record<string, Table<string, Record<string, ColumnInput>>>>(tables: Tables): KadakInstance<DefinedSchema<Tables>>;
  push(): Promise<void>;
  data<T = unknown>(input: InferredQuery<S>, options?: { debug?: boolean; client?: pg.PoolClient }): KadakQuery<T>;
  insert<T extends keyof S>(table: T, data: TableInsert<S, T>, options?: { client?: pg.PoolClient }): Promise<unknown>;
  update<T extends keyof S>(table: T, options: TableUpdate<S, T> & { client?: pg.PoolClient }): Promise<unknown[]>;
  delete<T extends keyof S>(table: T, options: TableDelete<S, T> & { client?: pg.PoolClient }): Promise<unknown[]>;
  transaction<T>(fn: (tx: Omit<KadakInstance<S>, "schema" | "define" | "push" | "transaction" | "close">) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface KadakFactory {
  (config: KadakConfig): KadakInstance;
  table: <N extends string, C extends Record<string, ColumnInput>>(config: TableConfig<N, C>) => Table<N, C>;
  types: typeof types;
  t: typeof types;
}
// ------------------------------

export const kadak = ((config: KadakConfig): KadakInstance => {
  let _currentSchema: Record<string, Record<string, SchemaEntry>> = {};
  let _rawDefinition: SchemaDefinition = {};
  const _url = config.url;

  const data = <T = unknown>(input: Record<string, unknown>, options: { debug?: boolean; client?: pg.PoolClient } = {}): KadakQuery<T> => {
    validateInput(input, _currentSchema);
    const ast = buildAST(input);
    const plan = buildPlan(ast, _currentSchema);
    const { text: sql, values } = compileSQL(plan, ast, _currentSchema);
    
    const execution = async () => {
      let rows: unknown[] = [];
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

  const dbClient: KadakInstance = {
    get schema() {
      return _rawDefinition;
    },
    define(tables: Record<string, Table<string, Record<string, ColumnInput>>>) {
      for (const [key, table] of Object.entries(tables)) {
        const tableName = table.config.name;
        const columns = table.config.columns;
        
        _rawDefinition[tableName] = columns;
        _currentSchema[tableName] = {};
        const relationNames = new Set<string>();
        
        for (const [col, rawDef] of Object.entries(columns)) {
          const def: ColumnObject = (rawDef instanceof ColumnBuilder) ? rawDef.build() : (typeof rawDef === "string" ? { type: rawDef } : rawDef);
          
          if (def.ref) {
            const relationName = def.ref.as;
            if (!relationName) {
              throw new Error("Kadak Error: 'as' is required in ref()");
            }
            if (relationNames.has(relationName)) {
              throw new Error(`Kadak Error: duplicate relation name '${relationName}'`);
            }
            if (columns[relationName] !== undefined) {
              throw new Error(`Kadak Error: relation name '${relationName}' conflicts with column`);
            }
            relationNames.add(relationName);
            _currentSchema[tableName][col] = def;
            _currentSchema[tableName][relationName] = {
              table: def.ref.table,
              as: relationName,
              to: def.ref.to || "id",
              source: col
            };
          } else if (typeof rawDef === "string" && rawDef.startsWith("ref:")) {
            throw new Error("Kadak Error: 'as' is required in ref()");
          } else if (typeof rawDef === "string" && rawDef.includes(".")) {
            _currentSchema[tableName][col] = rawDef;
          } else {
            _currentSchema[tableName][col] = def;
          }
        }
      }
      return dbClient as unknown as KadakInstance<DefinedSchema<typeof tables>>;
    },

    async push() {
      if (process.env.NODE_ENV === "production") {
        console.warn("⚠️ [Kadak] push() called in production. Ensure this is intentional.");
      }
      await pushSchema(dbClient.schema, _url);
    },

    async insert<T extends string>(table: T, data: Record<string, unknown>, options: { client?: pg.PoolClient } = {}) {
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

    async update<T extends string>(table: T, options: { where: Record<string, unknown>; data: Record<string, unknown>; client?: pg.PoolClient }) {
      const tableName = String(table);
      const tableSchema = _currentSchema[tableName];
      if (!tableSchema) {
        throw new Error(`❌ Kadak Error: Table '${tableName}' not found in defined schema.`);
      }

      if (!options.where || Object.keys(options.where).length === 0) {
        throw new Error(`❌ Kadak Error: Update mutation requires a 'where' clause.`);
      }

      for (const [col, def] of Object.entries(tableSchema)) {
        if (typeof def === "object" && def !== null && "autoUpdate" in def && def.autoUpdate) {
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

    async delete<T extends string>(table: T, options: { where: Record<string, unknown>; client?: pg.PoolClient }) {
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

    async transaction<T>(fn: (tx: Omit<KadakInstance, "schema" | "define" | "push" | "transaction" | "close">) => Promise<T>) {
      const client = await getTransactionClient(_url);
      try {
        await client.query("BEGIN");
        const tx = {
          data: (input: Record<string, unknown>, opts: { debug?: boolean; client?: pg.PoolClient } = {}) => data(input, { ...opts, client }),
          insert: (table: string, d: Record<string, unknown>, opts: { client?: pg.PoolClient } = {}) => dbClient.insert(table, d, { ...opts, client }),
          update: (table: string, opts: { where: Record<string, unknown>; data: Record<string, unknown>; client?: pg.PoolClient }) => dbClient.update(table, { ...opts, client }),
          delete: (table: string, opts: { where: Record<string, unknown>; client?: pg.PoolClient }) => dbClient.delete(table, { ...opts, client })
        } as Omit<KadakInstance, "schema" | "define" | "push" | "transaction" | "close">;
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

  return dbClient;
}) as KadakFactory;

kadak.table = <N extends string, C extends Record<string, any>>(config: TableConfig<N, C>): Table<N, C> => {
  return { config };
};

kadak.types = types;
kadak.t = types;

export * from "./query/index.js";
export * from "./exec/index.js";
export { types, t } from "./schema/migrator.js";
