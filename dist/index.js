// src/schema/normalize.ts
function normalizeColumn(col) {
  if (typeof col === "string") {
    switch (col) {
      case "string":
        return { type: "varchar", length: 255, nullable: false, unique: false };
      case "int":
        return { type: "int", nullable: false, unique: false };
      case "text":
        return { type: "text", nullable: false, unique: false };
      case "jsonb":
        return { type: "jsonb", nullable: false, unique: false };
      default:
        throw new Error(`Unknown string shorthand for type: ${col}`);
    }
  }
  if ("ref" in col) {
    return {
      refTable: col.ref,
      nullable: col.nullable ?? false,
      index: col.index ?? false,
      unique: col.unique ?? false,
      onDelete: col.onDelete
    };
  }
  return {
    ...col,
    nullable: col.nullable ?? false,
    unique: col.unique ?? false
  };
}
function normalizeSchema(schema) {
  const canonical = {};
  for (const [tableName, tableDef] of Object.entries(schema)) {
    canonical[tableName] = {};
    for (const [colName, colDef] of Object.entries(tableDef)) {
      canonical[tableName][colName] = normalizeColumn(colDef);
    }
  }
  return canonical;
}

// src/schema/validation.ts
import { z } from "zod";
var ScalarSchema = z.union([
  z.object({ type: z.literal("int"), nullable: z.boolean().optional(), unique: z.boolean().optional(), default: z.number().optional() }),
  z.object({ type: z.literal("varchar"), length: z.number(), nullable: z.boolean().optional(), unique: z.boolean().optional(), default: z.string().optional() }),
  z.object({ type: z.literal("text"), nullable: z.boolean().optional(), unique: z.boolean().optional(), default: z.string().optional() }),
  z.object({ type: z.literal("jsonb"), nullable: z.boolean().optional(), unique: z.boolean().optional(), default: z.unknown().optional() }),
  z.literal("string"),
  z.literal("int"),
  z.literal("text"),
  z.literal("jsonb")
]);
var RefSchema = z.object({
  ref: z.string(),
  nullable: z.boolean().optional(),
  index: z.boolean().optional(),
  unique: z.boolean().optional(),
  onDelete: z.enum(["cascade", "restrict", "set null"]).optional()
});
var ColumnDefSchema = z.union([ScalarSchema, RefSchema]);
var TableDefSchema = z.record(z.string(), ColumnDefSchema);
var SchemaDefSchema = z.record(z.string(), TableDefSchema);
var QueryInputSchema = z.record(z.string(), z.unknown());
function validateSchemaDef(input) {
  return SchemaDefSchema.parse(input);
}
function validateQueryInput(input) {
  return QueryInputSchema.parse(input);
}

// src/schema/introspect.ts
async function introspect(client) {
  const schema = { tables: {} };
  const colsRes = await client.query(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `);
  for (const row of colsRes.rows) {
    if (!schema.tables[row.table_name]) {
      schema.tables[row.table_name] = { columns: {}, fks: [], indexes: [] };
    }
    schema.tables[row.table_name].columns[row.column_name] = {
      type: row.data_type,
      nullable: row.is_nullable === "YES",
      default: row.column_default ?? void 0
    };
  }
  const fksRes = await client.query(`
    SELECT
      tc.table_name, 
      kcu.column_name, 
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.delete_rule
    FROM information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    JOIN information_schema.referential_constraints AS rc
      ON tc.constraint_name = rc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
  `);
  for (const row of fksRes.rows) {
    if (schema.tables[row.table_name]) {
      schema.tables[row.table_name].fks.push({
        column: row.column_name,
        refTable: row.foreign_table_name,
        refColumn: row.foreign_column_name,
        onDelete: row.delete_rule.toLowerCase()
      });
    }
  }
  const idxRes = await client.query(`
    SELECT
      t.relname as table_name,
      i.relname as index_name,
      a.attname as column_name,
      ix.indisunique as is_unique
    FROM pg_class t
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE t.relkind = 'r' AND n.nspname = 'public'
      AND i.relname NOT LIKE '%_pkey'
  `);
  const idxMap = {};
  for (const row of idxRes.rows) {
    if (!idxMap[row.table_name]) idxMap[row.table_name] = {};
    if (!idxMap[row.table_name][row.index_name]) {
      idxMap[row.table_name][row.index_name] = { columns: [], unique: row.is_unique };
    }
    idxMap[row.table_name][row.index_name].columns.push(row.column_name);
  }
  for (const [tableName, idxs] of Object.entries(idxMap)) {
    if (schema.tables[tableName]) {
      for (const [idxName, idx] of Object.entries(idxs)) {
        schema.tables[tableName].indexes.push({
          name: idxName,
          columns: idx.columns,
          unique: idx.unique
        });
      }
    }
  }
  return schema;
}

// src/schema/diff.ts
function diffSchemas(desired, current) {
  const ops = [];
  for (const [tableName, tableDef] of Object.entries(desired)) {
    const currentTable = current.tables[tableName];
    if (!currentTable) {
      ops.push({ type: "create_table", table: tableName });
      ops.push({ type: "add_column", table: tableName, column: "id", def: { type: "serial", primaryKey: true } });
    }
    for (const [colName, colDef] of Object.entries(tableDef)) {
      const isNewCol = !currentTable || !currentTable.columns[colName];
      if (isNewCol) {
        ops.push({ type: "add_column", table: tableName, column: colName, def: colDef });
      }
      if ("refTable" in colDef) {
        const hasFk = currentTable?.fks.some((fk) => fk.column === colName && fk.refTable === colDef.refTable);
        if (!hasFk) {
          ops.push({
            type: "add_fk",
            table: tableName,
            column: colName,
            refTable: colDef.refTable,
            refColumn: "id",
            onDelete: colDef.onDelete
          });
        }
        if (colDef.index) {
          const hasIdx = currentTable?.indexes.some((idx) => idx.columns.includes(colName));
          if (!hasIdx) {
            ops.push({ type: "add_index", table: tableName, column: colName, unique: colDef.unique ?? false });
          }
        }
      }
    }
  }
  ops.sort((a, b) => {
    const order = { create_table: 1, add_column: 2, add_index: 3, add_fk: 4 };
    return order[a.type] - order[b.type];
  });
  return ops;
}

// src/schema/sql.ts
function generateSQL(ops) {
  const statements = [];
  for (const op of ops) {
    switch (op.type) {
      case "create_table":
        statements.push(`CREATE TABLE IF NOT EXISTS ${op.table} ();`);
        break;
      case "add_column": {
        let typeStr = "";
        if (op.def.type === "serial") {
          typeStr = "SERIAL PRIMARY KEY";
        } else if ("refTable" in op.def) {
          typeStr = "INTEGER";
        } else {
          typeStr = op.def.type.toUpperCase();
          if (op.def.length) typeStr += `(${op.def.length})`;
        }
        let constraints = "";
        if (!op.def.nullable && op.def.type !== "serial") constraints += " NOT NULL";
        if (op.def.unique) constraints += " UNIQUE";
        if (op.def.default !== void 0) {
          const val = typeof op.def.default === "string" ? `'${op.def.default}'` : op.def.default;
          constraints += ` DEFAULT ${val}`;
        }
        statements.push(`ALTER TABLE ${op.table} ADD COLUMN ${op.column} ${typeStr}${constraints};`);
        break;
      }
      case "add_fk": {
        let sql = `ALTER TABLE ${op.table} ADD CONSTRAINT fk_${op.table}_${op.column} FOREIGN KEY (${op.column}) REFERENCES ${op.refTable}(${op.refColumn})`;
        if (op.onDelete) {
          sql += ` ON DELETE ${op.onDelete.toUpperCase()}`;
        }
        statements.push(sql + ";");
        break;
      }
      case "add_index": {
        const uniqueStr = op.unique ? "UNIQUE " : "";
        statements.push(`CREATE ${uniqueStr}INDEX idx_${op.table}_${op.column} ON ${op.table}(${op.column});`);
        break;
      }
    }
  }
  return statements;
}

// src/query/builder.ts
var QueryBuilder = class {
  constructor(schema = {}) {
    this.schema = schema;
  }
  schema;
  aliasCounter = 0;
  getAlias() {
    return `t${this.aliasCounter++}`;
  }
  buildWhere(whereObj) {
    const predicates = [];
    for (const [key, value] of Object.entries(whereObj)) {
      predicates.push({ op: "eq", column: key, value });
    }
    return predicates;
  }
  buildAST(rootTable, queryInput) {
    const rootNode = this.parseNode(rootTable, queryInput[rootTable]);
    return { root: rootNode };
  }
  parseNode(tableName, input) {
    const alias = this.getAlias();
    const relations = [];
    let where;
    let limit;
    let orderBy;
    for (const [key, value] of Object.entries(input)) {
      if (key === "where") {
        where = this.buildWhere(value);
      } else if (key === "limit") {
        limit = value;
      } else if (key === "orderBy") {
        orderBy = Object.entries(value).map(([col, dir]) => ({
          column: col,
          dir
        }));
      } else {
        const relationInput = value === true ? {} : value;
        relations.push(this.parseNode(key, relationInput));
      }
    }
    return {
      table: tableName,
      alias,
      where,
      limit,
      orderBy,
      relations,
      selectAll: true
    };
  }
};

// src/query/planner.ts
var Planner = class {
  constructor(schema = {}) {
    this.schema = schema;
  }
  schema;
  plan(astRoot) {
    const plan = {
      from: { table: astRoot.table, alias: astRoot.alias },
      joins: [],
      where: [],
      select: [],
      limit: astRoot.limit,
      orderBy: astRoot.orderBy
    };
    this.traverse(astRoot, plan);
    return plan;
  }
  traverse(node, plan, parentAlias, parentTable) {
    plan.select.push({ table: node.table, tableAlias: node.alias, selectAll: node.selectAll });
    if (node.where) {
      for (const p of node.where) {
        if (p.op === "eq") {
          plan.where.push({ ...p, column: `${node.alias}.${p.column}` });
        } else {
          plan.where.push(p);
        }
      }
    }
    if (parentAlias && parentTable) {
      const onCondition = {
        left: `${parentAlias}.id`,
        right: `${node.alias}.${parentTable.slice(0, -1)}_id`
      };
      plan.joins.push({
        type: "left",
        table: node.table,
        alias: node.alias,
        on: [onCondition]
      });
    }
    for (const relation of node.relations) {
      this.traverse(relation, plan, node.alias, node.table);
    }
  }
};

// src/query/compiler.ts
var Compiler = class {
  constructor(schema = {}) {
    this.schema = schema;
  }
  schema;
  compile(plan) {
    const values = [];
    let sql = "SELECT ";
    const selectFields = [];
    for (const s of plan.select) {
      const tableDef = this.schema[s.table];
      if (tableDef) {
        selectFields.push(`${s.tableAlias}.id AS ${s.tableAlias}__id`);
        for (const colName of Object.keys(tableDef)) {
          if (colName === "id") continue;
          selectFields.push(`${s.tableAlias}.${colName} AS ${s.tableAlias}__${colName}`);
        }
      } else {
        selectFields.push(`${s.tableAlias}.*`);
      }
    }
    sql += selectFields.join(", ") + "\n";
    sql += `FROM ${plan.from.table} ${plan.from.alias}
`;
    for (const join of plan.joins) {
      const onClauses = join.on.map((c) => `${c.left} = ${c.right}`).join(" AND ");
      sql += `LEFT JOIN ${join.table} ${join.alias} ON ${onClauses}
`;
    }
    if (plan.where.length > 0) {
      const whereClauses = plan.where.map((p) => {
        if (p.op === "eq") {
          values.push(p.value);
          return `${p.column} = $${values.length}`;
        }
        return "";
      }).filter(Boolean).join(" AND ");
      if (whereClauses) {
        sql += `WHERE ${whereClauses}
`;
      }
    }
    if (plan.orderBy && plan.orderBy.length > 0) {
      const orders = plan.orderBy.map((o) => `${plan.from.alias}.${o.column} ${o.dir.toUpperCase()}`).join(", ");
      sql += `ORDER BY ${orders}
`;
    }
    if (plan.limit) {
      sql += `LIMIT ${plan.limit}
`;
    }
    return { text: sql.trim(), values };
  }
};

// src/exec/client.ts
import pg from "pg";
var KadakClient = class {
  pool;
  constructor(connectionString) {
    this.pool = new pg.Pool({ connectionString });
  }
  async execute(compiled) {
    const res = await this.pool.query(compiled.text, compiled.values);
    return res.rows;
  }
  async explain(compiled) {
    const explainSql = `EXPLAIN ANALYZE ${compiled.text}`;
    const res = await this.pool.query(explainSql, compiled.values);
    return res.rows;
  }
  async getClient() {
    return await this.pool.connect();
  }
  async close() {
    await this.pool.end();
  }
};

// src/exec/tx.ts
async function transaction(client, callback) {
  const tx = await client.getClient();
  try {
    await tx.query("BEGIN");
    const result = await callback(tx);
    await tx.query("COMMIT");
    return result;
  } catch (e) {
    await tx.query("ROLLBACK");
    throw e;
  } finally {
    tx.release();
  }
}

// src/analyzer/rules.ts
function analyzePlan(plan) {
  const warnings = [];
  if (plan.joins.length > 1) {
    warnings.push({
      type: "warning",
      message: `High fan-out detected on query starting at '${plan.from.table}'. Multiple joins may cause row explosion.`,
      suggestion: "Consider paginating relations or splitting queries."
    });
  }
  for (const join of plan.joins) {
    for (const cond of join.on) {
      warnings.push({
        type: "warning",
        message: `Foreign key used in JOIN on ${join.table}: ${cond.right}`,
        suggestion: `Ensure there is an index on ${cond.right} to avoid full table scans.`
      });
    }
  }
  return warnings;
}

// src/exec/normalize.ts
function normalizeRows(rows, ast) {
  const root = ast.root;
  const store = {};
  const initializeMaps = (node) => {
    store[node.alias] = /* @__PURE__ */ new Map();
    for (const rel of node.relations) {
      initializeMaps(rel);
    }
  };
  initializeMaps(root);
  for (const row of rows) {
    processNode(root, row, store);
  }
  return Array.from(store[root.alias].values());
}
function processNode(node, row, store) {
  const prefix = `${node.alias}__`;
  const id = row[`${prefix}id`];
  if (id === null || id === void 0) return void 0;
  let obj = store[node.alias].get(id);
  if (!obj) {
    obj = { id };
    for (const [key, val] of Object.entries(row)) {
      if (key.startsWith(prefix)) {
        obj[key.replace(prefix, "")] = val;
      }
    }
    store[node.alias].set(id, obj);
  }
  for (const rel of node.relations) {
    const relObj = processNode(rel, row, store);
    if (relObj) {
      const relName = rel.table;
      if (!obj[relName]) obj[relName] = [];
      const children = obj[relName];
      if (!children.some((item) => item.id === relObj.id)) {
        children.push(relObj);
      }
    }
  }
  return obj;
}

// src/index.ts
function kadak(config) {
  const client = new KadakClient(config.url);
  let normalizedSchema = {};
  return {
    schema(userSchema) {
      const validated = validateSchemaDef(userSchema);
      normalizedSchema = normalizeSchema(validated);
      return {
        async push() {
          await transaction(client, async (tx) => {
            const currentDbSchema = await introspect(tx);
            const ops = diffSchemas(normalizedSchema, currentDbSchema);
            const statements = generateSQL(ops);
            for (const sql of statements) {
              await tx.query(sql);
            }
          });
        }
      };
    },
    data(queryInput) {
      const validatedQuery = validateQueryInput(queryInput);
      const rootTable = Object.keys(validatedQuery)[0];
      const qBuilder = new QueryBuilder(normalizedSchema);
      const ast = qBuilder.buildAST(rootTable, validatedQuery);
      const planner = new Planner(normalizedSchema);
      const plan = planner.plan(ast.root);
      const compiler = new Compiler(normalizedSchema);
      const compiled = compiler.compile(plan);
      const warnings = analyzePlan(plan);
      if (warnings.length > 0) {
        console.warn("Kadak Analyzer Warnings:");
        warnings.forEach((w) => console.warn(`\u26A0\uFE0F  ${w.message}
   Suggestion: ${w.suggestion}`));
      }
      const executor = {
        async execute() {
          const rows = await client.execute(compiled);
          return normalizeRows(rows, ast);
        },
        toSQL() {
          return compiled;
        },
        async explain() {
          return await client.explain(compiled);
        }
      };
      const promise = executor.execute();
      promise.toSQL = () => executor.toSQL();
      promise.explain = () => executor.explain();
      return promise;
    },
    async tx(callback) {
      return transaction(client, async (txClient) => {
        return callback(txClient);
      });
    },
    async close() {
      await client.close();
    }
  };
}
export {
  ColumnDefSchema,
  Compiler,
  KadakClient,
  Planner,
  QueryBuilder,
  QueryInputSchema,
  RefSchema,
  ScalarSchema,
  SchemaDefSchema,
  TableDefSchema,
  analyzePlan,
  kadak,
  normalizeColumn,
  normalizeRows,
  normalizeSchema,
  transaction,
  validateQueryInput,
  validateSchemaDef
};
//# sourceMappingURL=index.js.map