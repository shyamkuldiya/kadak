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
  types: () => types
});
module.exports = __toCommonJS(index_exports);

// src/query/builder.ts
function buildAST(queryInput) {
  const rootKey = Object.keys(queryInput)[0];
  const rootValue = queryInput[rootKey];
  const { where, relations, orderBy, select, take, skip, _count } = parseNode(rootValue, true);
  return {
    root: rootKey,
    _count,
    select,
    take,
    skip,
    where: where.length > 0 ? where : void 0,
    orderBy,
    relations
  };
}
function parseNode(input, isRoot) {
  const where = [];
  const relations = [];
  let orderBy;
  let select;
  let take;
  let skip;
  let _count;
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
    } else if (key === "select") {
      select = {};
      for (const [field, enabled] of Object.entries(value)) {
        if (enabled) select[field] = true;
      }
    } else if (key === "_count") {
      _count = Boolean(value);
    } else if (key === "take") {
      if (!isRoot) {
        throw new Error("Kadak Error: nested pagination is not supported yet");
      }
      take = Number(value);
    } else if (key === "skip") {
      if (!isRoot) {
        throw new Error("Kadak Error: nested pagination is not supported yet");
      }
      skip = Number(value);
    } else if (value === true || typeof value === "object" && value !== null) {
      const relationInput = value === true ? {} : value;
      const relationCount = relationInput._count === true;
      const { relations: nestedRelations, select: nestedSelect } = parseNode(relationInput, false);
      relations.push({
        name: key,
        _count: relationCount,
        select: nestedSelect,
        relations: nestedRelations
      });
    }
  }
  return { where, relations, orderBy, select, take, skip, _count };
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
    const relation = typeof target === "string" ? { table: target.split(".")[0], as: rel.name, to: target.split(".")[1] || "id", source: "id" } : target;
    const targetTable = relation.table;
    const targetField = relation.to || "id";
    const alias = relation.as !== targetTable ? relation.as : void 0;
    const targetIdentifier = alias || targetTable;
    let onCondition;
    onCondition = [`${parentTableOrAlias}.${relation.source}`, `${targetIdentifier}.${targetField}`];
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
function compileSQL(plan, ast, schema) {
  const values = [];
  const selections = [];
  const countJoins = [];
  if (ast._count) {
    let sql2 = `SELECT COUNT(*) AS "_count" FROM ${plan.from}
`;
    if (plan.where && plan.where.length > 0) {
      const whereClauses = plan.where.map((p) => {
        values.push(p.value);
        return `${plan.from}."${p.field}" = $${values.length}`;
      }).join(" AND ");
      sql2 += `WHERE ${whereClauses}
`;
    }
    return { text: sql2.trim(), values };
  }
  const addTableColumns = (tableName, alias, select) => {
    const tableId = alias || tableName;
    const tableSchema = schema[tableName] || {};
    const fields = select ? Object.keys(select) : Object.keys(tableSchema).filter((field) => {
      const mapping = tableSchema[field];
      if (field === "id") return false;
      if (typeof mapping === "string" && mapping.includes(".")) return false;
      if (typeof mapping === "object" && mapping !== null && "table" in mapping && "as" in mapping) return false;
      return true;
    });
    if (true) {
      selections.push(`${tableId}.id AS "${tableId}${alias ? "_" : "__"}id"`);
    }
    for (const field of fields) {
      if (field === "id") continue;
      selections.push(`${tableId}."${field}" AS "${tableId}${alias ? "_" : "__"}${field}"`);
    }
  };
  const walkRelations = (tableName, relations) => {
    for (const rel of relations) {
      const mapping = schema[tableName]?.[rel.name];
      if (!mapping) continue;
      const relation = typeof mapping === "string" ? { table: mapping.split(".")[0], as: rel.name, to: mapping.split(".")[1] || "id", source: "id" } : mapping;
      const alias = relation.as !== relation.table ? relation.as : void 0;
      if (rel._count) {
        const countAlias = `${rel.name}__count_join`;
        countJoins.push(`LEFT JOIN (
    SELECT "${relation.to}" AS "__kadak_fk", COUNT(*) AS "__kadak_count"
    FROM ${relation.table}
    GROUP BY "${relation.to}"
  ) ${countAlias} ON ${countAlias}."__kadak_fk" = ${plan.from}."${relation.source}"`);
        selections.push(`COALESCE(${countAlias}."__kadak_count", 0) AS "${rel.name}__count"`);
      }
      addTableColumns(relation.table, alias, rel.select);
      walkRelations(relation.table, rel.relations);
    }
  };
  addTableColumns(plan.from, void 0, ast.select);
  walkRelations(plan.from, ast.relations);
  let sql = `SELECT ${selections.join(", ")} FROM ${plan.from}
`;
  for (const join of countJoins) {
    sql += `${join}
`;
  }
  for (const join of plan.joins) {
    const rootRelation = ast.relations.find((rel) => rel.name === (join.alias || join.table));
    if (rootRelation && rootRelation._count && !rootRelation.select && (!rootRelation.relations || rootRelation.relations.length === 0)) {
      continue;
    }
    const aliasStr = join.alias ? ` ${join.alias}` : "";
    const [onLeft, onRight] = join.on.map((part) => {
      const [table, field] = part.split(".");
      return `${table}."${field}"`;
    });
    sql += `LEFT JOIN ${join.table}${aliasStr} ON ${onLeft} = ${onRight}
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
  if (ast.take !== void 0) {
    sql += `LIMIT ${ast.take}
`;
  }
  if (ast.skip !== void 0) {
    sql += `OFFSET ${ast.skip}
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
  const directRelationPrefixes = new Set(ast.relations.map((rel) => `${rel.name}_`));
  const exposeRootId = !ast.select || !!ast.select.id;
  for (const row of rows) {
    const id = row[`${rootPrefix}id`] ?? row.id;
    if (id === null || id === void 0) continue;
    let rootObj = rootMap.get(id);
    if (!rootObj) {
      rootObj = {};
      if (exposeRootId) {
        rootObj.id = id;
      }
      for (const [key, val] of Object.entries(row)) {
        if (key.startsWith(rootPrefix)) {
          if (key !== `${rootPrefix}id`) rootObj[key.replace(rootPrefix, "")] = val;
        } else if (!key.includes("__") && !Array.from(directRelationPrefixes).some((prefix) => key.startsWith(prefix))) {
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
    const relation = typeof target === "string" ? { table: target.split(".")[0], as: rel.name, to: target.split(".")[1] || "id", source: rel.name } : target;
    const targetTable = relation.table;
    const targetField = relation.to;
    const isOneToMany = targetField !== "id";
    if (rel._count) {
      const countKey = `${rel.name}__count`;
      const countValue = row[countKey];
      parentObj[rel.name] = { _count: typeof countValue === "string" ? Number(countValue) : Number(countValue ?? 0) };
      continue;
    }
    const prefix = `${rel.name}_`;
    const relId = row[`${prefix}id`];
    if (relId === null || relId === void 0) {
      if (!Object.prototype.hasOwnProperty.call(parentObj, rel.name)) {
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
      for (const [key] of Object.entries(row)) {
        if (key.startsWith(prefix) && key !== `${prefix}id`) {
          relObj[key.replace(prefix, "")] = row[key];
        }
      }
      if (!rel.select?.id) {
        delete relObj.id;
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

// src/exec/multi.ts
function isRelationEntry(entry) {
  return !!entry && typeof entry === "object" && "table" in entry && "as" in entry && "to" in entry && "source" in entry;
}
function getBaseFields(tableSchema) {
  return Object.keys(tableSchema).filter((field) => {
    const mapping = tableSchema[field];
    if (field === "id") return false;
    if (typeof mapping === "string" && mapping.includes(".")) return false;
    return !isRelationEntry(mapping);
  });
}
function quote(field) {
  return `"${field}"`;
}
function buildSelectSql(tableName, selectFields, whereField, whereValues, orderBy, take, skip) {
  const fields = Array.from(/* @__PURE__ */ new Set(["id", ...selectFields]));
  const values = [];
  const sqlFields = fields.map((field) => `${quote(field)}`);
  let sql = `SELECT ${sqlFields.join(", ")} FROM ${tableName}`;
  if (whereField && whereValues && whereValues.length > 0) {
    const placeholders = whereValues.map((_, idx) => {
      values.push(whereValues[idx]);
      return `$${idx + 1}`;
    });
    sql += ` WHERE ${quote(whereField)} IN (${placeholders.join(", ")})`;
  }
  if (orderBy) {
    sql += ` ORDER BY ${quote(orderBy.field)} ${orderBy.direction.toUpperCase()}`;
  }
  if (take !== void 0) {
    sql += ` LIMIT ${take}`;
  }
  if (skip !== void 0) {
    sql += ` OFFSET ${skip}`;
  }
  return { sql, values };
}
function buildCountSql(tableName, countField, whereField, whereValues) {
  const values = [];
  const placeholders = whereValues.map((value, idx) => {
    values.push(value);
    return `$${idx + 1}`;
  });
  const sql = `SELECT ${quote(countField)} AS "__kadak_fk", COUNT(*) AS "__kadak_count" FROM ${tableName} WHERE ${quote(countField)} IN (${placeholders.join(", ")}) GROUP BY ${quote(countField)}`;
  return { sql, values };
}
function buildMultiRootSql(ast, schema) {
  const rootSchema = schema[ast.root] || {};
  const rootFields = ast.select ? Object.keys(ast.select).filter((f) => f !== "id") : getBaseFields(rootSchema);
  return buildSelectSql(ast.root, rootFields, void 0, void 0, ast.orderBy, ast.take, ast.skip);
}
function getRelation(tableSchema, relName) {
  const entry = tableSchema[relName];
  if (isRelationEntry(entry)) return entry;
  if (typeof entry === "string" && entry.includes(".")) {
    const [table, to] = entry.split(".");
    return { table, as: relName, to: to || "id", source: "id" };
  }
  return void 0;
}
function shouldSelectId(select) {
  return !select || !!select.id;
}
function maxDepth(relations) {
  let depth = 0;
  for (const rel of relations) {
    depth = Math.max(depth, 1 + maxDepth(rel.relations));
  }
  return depth;
}
function hasReverseRelation(tableName, relations, schema) {
  const tableSchema = schema[tableName] || {};
  for (const rel of relations) {
    const mapping = getRelation(tableSchema, rel.name);
    if (!mapping) continue;
    if (mapping.source === "id" && mapping.to !== "id") return true;
    if (hasReverseRelation(mapping.table, rel.relations, schema)) return true;
  }
  return false;
}
function normalizeRoot(row, select) {
  const out = {};
  if (row.id !== void 0 && shouldSelectId(select)) out.id = row.id;
  for (const [key, value] of Object.entries(row)) {
    if (key === "id") continue;
    if (!select || select[key]) out[key] = value;
  }
  return out;
}
async function fetchMany(tableName, schema, whereField, whereValues, select, orderBy, take, skip, client) {
  const tableSchema = schema[tableName] || {};
  const baseFields = getBaseFields(tableSchema);
  const selectedFields = select ? Object.keys(select).filter((f) => f !== "id") : baseFields;
  const { sql, values } = buildSelectSql(tableName, selectedFields, whereField, whereValues, orderBy, take, skip);
  const rows = await runQuery(sql, values, void 0, client);
  return rows.map((row) => normalizeRoot(row, select));
}
function collectValues(rows, field) {
  const values = /* @__PURE__ */ new Set();
  for (const row of rows) {
    const value = row[field];
    if (value !== null && value !== void 0) values.add(value);
  }
  return Array.from(values);
}
async function hydrateRelations(tableName, rows, relations, schema, options, ancestry = []) {
  const tableSchema = schema[tableName] || {};
  for (const rel of relations) {
    const relation = getRelation(tableSchema, rel.name);
    if (!relation || rows.length === 0) continue;
    const parentKeyField = relation.source;
    const childKeyField = relation.to || "id";
    const parentValues = collectValues(rows, parentKeyField);
    if (parentValues.length === 0) {
      for (const row of rows) {
        if (rel._count) {
          row[rel.name] = { _count: 0 };
        } else if (childKeyField === "id") {
          row[rel.name] = null;
        } else {
          row[rel.name] = [];
        }
      }
      continue;
    }
    if (rel._count && !rel.select && rel.relations.length === 0) {
      const { sql, values } = buildCountSql(relation.table, childKeyField, parentKeyField, parentValues);
      const countRows = await runQuery(sql, values, void 0, options.client);
      const countMap = /* @__PURE__ */ new Map();
      for (const row of countRows) {
        const key = row.__kadak_fk;
        const raw = row.__kadak_count;
        countMap.set(key, typeof raw === "string" ? Number(raw) : Number(raw ?? 0));
      }
      for (const row of rows) {
        row[rel.name] = { _count: countMap.get(row[parentKeyField]) ?? 0 };
      }
      continue;
    }
    const childRows = await fetchMany(
      relation.table,
      schema,
      childKeyField,
      parentValues,
      rel.select,
      void 0,
      void 0,
      void 0,
      options.client
    );
    const nextAncestry = ancestry.concat(tableName);
    const isCycle = nextAncestry.includes(relation.table);
    if (!isCycle) {
      await hydrateRelations(relation.table, childRows, rel.relations, schema, options, nextAncestry);
    }
    if (childKeyField === "id") {
      const childMap = /* @__PURE__ */ new Map();
      for (const child of childRows) {
        if (child.id !== void 0) childMap.set(child.id, child);
      }
      for (const row of rows) {
        row[rel.name] = childMap.get(row[parentKeyField]) ?? null;
      }
    } else {
      const groups = /* @__PURE__ */ new Map();
      for (const child of childRows) {
        const key = child[childKeyField];
        if (key === null || key === void 0) continue;
        const bucket = groups.get(key) || [];
        bucket.push(child);
        groups.set(key, bucket);
      }
      for (const row of rows) {
        row[rel.name] = groups.get(row[parentKeyField]) || [];
      }
    }
    if (rel._count) {
      const countValues = /* @__PURE__ */ new Set();
      for (const child of childRows) {
        const key = child[childKeyField];
        if (key !== null && key !== void 0) countValues.add(key);
      }
      const countMap = /* @__PURE__ */ new Map();
      for (const key of countValues) {
        const bucket = childRows.filter((row) => row[childKeyField] === key);
        countMap.set(key, bucket.length);
      }
      for (const row of rows) {
        const current = row[rel.name];
        if (Array.isArray(current)) {
          current._count = countMap.get(row[parentKeyField]) ?? 0;
        } else if (current && typeof current === "object") {
          current._count = countMap.get(row[parentKeyField]) ?? 0;
        }
      }
    }
  }
}
async function executeMultiQuery(ast, schema, options, resolvedUrl) {
  const { sql, values } = buildMultiRootSql(ast, schema);
  const rows = await runQuery(sql, values, resolvedUrl, options.client);
  const rootRows = rows.map((row) => normalizeRoot(row, ast.select));
  await hydrateRelations(ast.root, rootRows, ast.relations, schema, options, [ast.root]);
  return { rootRows, sql, values };
}
function shouldUseMultiQuery(ast, schema) {
  if (ast._count) return false;
  return maxDepth(ast.relations) > 1 || hasReverseRelation(ast.root, ast.relations, schema);
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
  const rootNode = input[rootTable];
  const hasPagination = Object.prototype.hasOwnProperty.call(rootNode, "take") || Object.prototype.hasOwnProperty.call(rootNode, "skip");
  if (hasPagination && !Object.prototype.hasOwnProperty.call(rootNode, "orderBy")) {
    throw new Error("Kadak Error: orderBy is required when using pagination");
  }
  validateNode(rootTable, rootNode, schema, true);
}
function validateNode(tableName, nodeInput, schema, isRoot = false) {
  const tableSchema = schema[tableName] || {};
  const validFields = Object.keys(tableSchema);
  const hasCount = Boolean(nodeInput._count);
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
      if (hasCount) {
        throw new Error("Kadak Error: _count can only coexist with select and where");
      }
      continue;
    } else if (key === "_count") {
      if (value !== true) {
        throw new Error("Kadak Error: _count must be true");
      }
      if (!isRoot) {
        continue;
      }
    } else if (key === "take") {
      if (hasCount) {
        throw new Error("Kadak Error: _count can only coexist with select and where");
      }
      if (!isRoot) {
        throw new Error("Kadak Error: nested pagination is not supported yet");
      }
      if (typeof value !== "number" || value <= 0) {
        throw new Error("Kadak Error: 'take' must be > 0");
      }
    } else if (key === "skip") {
      if (hasCount) {
        throw new Error("Kadak Error: _count can only coexist with select and where");
      }
      if (!isRoot) {
        throw new Error("Kadak Error: nested pagination is not supported yet");
      }
      if (typeof value !== "number" || value < 0) {
        throw new Error("Kadak Error: 'skip' must be >= 0");
      }
    } else if (key === "select") {
      const selectObj = value;
      for (const field of Object.keys(selectObj)) {
        if (field !== "id" && !tableSchema[field]) {
          throw new Error(`Kadak Error: invalid field '${field}' on '${tableName}'`);
        }
      }
    } else if (key === "_count") {
      if (value !== true) {
        throw new Error("Kadak Error: _count must be true");
      }
    } else {
      const target = tableSchema[key];
      if (!target) {
        const suggestions = getSuggestions(key, validFields);
        throw new Error(`\u274C Kadak Error: Relation '${key}' not found on table '${tableName}'. ${suggestions}`);
      }
      if (typeof value === "object" && value !== null) {
        const relationObj = value;
        if (typeof target === "object" && target !== null && "table" in target) {
          validateNode(target.table, value, schema, false);
        } else if (typeof target === "string") {
          validateNode(target.split(".")[0], value, schema, false);
        }
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
  min(val) {
    this.obj.min = val;
    return this;
  }
  max(val) {
    this.obj.max = val;
    return this;
  }
  lowercase() {
    this.obj.lowercase = true;
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
var types = {
  string: () => new ColumnBuilder("string"),
  varchar: (len) => new ColumnBuilder("varchar").length(len || 255),
  int: () => new ColumnBuilder("int"),
  text: () => new ColumnBuilder("text"),
  jsonb: () => new ColumnBuilder("jsonb"),
  timestamp: () => new ColumnBuilder("timestamp"),
  array: (innerType) => {
    const built = typeof innerType?.build === "function" ? innerType.build() : innerType;
    const inner = built;
    if (!inner || inner.type !== "string" && inner.type !== "int") {
      throw new Error("Kadak Error: array() only supports string or int");
    }
    const b = new ColumnBuilder("array");
    b.obj.array = { type: inner.type };
    return b;
  },
  ref: (table, opts) => {
    if (!opts?.as) {
      throw new Error("Kadak Error: 'as' is required in ref()");
    }
    const b = new ColumnBuilder();
    b.obj.ref = { table, as: opts.as, to: opts.to || "id", backRef: opts.backRef };
    b.obj.type = "int";
    return b;
  },
  timestamps: () => ({
    createdAt: new ColumnBuilder("timestamp").defaultNow(),
    updatedAt: { type: "timestamp", default: "NOW()", autoUpdate: true }
  })
};
function generateColumnSQL(colName, rawDef, tableName, indexStatements) {
  if (typeof rawDef === "string" && rawDef.includes(".")) {
    return { columnSQL: null };
  }
  const builder = rawDef;
  const def = typeof builder?.build === "function" ? builder.build() : typeof rawDef === "string" ? { type: rawDef } : rawDef;
  let typeStr = "";
  let constraints = "";
  let refTable = "";
  let refTarget = "id";
  let onDelete = "";
  if (def.array) {
    if (def.array.type === "string") {
      typeStr = "TEXT[]";
    } else if (def.array.type === "int") {
      typeStr = "INTEGER[]";
    }
  } else if (def.type === "string") {
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
    refTable = def.ref.table;
    refTarget = def.ref.to || "id";
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
  if (def.min !== void 0 || def.max !== void 0 || def.lowercase) {
  }
  let fkSQL;
  if (refTable) {
    fkSQL = `ALTER TABLE ${tableName} ADD CONSTRAINT fk_${tableName}_${colName} FOREIGN KEY ("${colName}") REFERENCES ${refTable}(${refTarget})${onDelete}`;
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
var kadak = ((config) => {
  let _currentSchema = {};
  let _rawDefinition = {};
  const _url = config.url;
  const data = ((input, options = {}) => {
    const resolvedUrl = _url || process.env.DATABASE_URL;
    validateInput(input, _currentSchema);
    const ast = buildAST(input);
    const plan = buildPlan(ast, _currentSchema);
    const { text: sql, values } = compileSQL(plan, ast, _currentSchema);
    const useMulti = shouldUseMultiQuery(ast, _currentSchema);
    const execution = async () => {
      let rows = [];
      try {
        if (useMulti) {
          const multi = await executeMultiQuery(ast, _currentSchema, options, resolvedUrl);
          rows = multi.rootRows;
          if (options.debug) {
            return { sql: multi.sql, values: multi.values, rows, data: multi.rootRows };
          }
          return multi.rootRows;
        }
        rows = await runQuery(sql, values, resolvedUrl, options.client);
      } catch (e) {
        if (options.debug) console.error("\u274C Kadak Execution Error:", e.message);
        rows = [];
      }
      if (ast._count) {
        const raw = rows[0]?._count ?? rows[0]?.count ?? rows[0]?.count_star;
        const countValue = typeof raw === "string" ? Number(raw) : Number(raw ?? 0);
        const countResult = { [ast.root]: { _count: countValue } };
        return options.debug ? { sql, values, rows, data: countResult } : countResult;
      }
      const normalized = normalize(rows, ast, _currentSchema);
      return options.debug ? { sql, values, rows, data: normalized } : normalized;
    };
    const promise = execution();
    const queryObj = promise;
    queryObj.toSQL = () => ({ sql, values });
    queryObj.explain = async () => {
      const explainSql = `EXPLAIN ANALYZE ${sql}`;
      return await runQuery(explainSql, values, resolvedUrl, options.client);
    };
    queryObj.trace = () => ({ ast, plan, sql, values });
    return queryObj;
  });
  const dbClient = {
    get schema() {
      return _rawDefinition;
    },
    define: ((tables) => {
      for (const [key, table] of Object.entries(tables)) {
        const tableName = table.config.name;
        const columns = table.config.columns;
        _rawDefinition[tableName] = columns;
        _currentSchema[tableName] = {};
        const relationNames = /* @__PURE__ */ new Set();
        for (const [col, rawDef] of Object.entries(columns)) {
          const def = rawDef instanceof ColumnBuilder ? rawDef.build() : typeof rawDef === "string" ? { type: rawDef } : rawDef;
          if (def.ref) {
            const relationName = def.ref.as;
            if (!relationName) {
              throw new Error("Kadak Error: 'as' is required in ref()");
            }
            if (relationNames.has(relationName)) {
              throw new Error(`Kadak Error: duplicate relation name '${relationName}'`);
            }
            if (columns[relationName] !== void 0) {
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
              if (targetSchema[def.ref.backRef] || columns[def.ref.backRef] !== void 0) {
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
      return dbClient;
    }),
    async push() {
      const resolvedUrl = _url || process.env.DATABASE_URL;
      if (process.env.NODE_ENV === "production") {
        console.warn("\u26A0\uFE0F [Kadak] push() called in production. Ensure this is intentional.");
      }
      await pushSchema(dbClient.schema, resolvedUrl);
    },
    async insert(table, data2, options = {}) {
      const resolvedUrl = _url || process.env.DATABASE_URL;
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
      const rows = await runQuery(sql, values, resolvedUrl, options.client);
      const ast = { root: tableName, relations: [] };
      return normalize(rows, ast, _currentSchema)[0];
    },
    async update(table, options) {
      const resolvedUrl = _url || process.env.DATABASE_URL;
      const tableName = String(table);
      const tableSchema = _currentSchema[tableName];
      if (!tableSchema) {
        throw new Error(`\u274C Kadak Error: Table '${tableName}' not found in defined schema.`);
      }
      if (!options.where || Object.keys(options.where).length === 0) {
        throw new Error(`\u274C Kadak Error: Update mutation requires a 'where' clause.`);
      }
      for (const [col, def] of Object.entries(tableSchema)) {
        if (typeof def === "object" && def !== null && "autoUpdate" in def && def.autoUpdate) {
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
      const rows = await runQuery(sql, values, resolvedUrl, options.client);
      const ast = { root: tableName, relations: [] };
      return normalize(rows, ast, _currentSchema);
    },
    async delete(table, options) {
      const resolvedUrl = _url || process.env.DATABASE_URL;
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
      const rows = await runQuery(sql, values, resolvedUrl, options.client);
      const ast = { root: tableName, relations: [] };
      return normalize(rows, ast, _currentSchema);
    },
    async transaction(fn) {
      const resolvedUrl = _url || process.env.DATABASE_URL;
      const client = await getTransactionClient(resolvedUrl);
      try {
        await client.query("BEGIN");
        const tx = {
          data: (input, opts = {}) => data(input, { ...opts, client }),
          insert: (table, d, opts = {}) => dbClient.insert(table, d, { ...opts, client }),
          update: (table, opts) => dbClient.update(table, { ...opts, client }),
          delete: (table, opts) => dbClient.delete(table, { ...opts, client })
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
  return dbClient;
});
kadak.table = (config) => {
  return { config, columns: config.columns };
};
kadak.types = types;
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
  types
});
