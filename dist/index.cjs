"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  buildAST: () => buildAST,
  buildDeleteSQL: () => buildDeleteSQL,
  buildInsertSQL: () => buildInsertSQL,
  buildPlan: () => buildPlan,
  buildUpdateSQL: () => buildUpdateSQL,
  closePool: () => closePool,
  compileSQL: () => compileSQL,
  getTransactionClient: () => getTransactionClient,
  kadak: () => kadak,
  normalize: () => normalize,
  runQuery: () => runQuery,
  t: () => t
});
module.exports = __toCommonJS(index_exports);

// src/query/builder.ts
function buildAST(queryInput) {
  const rootKey = Object.keys(queryInput)[0];
  const rootValue = queryInput[rootKey];
  const { where, relations, orderBy } = parseNode(rootValue);
  return {
    root: rootKey,
    where: where.length > 0 ? where : void 0,
    orderBy,
    relations
  };
}
function parseNode(input) {
  const where = [];
  const relations = [];
  let orderBy;
  for (const [key, value] of Object.entries(input)) {
    if (key === "where") {
      const whereObj = value;
      for (const [field, val] of Object.entries(whereObj)) {
        where.push({ field, value: val });
      }
    } else if (key === "orderBy") {
      const orderObj = value;
      const field = Object.keys(orderObj)[0];
      const direction = orderObj[field].toLowerCase();
      orderBy = { field, direction };
    } else if (value === true || typeof value === "object" && value !== null) {
      const relationInput = value === true ? {} : value;
      const { relations: nestedRelations } = parseNode(relationInput);
      relations.push({
        name: key,
        relations: nestedRelations
      });
    }
  }
  return { where, relations, orderBy };
}

// src/query/planner.ts
function buildPlan(ast, schema) {
  const plan = {
    from: ast.root,
    joins: [],
    where: ast.where,
    orderBy: ast.orderBy
  };
  traverse(ast.root, ast.relations, plan, schema);
  return plan;
}
function traverse(parentTableOrAlias, relations, plan, schema) {
  for (const rel of relations) {
    const parentTable = findTable(parentTableOrAlias, plan);
    const target = schema[parentTable]?.[rel.name];
    if (!target) {
      throw new Error(`Invalid relation: ${rel.name} not found on ${parentTable}`);
    }
    const [targetTable, targetField] = target.split(".");
    const alias = rel.name !== targetTable ? rel.name : void 0;
    const targetIdentifier = alias || targetTable;
    let onCondition;
    if (targetField === "id") {
      onCondition = [`${parentTableOrAlias}.${rel.name}id`, `${targetIdentifier}.${targetField}`];
    } else {
      onCondition = [`${targetIdentifier}.${targetField}`, `${parentTableOrAlias}.id`];
    }
    plan.joins.push({
      table: targetTable,
      alias,
      on: onCondition
    });
    traverse(targetIdentifier, rel.relations, plan, schema);
  }
}
function findTable(id, plan) {
  if (id === plan.from) return id;
  const join = plan.joins.find((j) => (j.alias || j.table) === id);
  return join ? join.table : id;
}

// src/query/compiler.ts
function compileSQL(plan, schema) {
  const values = [];
  const selections = [];
  const addTableColumns = (tableName, alias) => {
    const tableId = alias || tableName;
    const tableSchema = schema[tableName] || {};
    selections.push(`${tableId}.id AS "${tableId}__id"`);
    for (const [field, mapping] of Object.entries(tableSchema)) {
      if (field === "id") continue;
      if (typeof mapping === "string" && mapping.includes(".")) continue;
      selections.push(`${tableId}."${field}" AS "${tableId}__${field}"`);
    }
  };
  addTableColumns(plan.from);
  for (const join of plan.joins) {
    addTableColumns(join.table, join.alias);
  }
  let sql = `SELECT ${selections.join(", ")} FROM ${plan.from}
`;
  for (const join of plan.joins) {
    const aliasStr = join.alias ? ` ${join.alias}` : "";
    const [onLeft, onRight] = join.on.map((part) => {
      const [table, field] = part.split(".");
      return `${table}."${field}"`;
    });
    sql += `LEFT JOIN ${join.table}${aliasStr} ON ${onRight} = ${onLeft}
`;
  }
  if (plan.where && plan.where.length > 0) {
    const whereClauses = plan.where.map((p) => {
      values.push(p.value);
      return `${plan.from}."${p.field}" = $${values.length}`;
    }).join(" AND ");
    sql += `WHERE ${whereClauses}
`;
  }
  if (plan.orderBy) {
    sql += `ORDER BY ${plan.from}."${plan.orderBy.field}" ${plan.orderBy.direction.toUpperCase()}
`;
  }
  return { text: sql.trim(), values };
}

// src/exec/client.ts
var import_pg = __toESM(require("pg"), 1);
var pool = null;
async function runQuery(sql, values, url, client) {
  if (client) {
    const res2 = await client.query(sql, values);
    return res2.rows;
  }
  if (!pool && url) {
    pool = new import_pg.default.Pool({ connectionString: url });
  }
  if (!pool) throw new Error("Database pool not initialized");
  const res = await pool.query(sql, values);
  return res.rows;
}
async function getTransactionClient(url) {
  if (!pool && url) {
    pool = new import_pg.default.Pool({ connectionString: url });
  }
  if (!pool) throw new Error("Database pool not initialized");
  return await pool.connect();
}
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// src/exec/normalize.ts
function normalize(rows, ast, schema) {
  const rootMap = /* @__PURE__ */ new Map();
  const results = [];
  const rootPrefix = `${ast.root}__`;
  for (const row of rows) {
    const id = row[`${rootPrefix}id`] ?? row.id;
    if (id === null || id === void 0) continue;
    let rootObj = rootMap.get(id);
    if (!rootObj) {
      rootObj = { id };
      for (const [key, val] of Object.entries(row)) {
        if (key.startsWith(rootPrefix)) {
          if (key !== `${rootPrefix}id`) rootObj[key.replace(rootPrefix, "")] = val;
        } else if (!key.includes("__")) {
          if (key !== "id") rootObj[key] = val;
        }
      }
      rootMap.set(id, rootObj);
      results.push(rootObj);
    }
    processRelations(ast.root, rootObj, row, ast.relations, schema);
  }
  return results;
}
function processRelations(parentTable, parentObj, row, relations, schema) {
  for (const rel of relations) {
    const target = schema[parentTable]?.[rel.name];
    if (!target) continue;
    const [targetTable, targetField] = target.split(".");
    const isOneToMany = targetField !== "id";
    const prefix = `${rel.name}__`;
    const relId = row[`${prefix}id`];
    if (relId === null || relId === void 0) {
      if (!parentObj.hasOwnProperty(rel.name)) {
        parentObj[rel.name] = isOneToMany ? [] : null;
      }
      continue;
    }
    let relObj;
    if (isOneToMany) {
      if (!parentObj[rel.name]) parentObj[rel.name] = [];
      relObj = parentObj[rel.name].find((item) => item.id === relId);
    } else {
      relObj = parentObj[rel.name];
    }
    if (!relObj) {
      relObj = { id: relId };
      for (const [key, val] of Object.entries(row)) {
        if (key.startsWith(prefix) && key !== `${prefix}id`) {
          relObj[key.replace(prefix, "")] = val;
        }
      }
      if (isOneToMany) {
        parentObj[rel.name].push(relObj);
      } else {
        parentObj[rel.name] = relObj;
      }
    }
    if (rel.relations.length > 0) {
      processRelations(targetTable, relObj, row, rel.relations, schema);
    }
  }
}

// src/exec/mutations.ts
function buildInsertSQL(table, data) {
  const fields = [];
  const values = [];
  const valuePlaceholders = [];
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return { sql: `INSERT INTO ${table} DEFAULT VALUES RETURNING *`, values: [] };
  }
  entries.forEach(([field, val]) => {
    fields.push(field);
    if (val === "NOW()") {
      valuePlaceholders.push("NOW()");
    } else {
      values.push(val);
      valuePlaceholders.push(`$${values.length}`);
    }
  });
  const sql = `INSERT INTO ${table} (${fields.map((f) => `"${f}"`).join(", ")}) VALUES (${valuePlaceholders.join(", ")}) RETURNING *`;
  return { sql, values };
}
function buildUpdateSQL(table, where, data) {
  const values = [];
  const setClauses = [];
  Object.entries(data).forEach(([field, val]) => {
    if (val === "NOW()") {
      setClauses.push(`"${field}" = NOW()`);
    } else {
      values.push(val);
      setClauses.push(`"${field}" = $${values.length}`);
    }
  });
  const whereClauses = [];
  Object.entries(where).forEach(([field, val]) => {
    values.push(val);
    whereClauses.push(`"${field}" = $${values.length}`);
  });
  const sql = `UPDATE ${table} SET ${setClauses.join(", ")} WHERE ${whereClauses.join(" AND ")} RETURNING *`;
  return { sql, values };
}
function buildDeleteSQL(table, where) {
  const whereFields = Object.keys(where);
  const whereValues = Object.values(where);
  const whereClauses = whereFields.map((f, i) => `"${f}" = $${i + 1}`).join(" AND ");
  const sql = `DELETE FROM ${table} WHERE ${whereClauses} RETURNING *`;
  return { sql, values: whereValues };
}

// src/schema/validator.ts
function validateInput(input, schema) {
  if (Object.keys(input).length === 0) {
    throw new Error("\u274C Kadak Error: Input cannot be empty. Please provide a table to query.");
  }
  const rootTable = Object.keys(input)[0];
  if (!schema[rootTable] && rootTable !== "where") {
    const suggestions = getSuggestions(rootTable, Object.keys(schema));
    throw new Error(`\u274C Kadak Error: Table '${rootTable}' not found. ${suggestions}`);
  }
  validateNode(rootTable, input[rootTable], schema);
}
function validateNode(tableName, nodeInput, schema) {
  const tableSchema = schema[tableName] || {};
  const validFields = Object.keys(tableSchema);
  for (const [key, value] of Object.entries(nodeInput)) {
    if (key === "where") {
      const whereObj = value;
      for (const field of Object.keys(whereObj)) {
        if (field !== "id" && !tableSchema[field]) {
          const suggestions = getSuggestions(field, validFields);
          throw new Error(`\u274C Kadak Error: Invalid filter field '${field}' on table '${tableName}'. ${suggestions}`);
        }
      }
    } else if (key === "limit" || key === "orderBy") {
      continue;
    } else {
      const target = tableSchema[key];
      if (!target) {
        const suggestions = getSuggestions(key, validFields);
        throw new Error(`\u274C Kadak Error: Relation '${key}' not found on table '${tableName}'. ${suggestions}`);
      }
      if (typeof value === "object" && value !== null) {
        const [targetTable] = target.split(".");
        validateNode(targetTable, value, schema);
      }
    }
  }
}
function getSuggestions(input, validOptions) {
  if (validOptions.length === 0) return "";
  const matches = validOptions.filter((opt) => opt.includes(input) || input.includes(opt));
  if (matches.length > 0) {
    return `Did you mean: ${matches.join(", ")}?`;
  }
  return `Available: ${validOptions.join(", ")}`;
}

// src/schema/migrator.ts
var import_crypto = require("crypto");
var ColumnBuilder = class {
  obj = {};
  constructor(type) {
    if (type) this.obj.type = type;
  }
  default(val) {
    this.obj.default = val;
    return this;
  }
  defaultNow() {
    this.obj.default = "NOW()";
    return this;
  }
  unique() {
    this.obj.unique = true;
    return this;
  }
  nullable(val = true) {
    this.obj.nullable = val;
    return this;
  }
  notNull() {
    this.obj.nullable = false;
    return this;
  }
  length(val) {
    this.obj.length = val;
    return this;
  }
  onDelete(val) {
    this.obj.onDelete = val;
    return this;
  }
  index() {
    this.obj.index = true;
    return this;
  }
  // Internal helper to get the raw object
  build() {
    return this.obj;
  }
};
var t = {
  string: () => new ColumnBuilder("string"),
  varchar: (len) => new ColumnBuilder("varchar").length(len || 255),
  int: () => new ColumnBuilder("int"),
  text: () => new ColumnBuilder("text"),
  jsonb: () => new ColumnBuilder("jsonb"),
  timestamp: () => new ColumnBuilder("timestamp"),
  ref: (table) => {
    const b = new ColumnBuilder();
    b.obj.ref = table;
    b.obj.type = "int";
    return b;
  },
  timestamps: () => ({
    createdAt: new ColumnBuilder("timestamp").defaultNow().build(),
    updatedAt: { type: "timestamp", default: "NOW()", autoUpdate: true }
  })
};
function generateColumnSQL(colName, rawDef, tableName, indexStatements) {
  if (typeof rawDef === "string" && rawDef.includes(".")) {
    return { columnSQL: null };
  }
  const def = typeof rawDef?.build === "function" ? rawDef.build() : typeof rawDef === "string" ? { type: rawDef } : rawDef;
  let typeStr = "";
  let constraints = "";
  let refTable = "";
  let onDelete = "";
  if (def.type === "string") {
    typeStr = "VARCHAR(255)";
  } else if (def.type === "varchar") {
    typeStr = `VARCHAR(${def.length || 255})`;
  } else if (def.type === "int") {
    typeStr = "INTEGER";
  } else if (def.type === "text") {
    typeStr = "TEXT";
  } else if (def.type === "jsonb") {
    typeStr = "JSONB";
  } else if (def.type === "timestamp") {
    typeStr = "TIMESTAMP";
  } else if (typeof rawDef === "string" && rawDef.startsWith("ref:")) {
    refTable = rawDef.split(":")[1];
    typeStr = "INTEGER";
  } else if (def.ref) {
    refTable = def.ref;
    typeStr = "INTEGER";
    onDelete = def.onDelete ? ` ON DELETE ${def.onDelete.toUpperCase()}` : "";
  }
  if (def.unique) constraints += " UNIQUE";
  if (def.nullable === false) constraints += " NOT NULL";
  if (def.default !== void 0) {
    const val = def.default === "NOW()" ? "NOW()" : typeof def.default === "string" ? `'${def.default}'` : def.default;
    constraints += ` DEFAULT ${val}`;
  }
  if (def.index) {
    indexStatements.push(`CREATE INDEX IF NOT EXISTS idx_${tableName}_${colName} ON ${tableName}("${colName}");`);
  }
  let fkSQL;
  if (refTable) {
    fkSQL = `ALTER TABLE ${tableName} ADD CONSTRAINT fk_${tableName}_${colName} FOREIGN KEY ("${colName}") REFERENCES ${refTable}(id)${onDelete}`;
  }
  return { columnSQL: `"${colName}" ${typeStr}${constraints}`, fkSQL };
}
function buildSchemaSQL(definition) {
  const statements = [];
  const indexStatements = [];
  for (const [tableName, columns] of Object.entries(definition)) {
    const colDefs = ["id SERIAL PRIMARY KEY"];
    const fks = [];
    for (const [colName, rawDef] of Object.entries(columns)) {
      const { columnSQL, fkSQL } = generateColumnSQL(colName, rawDef, tableName, indexStatements);
      if (columnSQL) colDefs.push(columnSQL);
      if (fkSQL) {
        const match = fkSQL.match(/FOREIGN KEY .*/);
        if (match) fks.push(match[0]);
      }
    }
    const allDefs = [...colDefs, ...fks];
    statements.push(`CREATE TABLE IF NOT EXISTS ${tableName} (
  ${allDefs.join(",\n  ")}
);`);
  }
  return [...statements, ...indexStatements];
}
function calculateHash(definition) {
  const str = JSON.stringify(definition, (key, value) => {
    if (value instanceof ColumnBuilder) return value.build();
    return value;
  });
  return (0, import_crypto.createHash)("sha256").update(str).digest("hex");
}
async function pushSchema(definition, url) {
  const currentHash = calculateHash(definition);
  await runQuery(`
    CREATE TABLE IF NOT EXISTS _kadak_migrations (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      executed_at TIMESTAMP DEFAULT NOW()
    );
  `, [], url);
  await runQuery(`CREATE UNIQUE INDEX IF NOT EXISTS _kadak_migrations_hash_idx ON _kadak_migrations (hash)`, [], url);
  const existing = await runQuery(`SELECT id FROM _kadak_migrations WHERE hash = $1`, [currentHash], url);
  if (existing.length > 0) {
    console.log("\u2139\uFE0F [Kadak] No changes detected. Schema is up to date.");
    return;
  }
  const existingTablesRes = await runQuery(`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
  `, [], url);
  const existingTables = new Set(existingTablesRes.map((r) => r.table_name));
  const statements = [];
  const indexStatements = [];
  for (const [tableName, columns] of Object.entries(definition)) {
    if (!existingTables.has(tableName)) {
      console.log(`\u2728 [Kadak] New table detected: ${tableName}`);
      const subDef = { [tableName]: columns };
      statements.push(...buildSchemaSQL(subDef));
    } else {
      const existingColsRes = await runQuery(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = $1
      `, [tableName], url);
      const existingCols = new Set(existingColsRes.map((r) => r.column_name));
      for (const [colName, rawDef] of Object.entries(columns)) {
        if (!existingCols.has(colName)) {
          const { columnSQL, fkSQL } = generateColumnSQL(colName, rawDef, tableName, indexStatements);
          if (columnSQL) {
            console.log(`\u2795 [Kadak] New column detected: ${tableName}.${colName}`);
            statements.push(`ALTER TABLE ${tableName} ADD COLUMN ${columnSQL};`);
          }
          if (fkSQL) statements.push(fkSQL + ";");
        }
      }
    }
  }
  const allSql = [...statements, ...indexStatements];
  if (allSql.length > 0) {
    for (const sql of allSql) {
      await runQuery(sql, [], url);
    }
    await runQuery(`INSERT INTO _kadak_migrations (hash) VALUES ($1)`, [currentHash], url);
    console.log("\u2705 [Kadak] Schema migration applied successfully.");
  } else {
    await runQuery(`INSERT INTO _kadak_migrations (hash) VALUES ($1)`, [currentHash], url);
    console.log("\u2139\uFE0F [Kadak] Migration metadata updated.");
  }
}

// src/index.ts
var kadak = (config) => {
  let _currentSchema = {};
  let _rawDefinition = {};
  const _url = config.url;
  const data = (input, options = {}) => {
    validateInput(input, _currentSchema);
    const ast = buildAST(input);
    const plan = buildPlan(ast, _currentSchema);
    const { text: sql, values } = compileSQL(plan, _currentSchema);
    const execution = async () => {
      let rows = [];
      try {
        rows = await runQuery(sql, values, _url, options.client);
      } catch (e) {
        if (options.debug) console.error("\u274C Kadak Execution Error:", e.message);
        rows = [];
      }
      const normalized = normalize(rows, ast, _currentSchema);
      return options.debug ? { sql, values, rows, data: normalized } : normalized;
    };
    const promise = execution();
    const queryObj = promise;
    queryObj.toSQL = () => ({ sql, values });
    queryObj.explain = async () => {
      const explainSql = `EXPLAIN ANALYZE ${sql}`;
      return await runQuery(explainSql, values, _url, options.client);
    };
    queryObj.trace = () => ({ ast, plan, sql, values });
    return queryObj;
  };
  const instance = {
    define(tables) {
      for (const [key, table] of Object.entries(tables)) {
        const tableName = table.config.name;
        const columns = table.config.columns;
        _rawDefinition[tableName] = columns;
        _currentSchema[tableName] = {};
        for (const [col, rawDef] of Object.entries(columns)) {
          const def = rawDef instanceof ColumnBuilder ? rawDef.build() : typeof rawDef === "string" ? { type: rawDef } : rawDef;
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
      return instance;
    },
    async push() {
      if (process.env.NODE_ENV === "production") {
        console.warn("\u26A0\uFE0F [Kadak] push() called in production. Ensure this is intentional.");
      }
      await pushSchema(_rawDefinition, _url);
    },
    async insert(table, data2, options = {}) {
      const tableName = String(table);
      const tableSchema = _currentSchema[tableName];
      if (!tableSchema) {
        throw new Error(`\u274C Kadak Error: Table '${tableName}' not found in defined schema.`);
      }
      for (const field of Object.keys(data2)) {
        if (field !== "id" && !tableSchema[field]) {
          throw new Error(`\u274C Kadak Error: Invalid field '${field}' on table '${tableName}'.`);
        }
      }
      const { sql, values } = buildInsertSQL(tableName, data2);
      const rows = await runQuery(sql, values, _url, options.client);
      const ast = { root: tableName, relations: [] };
      return normalize(rows, ast, _currentSchema)[0];
    },
    async update(table, options) {
      const tableName = String(table);
      const tableSchema = _currentSchema[tableName];
      if (!tableSchema) {
        throw new Error(`\u274C Kadak Error: Table '${tableName}' not found in defined schema.`);
      }
      if (!options.where || Object.keys(options.where).length === 0) {
        throw new Error(`\u274C Kadak Error: Update mutation requires a 'where' clause.`);
      }
      for (const [col, def] of Object.entries(tableSchema)) {
        if (typeof def === "object" && def !== null && def.autoUpdate) {
          options.data[col] = "NOW()";
        }
      }
      for (const field of Object.keys(options.data)) {
        if (field !== "id" && !tableSchema[field]) {
          throw new Error(`\u274C Kadak Error: Invalid field '${field}' on table '${tableName}'.`);
        }
      }
      for (const field of Object.keys(options.where)) {
        if (field !== "id" && !tableSchema[field]) {
          throw new Error(`\u274C Kadak Error: Invalid filter field '${field}' on table '${tableName}'.`);
        }
      }
      const { sql, values } = buildUpdateSQL(tableName, options.where, options.data);
      const rows = await runQuery(sql, values, _url, options.client);
      const ast = { root: tableName, relations: [] };
      return normalize(rows, ast, _currentSchema);
    },
    async delete(table, options) {
      const tableName = String(table);
      const tableSchema = _currentSchema[tableName];
      if (!tableSchema) {
        throw new Error(`\u274C Kadak Error: Table '${tableName}' not found in defined schema.`);
      }
      if (!options.where || Object.keys(options.where).length === 0) {
        throw new Error(`\u274C Kadak Error: Delete mutation requires a 'where' clause.`);
      }
      for (const field of Object.keys(options.where)) {
        if (field !== "id" && !tableSchema[field]) {
          throw new Error(`\u274C Kadak Error: Invalid filter field '${field}' on table '${tableName}'.`);
        }
      }
      const { sql, values } = buildDeleteSQL(tableName, options.where);
      const rows = await runQuery(sql, values, _url, options.client);
      const ast = { root: tableName, relations: [] };
      return normalize(rows, ast, _currentSchema);
    },
    async transaction(fn) {
      const client = await getTransactionClient(_url);
      try {
        await client.query("BEGIN");
        const tx = {
          data: (input, opts = {}) => data(input, { ...opts, client }),
          insert: (table, d, opts = {}) => instance.insert(table, d, { ...opts, client }),
          update: (table, opts) => instance.update(table, { ...opts, client }),
          delete: (table, opts) => instance.delete(table, { ...opts, client })
        };
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (e) {
        try {
          await client.query("ROLLBACK");
        } catch (err) {
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
kadak.table = (config) => {
  return { config };
};
kadak.t = t;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildAST,
  buildDeleteSQL,
  buildInsertSQL,
  buildPlan,
  buildUpdateSQL,
  closePool,
  compileSQL,
  getTransactionClient,
  kadak,
  normalize,
  runQuery,
  t
});
//# sourceMappingURL=index.cjs.map