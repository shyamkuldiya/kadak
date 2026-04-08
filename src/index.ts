import { buildAST } from "./query/builder.js";
import { buildPlan } from "./query/planner.js";
import { compileSQL } from "./query/compiler.js";
import { runQuery, closePool, getTransactionClient } from "./exec/client.js";
import { normalize } from "./exec/normalize.js";
import { executeEngine } from "./exec/engine.js";
import { buildInsertSQL, buildUpdateSQL, buildDeleteSQL } from "./exec/mutations.js";
import { validateInput } from "./schema/validator.js";
import { pushSchema, Table, TableConfig, SchemaDefinition, ColumnObject, ColumnBuilder, Column, InferColumns, types } from "./schema/migrator.js";
import pg from "pg";

export type KadakConfig = {
  url: string;
};

type SchemaMap = Record<string, Record<string, unknown>>;
type ColumnInput = string | ColumnObject | ColumnBuilder | Column<unknown>;
type TableColumns<T> = T extends { columns: infer C } ? C : T extends { config: { columns: infer C } } ? C : never;
type DefinedSchema<Tables extends Record<string, Table<string, Record<string, ColumnInput>>>> = {
  [K in keyof Tables & string]: TableRow<TableColumns<Tables[K]>>;
};

type BuiltColumn<C> = C extends ColumnBuilder<infer O>
  ? O
  : C extends Column<infer U>
    ? { __type: U }
  : C extends string
    ? C extends `${string}.${string}`
      ? { relation: C }
      : { type: C }
    : C;

type ColumnValue<C> =
  BuiltColumn<C> extends { relation: string } ? never :
  BuiltColumn<C> extends { array: { type: "string" } } ? string[] :
  BuiltColumn<C> extends { array: { type: "int" } } ? number[] :
  BuiltColumn<C> extends { ref: unknown } ? number :
  BuiltColumn<C> extends { type: "int" } ? number :
  BuiltColumn<C> extends { type: "timestamp" } ? string :
  BuiltColumn<C> extends { type: "jsonb" } ? unknown :
  BuiltColumn<C> extends { type: "text" | "string" | "varchar" } ? string :
  never;

type TableRow<Columns> = {
  id: number;
} & {
  [K in keyof Columns & string as ColumnValue<Columns[K]> extends never ? never : K]: ColumnValue<Columns[K]>;
};

type RelationTargetName<C> = BuiltColumn<C> extends { ref: { table: infer Table extends string } } ? Table : never;
type RelationAlias<C> = BuiltColumn<C> extends { ref: { as: infer As extends string } } ? As : never;

type RelationFromColumn<C, K extends string> =
  BuiltColumn<C> extends { ref: { table: infer Table extends string; as: infer As extends string } }
    ? BuiltColumn<C> extends { ref: { backRef: infer BackRef extends string } }
      ? { table: Table; as: As } | { table: K extends string ? any : never; as: BackRef }
      : { table: Table; as: As }
    : BuiltColumn<C> extends { relation: infer Rel extends string }
      ? Rel extends `${infer Table}.${string}`
        ? { table: Table; as: K }
        : never
      : never;

type RelationNames<Columns> = {
  [K in keyof Columns & string as RelationFromColumn<Columns[K], K> extends never ? never : RelationFromColumn<Columns[K], K>["as"]]: RelationFromColumn<Columns[K], K>["table"];
};

type RelationFieldNames<Columns> = keyof RelationNames<Columns> & string;
type QueryFieldKeys<Columns> = keyof Columns & string;
type MutationFieldKeys<Columns> = keyof Columns & string;

type WhereInput<Columns> = Partial<{ [K in keyof Columns & string]: Columns[K] }> & { id?: number };
type SelectInput<Columns> = Partial<Record<QueryFieldKeys<Columns>, true>>;
type OrderByInput<Columns> = Partial<Record<QueryFieldKeys<Columns>, "asc" | "desc">>;

type RelationGraph<Tables extends Record<string, Table<string, Record<string, ColumnInput>>>> = {
  [K in keyof Tables & string]: RelationNames<TableColumns<Tables[K]>>;
};

type QueryNode<S extends SchemaMap, D extends Record<string, Record<string, string>>, TableName extends keyof S & keyof D> = {
  where?: WhereInput<S[TableName]>;
  orderBy?: OrderByInput<S[TableName]>;
  select?: SelectInput<S[TableName]>;
} & {
  [R in keyof D[TableName] & string]?: D[TableName][R] extends keyof S
    ? (QueryNode<S, D, D[TableName][R]> & { _count?: true }) | true
    : never;
};

type RootNode<S extends SchemaMap, D extends Record<string, Record<string, string>>, TableName extends keyof S & keyof D> = QueryNode<S, D, TableName> & {
  _count?: true;
  take?: number;
  skip?: number;
};

export interface KadakQuery<T> extends Promise<T> {
  toSQL: () => { sql: string; values: unknown[] };
  explain: () => Promise<unknown[]>;
  trace: () => { ast: unknown; plan: unknown; sql: string; values: unknown[] };
}

// --- Type Inference Helpers ---
type TableQuery<S extends SchemaMap, D extends Record<string, Record<string, string>>, T extends keyof S & keyof D> = RootNode<S, D, T>;

type TableInsert<S extends SchemaMap, T extends keyof S> = Partial<{ [K in keyof S[T] & string as K extends "id" ? never : K]: S[T][K] }> & { id?: number };

type TableUpdate<S extends SchemaMap, T extends keyof S> = {
  where: WhereInput<S[T]>;
  data: Partial<TableInsert<S, T>>;
};

type TableDelete<S extends SchemaMap, T extends keyof S> = {
  where: WhereInput<S[T]>;
};

export type InferredQuery<S extends SchemaMap, D extends Record<string, Record<string, string>>> = {
  [K in keyof S & keyof D]?: TableQuery<S, D, K> | true;
};

type RelationPropName<Columns, K extends keyof Columns> = RelationFromColumn<Columns[K], K & string> extends { as: infer As extends string } ? As : never;

type ColumnSelection<Columns, Selection> = Selection extends Record<string, true>
  ? {
      [K in keyof Selection & keyof Columns as Selection[K] extends true ? K : never]: ColumnValue<Columns[K]>;
    }
  : {
      [K in keyof Columns]: ColumnValue<Columns[K]>;
    };

type RelationCountSelection<Node> = Node extends { _count: true } ? { _count: number } : {};

type RowResult<S extends SchemaMap, D extends Record<string, Record<string, string>>, TableName extends keyof S & keyof D, Node> =
  ColumnSelection<S[TableName], Node extends { select: infer Sel } ? Sel : never> &
  RelationCountSelection<Node> &
  RelationMapResult<S, D, TableName, Node>;

type RelationMapResult<S extends SchemaMap, D extends Record<string, Record<string, string>>, TableName extends keyof S & keyof D, Node> = Node extends Record<string, unknown>
  ? {
      [R in keyof D[TableName] & string as R extends keyof Node ? R : never]:
        D[TableName][R] extends keyof S
          ? Node[R] extends { _count: true }
            ? { _count: number }
            : Node[R] extends true
            ? RowResult<S, D, D[TableName][R], true>
            : RowResult<S, D, D[TableName][R], Node[R]>
          : never;
    }
  : {};

type QueryResult<S extends SchemaMap, D extends Record<string, Record<string, string>>, Q extends InferredQuery<S, D>> = {
  [K in keyof Q & keyof S & keyof D]: Array<RowResult<S, D, K, Q[K]>>;
};

type RelationDefinition = {
  table: string;
  as: string;
  to: string;
  source: string;
};

type SchemaEntry = string | Record<string, unknown> | RelationDefinition;

export interface KadakInstance<S extends SchemaMap = SchemaMap, D extends Record<string, Record<string, string>> = Record<string, never>> {
  readonly schema: Readonly<SchemaDefinition>;
  define<Tables extends Record<string, Table<string, Record<string, ColumnInput>>>>(tables: Tables): KadakInstance<DefinedSchema<Tables>, RelationGraph<Tables>>;
  push(): Promise<void>;
  data<Q extends InferredQuery<S, D>>(input: Q, options?: { debug?: boolean; client?: pg.PoolClient }): KadakQuery<Q[keyof Q & keyof S & keyof D] extends { _count: true } ? { [K in keyof Q & keyof S & keyof D]: { _count: number } } : QueryResult<S, D, Q>>;
  insert<T extends keyof S & string>(table: T, data: TableInsert<S, T>, options?: { client?: pg.PoolClient }): Promise<unknown>;
  update<T extends keyof S & string>(table: T, options: TableUpdate<S, T> & { client?: pg.PoolClient }): Promise<unknown[]>;
  delete<T extends keyof S & string>(table: T, options: TableDelete<S, T> & { client?: pg.PoolClient }): Promise<unknown[]>;
  transaction<T>(fn: (tx: Omit<KadakInstance<S, D>, "schema" | "define" | "push" | "transaction" | "close">) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface KadakFactory {
  (config: KadakConfig): KadakInstance;
  table: <N extends string, C extends Record<string, ColumnInput>>(config: TableConfig<N, C>) => Table<N, C>;
  types: typeof types;
}
// ------------------------------

export const kadak = ((config: KadakConfig): KadakInstance => {
  let _currentSchema: Record<string, Record<string, SchemaEntry>> = {};
  let _rawDefinition: SchemaDefinition = {};
  const _url = config.url;

  const data = ((input: Record<string, unknown>, options: { debug?: boolean; client?: pg.PoolClient } = {}): KadakQuery<unknown> => {
    const resolvedUrl = _url || process.env.DATABASE_URL;
    validateInput(input, _currentSchema);
    const ast = buildAST(input);
    let traceCache: { plan: ReturnType<typeof buildPlan>; sql: string; values: unknown[] } | null = null;
    const getTrace = () => {
      if (!traceCache) {
        const plan = buildPlan(ast, _currentSchema);
        const compiled = compileSQL(plan, ast, _currentSchema);
        traceCache = { plan, sql: compiled.text, values: compiled.values };
      }
      return traceCache;
    };
    
    const execution = async () => {
      try {
        const engine = await executeEngine(ast, _currentSchema, options, resolvedUrl);
        if (options.debug) {
          const trace = getTrace();
          return { sql: trace.sql, values: trace.values, rows: engine.rootRows, data: engine.rootRows };
        }
        return engine.rootRows as unknown;
      } catch (error) {
        if (ast._count) {
          const countResult = { [ast.root]: { _count: 0 } };
          if (options.debug) {
            const trace = getTrace();
            return { sql: trace.sql, values: trace.values, rows: [], data: countResult };
          }
          return countResult as unknown;
        }
        throw error;
      }
    };

    const promise = execution();
    const queryObj = promise as KadakQuery<unknown>;
    queryObj.toSQL = () => {
      const trace = getTrace();
      return { sql: trace.sql, values: trace.values };
    };
    queryObj.explain = async () => {
      const trace = getTrace();
      const explainSql = `EXPLAIN ANALYZE ${trace.sql}`;
      return await runQuery(explainSql, trace.values, resolvedUrl, options.client);
    };
    queryObj.trace = () => {
      const trace = getTrace();
      return { ast, plan: trace.plan, sql: trace.sql, values: trace.values };
    };
    return queryObj;
  }) as KadakInstance<SchemaMap, Record<string, never>>["data"];

  const dbClient: KadakInstance = {
    get schema() {
      return _rawDefinition;
    },
    define: (<Tables extends Record<string, Table<string, Record<string, ColumnInput>>>>(tables: Tables) => {
      for (const [key, table] of Object.entries(tables)) {
        const tableName = table.config.name;
        const columns = table.config.columns;
        
        _rawDefinition[tableName] = columns;
        _currentSchema[tableName] = {};
        const relationNames = new Set<string>();
        
        for (const [col, rawDef] of Object.entries(columns)) {
          const def: ColumnObject = (rawDef instanceof ColumnBuilder)
            ? rawDef.build()
            : (typeof rawDef === "string" ? { type: rawDef } : (rawDef as ColumnObject));
          
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
            if (def.ref.backRef) {
              const targetSchema = _currentSchema[def.ref.table] || {};
              if (targetSchema[def.ref.backRef] || columns[def.ref.backRef] !== undefined) {
                throw new Error(`Kadak Error: relation name '${def.ref.backRef}' conflicts with column`);
              }
              _currentSchema[def.ref.table] = targetSchema;
              _currentSchema[def.ref.table][def.ref.backRef] = {
                table: tableName,
                as: def.ref.backRef,
                to: col,
                source: "id"
              };
            }
          } else if (typeof rawDef === "string" && rawDef.startsWith("ref:")) {
            throw new Error("Kadak Error: 'as' is required in ref()");
          } else if (typeof rawDef === "string" && rawDef.includes(".")) {
            _currentSchema[tableName][col] = rawDef;
          } else {
            _currentSchema[tableName][col] = def;
          }
        }
      }
      return dbClient as unknown as KadakInstance<DefinedSchema<Tables>, RelationGraph<Tables>>;
    }) as KadakInstance["define"],

    async push() {
      const resolvedUrl = _url || process.env.DATABASE_URL;
      if (process.env.NODE_ENV === "production") {
        console.warn("⚠️ [Kadak] push() called in production. Ensure this is intentional.");
      }
      await pushSchema(dbClient.schema, resolvedUrl as string);
    },

    async insert<T extends string>(table: T, data: Record<string, unknown>, options: { client?: pg.PoolClient } = {}) {
      const resolvedUrl = _url || process.env.DATABASE_URL;
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
      const rows = await runQuery(sql, values, resolvedUrl, options.client);
      
      const ast = { root: tableName, relations: [] };
      return normalize(rows, ast, _currentSchema)[0];
    },

    async update<T extends string>(table: T, options: { where: Record<string, unknown>; data: Record<string, unknown>; client?: pg.PoolClient }) {
      const resolvedUrl = _url || process.env.DATABASE_URL;
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
      const rows = await runQuery(sql, values, resolvedUrl, options.client);
      
      const ast = { root: tableName, relations: [] };
      return normalize(rows, ast, _currentSchema);
    },

    async delete<T extends string>(table: T, options: { where: Record<string, unknown>; client?: pg.PoolClient }) {
      const resolvedUrl = _url || process.env.DATABASE_URL;
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
      const rows = await runQuery(sql, values, resolvedUrl, options.client);
      
      const ast = { root: tableName, relations: [] };
      return normalize(rows, ast, _currentSchema);
    },

    async transaction<T>(fn: (tx: Omit<KadakInstance, "schema" | "define" | "push" | "transaction" | "close">) => Promise<T>) {
      const resolvedUrl = _url || process.env.DATABASE_URL;
      const client = await getTransactionClient(resolvedUrl);
      try {
        await client.query("BEGIN");
        const tx = {
          data: (input: Record<string, unknown>, opts: { debug?: boolean; client?: pg.PoolClient } = {}) => data(input as InferredQuery<SchemaMap, Record<string, never>>, { ...opts, client }),
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

kadak.table = <N extends string, C extends Record<string, ColumnInput>>(config: TableConfig<N, C>): Table<N, C> => {
  return { config, columns: config.columns };
};

kadak.types = types;

export * from "./query/index.js";
export * from "./exec/index.js";
export { types } from "./schema/migrator.js";
export type { InferColumns } from "./schema/migrator.js";
