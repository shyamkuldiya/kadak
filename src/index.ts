import { buildAST } from "./query/builder.js";
import { buildPlan } from "./query/planner.js";
import { compileSQL } from "./query/compiler.js";
import { runQuery, closePool } from "./exec/client.js";
import { normalize } from "./exec/normalize.js";
import { validateInput } from "./schema/validator.js";
import { pushSchema, SchemaDefinition } from "./schema/migrator.js";

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

export type InferredQuery<S> = {
  [K in keyof S]?: TableQuery<S, K>;
};

export interface KadakInstance<S extends SchemaDefinition = SchemaDefinition> {
  schema<NewS extends SchemaDefinition>(definition: NewS): KadakInstance<NewS>;
  data<T = any>(input: InferredQuery<S>, options?: { debug?: boolean }): KadakQuery<T>;
  close(): Promise<void>;
}
// ------------------------------

export function kadak(config: KadakConfig): KadakInstance<any> {
  let _currentSchema: Record<string, Record<string, any>> = {};
  const _url = config.url;

  const data = <T = any>(input: Record<string, unknown>, options: { debug?: boolean } = {}): KadakQuery<T> => {
    validateInput(input, _currentSchema);
    const ast = buildAST(input);
    const plan = buildPlan(ast, _currentSchema);
    const { text: sql, values } = compileSQL(plan, _currentSchema);
    
    const execution = async () => {
      let rows: any[] = [];
      try {
        rows = await runQuery(sql, values, _url);
      } catch (e) {
        if (options.debug) console.error("Execution failed:", (e as Error).message);
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
      return await runQuery(explainSql, values, _url);
    };
    queryObj.trace = () => ({ ast, plan, sql, values });
    return queryObj;
  };

  const instance: KadakInstance<any> = {
    schema<NewS extends SchemaDefinition>(definition: NewS) {
      for (const [table, cols] of Object.entries(definition)) {
        if (!_currentSchema[table]) _currentSchema[table] = {};
        for (const [col, def] of Object.entries(cols)) {
          if (typeof def === "object" && def !== null && def.ref) {
            _currentSchema[table][col] = `${def.ref}.id`;
          } else if (typeof def === "string" && def.startsWith("ref:")) {
            _currentSchema[table][col] = `${def.split(":")[1]}.id`;
          } else if (typeof def === "string" && def.includes(".")) {
            _currentSchema[table][col] = def;
          } else {
            _currentSchema[table][col] = col;
          }
        }
      }
      
      const pushObj = {
        push: async () => {
          if (process.env.NODE_ENV === "production") {
            console.warn("⚠️ [Kadak] push() called in production. Ensure this is intentional.");
          }
          await pushSchema(definition, _url);
        }
      };

      return Object.assign(instance, pushObj) as unknown as KadakInstance<NewS> & typeof pushObj;
    },
    data,
    close: closePool
  };

  return instance;
}

export * from "./query/index.js";
export * from "./exec/index.js";
