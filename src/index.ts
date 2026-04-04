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

let _schema: Record<string, Record<string, any>> = {};
let _url: string = "";

export function kadak(config: KadakConfig) {
  _schema = {};
  _url = config.url;
  return {
    schema(definition: SchemaDefinition) {
      // Store the definition for both migrator and query selection
      // We merge it into _schema so compileSQL can see the columns
      for (const [table, cols] of Object.entries(definition)) {
        if (!_schema[table]) _schema[table] = {};
        for (const [col, def] of Object.entries(cols)) {
          // If it's a ref, the query engine needs the mapping
          if (typeof def === "object" && def !== null && def.ref) {
            _schema[table][col] = `${def.ref}.id`;
          } else if (typeof def === "string" && def.startsWith("ref:")) {
            _schema[table][col] = `${def.split(":")[1]}.id`;
          } else if (typeof def === "string" && def.includes(".")) {
            _schema[table][col] = def;
          } else {
            _schema[table][col] = col; // It's a column
          }
        }
      }
      return {
        push: async () => {
          await pushSchema(definition, _url);
        }
      };
    },
    data,
    close: closePool
  };
}

export interface KadakQuery<T> extends Promise<T> {
  toSQL: () => { sql: string; values: unknown[] };
  explain: () => Promise<any[]>;
  trace: () => { ast: any; plan: any; sql: string; values: unknown[] };
}

export function data<T = any>(input: Record<string, unknown>, options: { debug?: boolean } = {}): KadakQuery<T> {
  // 0. Validate
  validateInput(input, _schema);

  // 1. AST
  const ast = buildAST(input);
  
  // 2. Plan
  const plan = buildPlan(ast, _schema);
  
  // 3. SQL - Pass schema for column selection
  const { text: sql, values } = compileSQL(plan, _schema);
  
  const execution = async () => {
    let rows: any[] = [];
    try {
      // 4. Execute
      rows = await runQuery(sql, values, _url);
    } catch (e) {
      if (options.debug) console.error("Execution failed:", (e as Error).message);
      rows = [];
    }

    // 5. Normalize
    const normalized = normalize(rows, ast, _schema);

    // Return logic
    if (options.debug) {
      return {
        sql,
        values,
        rows,
        data: normalized
      } as unknown as T;
    }

    return normalized as unknown as T;
  };

  const promise = execution();

  const queryObj = promise as KadakQuery<T>;

  queryObj.toSQL = () => ({ sql, values });
  
  queryObj.explain = async () => {
    const explainSql = `EXPLAIN ANALYZE ${sql}`;
    return await runQuery(explainSql, values, _url);
  };

  queryObj.trace = () => ({
    ast,
    plan,
    sql,
    values
  });

  return queryObj;
}

export * from "./query/index.js";
export * from "./exec/index.js";
