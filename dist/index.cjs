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
  buildPlan: () => buildPlan,
  closePool: () => closePool,
  compileSQL: () => compileSQL,
  kadak: () => kadak,
  normalize: () => normalize,
  runQuery: () => runQuery
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
    selections.push(`${tableId}.id AS ${tableId}__id`);
    for (const [field, mapping] of Object.entries(tableSchema)) {
      if (field === "id") continue;
      if (typeof mapping === "string" && mapping.includes(".")) continue;
      selections.push(`${tableId}."${field}" AS ${tableId}__${field}`);
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
async function runQuery(sql, values, url) {
  if (!pool && url) {
    pool = new import_pg.default.Pool({ connectionString: url });
  }
  if (!pool) throw new Error("Database pool not initialized");
  const res = await pool.query(sql, values);
  return res.rows;
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
    const id = row[`${rootPrefix}id`];
    if (id === null || id === void 0) continue;
    let rootObj = rootMap.get(id);
    if (!rootObj) {
      rootObj = { id };
      for (const [key, val] of Object.entries(row)) {
        if (key.startsWith(rootPrefix) && key !== `${rootPrefix}id`) {
          rootObj[key.replace(rootPrefix, "")] = val;
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

// src/schema/validator.ts
function validateInput(input, schema) {
  if (Object.keys(input).length === 0) {
    throw new Error("Input cannot be empty");
  }
  const rootTable = Object.keys(input)[0];
  if (!schema[rootTable] && rootTable !== "where") {
    throw new Error(`Missing schema mapping for table: ${rootTable}`);
  }
  validateNode(rootTable, input[rootTable], schema);
}
function validateNode(tableName, nodeInput, schema) {
  const tableSchema = schema[tableName] || {};
  for (const [key, value] of Object.entries(nodeInput)) {
    if (key === "where") {
      const whereObj = value;
      for (const field of Object.keys(whereObj)) {
        if (field !== "id" && !tableSchema[field]) {
          throw new Error(`Invalid where field: ${field} not found on ${tableName}`);
        }
      }
    } else if (key === "limit" || key === "orderBy") {
      continue;
    } else {
      const target = tableSchema[key];
      if (!target) {
        throw new Error(`Invalid relation: ${key} not found on ${tableName}`);
      }
      if (typeof value === "object" && value !== null) {
        const [targetTable] = target.split(".");
        validateNode(targetTable, value, schema);
      }
    }
  }
}

// src/schema/migrator.ts
function buildSchemaSQL(definition) {
  const statements = [];
  const indexStatements = [];
  for (const [tableName, columns] of Object.entries(definition)) {
    const colDefs = ["id SERIAL PRIMARY KEY"];
    const fkDefs = [];
    for (const [colName, def] of Object.entries(columns)) {
      let typeStr = "";
      let constraints = "";
      let refTable = "";
      let onDelete = "";
      const isObject = typeof def === "object" && def !== null;
      const shorthand = typeof def === "string" ? def : "";
      if (shorthand === "string" || isObject && def.type === "string") {
        typeStr = "VARCHAR(255)";
      } else if (isObject && def.type === "varchar") {
        typeStr = `VARCHAR(${def.length || 255})`;
      } else if (shorthand === "int" || isObject && def.type === "int") {
        typeStr = "INTEGER";
      } else if (shorthand === "text" || isObject && def.type === "text") {
        typeStr = "TEXT";
      } else if (shorthand === "jsonb" || isObject && def.type === "jsonb") {
        typeStr = "JSONB";
      } else if (shorthand.startsWith("ref:")) {
        refTable = shorthand.split(":")[1];
        typeStr = "INTEGER";
      } else if (isObject && def.ref) {
        refTable = def.ref;
        typeStr = "INTEGER";
        onDelete = def.onDelete ? ` ON DELETE ${def.onDelete.toUpperCase()}` : "";
      }
      if (isObject) {
        if (def.unique) constraints += " UNIQUE";
        if (def.nullable === false) constraints += " NOT NULL";
        if (def.default !== void 0) {
          const val = typeof def.default === "string" ? `'${def.default}'` : def.default;
          constraints += ` DEFAULT ${val}`;
        }
        if (def.index) {
          indexStatements.push(`CREATE INDEX IF NOT EXISTS idx_${tableName}_${colName} ON ${tableName}("${colName}");`);
        }
      }
      if (typeStr) {
        colDefs.push(`"${colName}" ${typeStr}${constraints}`);
      }
      if (refTable) {
        fkDefs.push(`FOREIGN KEY ("${colName}") REFERENCES ${refTable}(id)${onDelete}`);
      }
    }
    const allDefs = [...colDefs, ...fkDefs];
    statements.push(`CREATE TABLE IF NOT EXISTS ${tableName} (
  ${allDefs.join(",\n  ")}
);`);
  }
  return [...statements, ...indexStatements];
}
async function pushSchema(definition, url) {
  const statements = buildSchemaSQL(definition);
  for (const sql of statements) {
    await runQuery(sql, [], url);
  }
}

// src/index.ts
function kadak(config) {
  let _currentSchema = {};
  const _url = config.url;
  const data = (input, options = {}) => {
    validateInput(input, _currentSchema);
    const ast = buildAST(input);
    const plan = buildPlan(ast, _currentSchema);
    const { text: sql, values } = compileSQL(plan, _currentSchema);
    const execution = async () => {
      let rows = [];
      try {
        rows = await runQuery(sql, values, _url);
      } catch (e) {
        if (options.debug) console.error("Execution failed:", e.message);
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
      return await runQuery(explainSql, values, _url);
    };
    queryObj.trace = () => ({ ast, plan, sql, values });
    return queryObj;
  };
  const instance = {
    schema(definition) {
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
            console.warn("\u26A0\uFE0F [Kadak] push() called in production. Ensure this is intentional.");
          }
          await pushSchema(definition, _url);
        }
      };
      return Object.assign(instance, pushObj);
    },
    data,
    close: closePool
  };
  return instance;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildAST,
  buildPlan,
  closePool,
  compileSQL,
  kadak,
  normalize,
  runQuery
});
//# sourceMappingURL=index.cjs.map