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
import pg from "pg";
var pool = null;
async function runQuery(sql, values, url, client) {
  if (client) {
    const res2 = await client.query(sql, values);
    return res2.rows;
  }
  if (!pool && url) {
    pool = new pg.Pool({ connectionString: url });
  }
  if (!pool) throw new Error("Database pool not initialized");
  const res = await pool.query(sql, values);
  return res.rows;
}
async function getTransactionClient(url) {
  if (!pool && url) {
    pool = new pg.Pool({ connectionString: url });
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

// src/exec/multi-plan.ts
function isRelationEntry(entry) {
  return !!entry && typeof entry === "object" && "table" in entry && "as" in entry && "to" in entry && "source" in entry;
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
function buildExecutionPlan(ast, schema) {
  const edges = [];
  const queue = [{ tableName: ast.root, relations: ast.relations }];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const { tableName, relations } = queue[cursor];
    const tableSchema = schema[tableName] || {};
    for (const rel of relations) {
      const relation = getRelation(tableSchema, rel.name);
      if (!relation) continue;
      const childTable = relation.table;
      edges.push({
        parentTable: tableName,
        relationName: rel.name,
        childTable,
        parentKey: relation.source,
        childKey: relation.to || "id",
        select: rel.select,
        _count: rel._count,
        relations: rel.relations
      });
      if (rel.relations.length > 0) {
        queue.push({ tableName: childTable, relations: rel.relations });
      }
    }
  }
  return { root: ast.root, edges };
}
function shouldUseMultiQuery(ast, schema) {
  const depth = (relations) => relations.reduce((max, rel) => Math.max(max, 1 + depth(rel.relations)), 0);
  if (ast._count) return false;
  if (depth(ast.relations) > 1) return true;
  return ast.relations.some((rel) => {
    const relation = getRelation(schema[ast.root] || {}, rel.name);
    if (!relation) return false;
    return rel.relations.length > 0 || !!rel._count || relation.source !== "id" || relation.to !== "id";
  });
}

// src/exec/multi.ts
function getBaseFields(tableSchema) {
  return Object.keys(tableSchema).filter((field) => field !== "id");
}
function quote(field) {
  return `"${field}"`;
}
function unique(arr) {
  return Array.from(new Set(arr));
}
function serializeValues(values) {
  return values.map((value) => value === null ? "__null__" : typeof value === "object" ? JSON.stringify(value) : String(value)).join("|");
}
function buildRootSql(ast, schema) {
  const rootSchema = schema[ast.root] || {};
  const fields = ast.select ? Object.keys(ast.select).filter((f) => f !== "id") : getBaseFields(rootSchema);
  const cols = unique(["id", ...fields]).map((field) => quote(field));
  let sql = `SELECT ${cols.join(", ")} FROM ${ast.root}`;
  const values = [];
  if (ast.where && ast.where.length > 0) {
    const clauses = ast.where.map((p, idx) => {
      values.push(p.value);
      return `${quote(p.field)} = $${idx + 1}`;
    });
    sql += ` WHERE ${clauses.join(" AND ")}`;
  }
  if (ast.orderBy) {
    sql += ` ORDER BY ${quote(ast.orderBy.field)} ${ast.orderBy.direction.toUpperCase()}`;
  }
  if (ast.take !== void 0) sql += ` LIMIT ${ast.take}`;
  if (ast.skip !== void 0) sql += ` OFFSET ${ast.skip}`;
  return { sql, values };
}
function parentKeySet(rows, field) {
  return unique(rows.map((row) => row[field]).filter((value) => value !== null && value !== void 0));
}
function bucketRows(rows, keyField, select) {
  const byKey = /* @__PURE__ */ new Map();
  const single = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const key = row[keyField];
    if (key === null || key === void 0) continue;
    const projected = project(row, select);
    const group = byKey.get(key) || [];
    group.push(projected);
    byKey.set(key, group);
    if (!single.has(key)) single.set(key, projected);
  }
  return { byKey, single };
}
function project(row, select) {
  const out = {};
  if (!select) {
    for (const [key, value] of Object.entries(row)) {
      if (key !== "id") out[key] = value;
    }
    return out;
  }
  for (const key of Object.keys(select)) {
    if (key in row) out[key] = row[key];
  }
  if (select.id) out.id = row.id;
  return out;
}
async function fetchBatch(table, field, values, schema, select, client, cache) {
  const cacheKey = `${table}:${field}:${select ? Object.keys(select).sort().join(",") : "*"}:${serializeValues(values)}`;
  if (cache?.has(cacheKey)) return await cache.get(cacheKey);
  const tableSchema = schema[table] || {};
  const fields = select ? Object.keys(select).filter((field2) => field2 !== "id") : getBaseFields(tableSchema);
  const cols = unique(["id", ...fields]).map((f) => quote(f));
  const placeholders = values.map((_, idx) => `$${idx + 1}`);
  const sql = `SELECT ${cols.join(", ")} FROM ${table} WHERE ${quote(field)} IN (${placeholders.join(", ")})`;
  const query = runQuery(sql, values, void 0, client);
  cache?.set(cacheKey, query);
  return await query;
}
async function hydratePlan(plan, rows, schema, options, cache) {
  const groupedEdges = /* @__PURE__ */ new Map();
  for (const edge of plan.edges) {
    const list = groupedEdges.get(edge.parentTable) || [];
    list.push(edge);
    groupedEdges.set(edge.parentTable, list);
  }
  for (const [tableName, edges] of groupedEdges.entries()) {
    groupedEdges.set(tableName, edges.slice().sort((a, b) => a.relationName.localeCompare(b.relationName)));
  }
  const frontier = /* @__PURE__ */ new Map();
  frontier.set(plan.root, rows);
  const visited = /* @__PURE__ */ new Set();
  const maxPasses = Math.max(1, plan.edges.length + 1);
  for (let pass = 0; pass < maxPasses; pass++) {
    let progressed = false;
    const currentFrontier = Array.from(frontier.entries()).sort(([a], [b]) => a.localeCompare(b));
    frontier.clear();
    for (const [tableName, tableRows] of currentFrontier) {
      const edges = groupedEdges.get(tableName) || [];
      if (edges.length === 0 || tableRows.length === 0) continue;
      for (const edge of edges) {
        const edgeKey = `${tableName}:${edge.relationName}`;
        if (visited.has(edgeKey)) continue;
        visited.add(edgeKey);
        const values = parentKeySet(tableRows, edge.parentKey);
        if (values.length === 0) {
          for (const row of tableRows) {
            row[edge.relationName] = edge._count ? { _count: 0 } : edge.childKey === "id" ? null : [];
          }
          continue;
        }
        progressed = true;
        if (edge._count && !edge.select && edge.relations.length === 0) {
          const placeholders = values.map((_, idx) => `$${idx + 1}`);
          const sql = `SELECT ${quote(edge.childKey)} AS "__kadak_fk", COUNT(*) AS "__kadak_count" FROM ${edge.childTable} WHERE ${quote(edge.childKey)} IN (${placeholders.join(", ")}) GROUP BY ${quote(edge.childKey)}`;
          const countRows = await runQuery(sql, values, void 0, options.client);
          const countMap = /* @__PURE__ */ new Map();
          for (const countRow of countRows) {
            const key = countRow.__kadak_fk;
            const count = typeof countRow.__kadak_count === "string" ? Number(countRow.__kadak_count) : Number(countRow.__kadak_count ?? 0);
            countMap.set(key, count);
          }
          for (const row of tableRows) {
            row[edge.relationName] = { _count: countMap.get(row[edge.parentKey]) ?? 0 };
          }
          continue;
        }
        const childRows = await fetchBatch(edge.childTable, edge.childKey, values, schema, edge.select, options.client, cache);
        const buckets = bucketRows(childRows, edge.childKey, edge.select);
        const childBucket = edge.childKey === "id" ? buckets.single : buckets.byKey;
        for (const row of tableRows) {
          const parentValue = row[edge.parentKey];
          if (edge.childKey === "id") {
            const child = childBucket.get(parentValue) ?? null;
            row[edge.relationName] = child ? project(child, edge.select) : null;
          } else {
            const items = childBucket.get(parentValue) || [];
            row[edge.relationName] = items.map((child) => project(child, edge.select));
          }
        }
        if (edge._count) {
          const countMap = /* @__PURE__ */ new Map();
          for (const [key, bucket] of buckets.byKey.entries()) {
            countMap.set(key, bucket.length);
          }
          for (const row of tableRows) {
            const count = countMap.get(row[edge.parentKey]) ?? 0;
            const current = row[edge.relationName];
            if (Array.isArray(current)) {
              current._count = count;
            } else if (current && typeof current === "object") {
              current._count = count;
            } else {
              row[edge.relationName] = { _count: count };
            }
          }
        }
        if (edge.relations.length > 0 && childRows.length > 0) {
          const nextList = frontier.get(edge.childTable) || [];
          nextList.push(...childRows);
          frontier.set(edge.childTable, nextList);
        }
      }
    }
    if (!progressed || frontier.size === 0) break;
  }
}
async function executeMultiQuery(ast, schema, options, resolvedUrl) {
  const { sql, values } = buildRootSql(ast, schema);
  const rows = await runQuery(sql, values, resolvedUrl, options.client);
  const cache = /* @__PURE__ */ new Map();
  const plan = buildExecutionPlan(ast, schema);
  await hydratePlan(plan, rows, schema, options, cache);
  const select = ast.select;
  if (!select) return { rootRows: rows, sql, values };
  const rootRows = rows.map((row) => {
    const out = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === "id") {
        if (select.id) out.id = value;
        continue;
      }
      if (key in select) {
        out[key] = value;
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        out[key] = value;
      } else if (Array.isArray(value)) {
        out[key] = value;
      }
    }
    return out;
  });
  return { rootRows, sql, values };
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
import { createHash } from "crypto";
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
  return createHash("sha256").update(str).digest("hex");
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
export {
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
};
