import pg from "pg";
import { QueryAST, RelationAST } from "../query/ast.js";
import { runQuery } from "./client.js";

type SchemaEntry = string | { table: string; as: string; to: string; source: string } | Record<string, unknown>;
type Schema = Record<string, Record<string, SchemaEntry>>;
type Row = Record<string, unknown>;
type MultiOptions = { client?: pg.PoolClient; debug?: boolean };
type RelationDefinition = { table: string; as: string; to: string; source: string };
type CacheKey = string;

type ExecutionEdge = {
  parentTable: string;
  relationName: string;
  childTable: string;
  parentKey: string;
  childKey: string;
  select?: Record<string, true>;
  _count?: boolean;
  relations: RelationAST[];
};

type ExecutionPlan = {
  root: QueryAST["root"];
  edges: ExecutionEdge[];
};

function isRelationEntry(entry: SchemaEntry | undefined): entry is RelationDefinition {
  return !!entry && typeof entry === "object" && "table" in entry && "as" in entry && "to" in entry && "source" in entry;
}

function getRelation(tableSchema: Record<string, SchemaEntry>, relName: string): RelationDefinition | undefined {
  const entry = tableSchema[relName];
  if (isRelationEntry(entry)) return entry;
  if (typeof entry === "string" && entry.includes(".")) {
    const [table, to] = entry.split(".");
    return { table, as: relName, to: to || "id", source: "id" };
  }
  return undefined;
}

function getBaseFields(tableSchema: Record<string, SchemaEntry>): string[] {
  return Object.keys(tableSchema).filter((field) => {
    const mapping = tableSchema[field];
    if (field === "id") return false;
    if (typeof mapping === "string" && mapping.includes(".")) return false;
    return !isRelationEntry(mapping);
  });
}

function quote(field: string) {
  return `"${field}"`;
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function serializeValues(values: unknown[]) {
  return values.map((value) => value === null ? "__null__" : typeof value === "object" ? JSON.stringify(value) : String(value)).join("|");
}

function buildRootSql(ast: QueryAST, schema: Schema) {
  const rootSchema = schema[ast.root] || {};
  const fields = ast.select ? Object.keys(ast.select).filter((f) => f !== "id") : getBaseFields(rootSchema);
  const cols = unique(["id", ...fields]).map((field) => quote(field));
  let sql = `SELECT ${cols.join(", ")} FROM ${ast.root}`;
  const values: unknown[] = [];

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

  if (ast.take !== undefined) sql += ` LIMIT ${ast.take}`;
  if (ast.skip !== undefined) sql += ` OFFSET ${ast.skip}`;

  return { sql, values };
}

function selectFields(select?: Record<string, true>) {
  return select ? Object.keys(select).filter((field) => field !== "id") : undefined;
}

function parentKeySet(rows: Row[], field: string) {
  return unique(rows.map((row) => row[field]).filter((value) => value !== null && value !== undefined));
}

type LoadedBucket = {
  byKey: Map<unknown, Row[]>;
  single: Map<unknown, Row | null>;
};

function bucketRows(rows: Row[], keyField: string, select?: Record<string, true>): LoadedBucket {
  const byKey = new Map<unknown, Row[]>();
  const single = new Map<unknown, Row | null>();
  for (const row of rows) {
    const key = row[keyField];
    if (key === null || key === undefined) continue;
    const projected = project(row, select);
    const group = byKey.get(key) || [];
    group.push(projected);
    byKey.set(key, group);
    if (!single.has(key)) single.set(key, projected);
  }
  return { byKey, single };
}

function project(row: Row, select?: Record<string, true>) {
  const out: Row = {};
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

async function fetchBatch(
  table: string,
  field: string,
  values: unknown[],
  schema: Schema,
  select?: Record<string, true>,
  client?: pg.PoolClient,
  cache?: Map<CacheKey, Promise<Row[]>>
) {
  const cacheKey = `${table}:${field}:${select ? Object.keys(select).sort().join(",") : "*"}:${serializeValues(values)}`;
  if (cache?.has(cacheKey)) return await cache.get(cacheKey)!;
  const tableSchema = schema[table] || {};
  const fields = selectFields(select) ?? getBaseFields(tableSchema);
  const cols = unique(["id", ...fields]).map((f) => quote(f));
  const placeholders = values.map((_, idx) => `$${idx + 1}`);
  const sql = `SELECT ${cols.join(", ")} FROM ${table} WHERE ${quote(field)} IN (${placeholders.join(", ")})`;
  const query = runQuery(sql, values, undefined, client) as Promise<Row[]>;
  cache?.set(cacheKey, query);
  return await query;
}

function relationShapeNeedsBatch(rel: RelationAST, schema: Schema, parentTable: string): boolean {
  const relation = getRelation(schema[parentTable] || {}, rel.name);
  if (!relation) return false;
  return rel.relations.length > 0 || !!rel._count || relation.source !== "id" || relation.to !== "id";
}

function buildExecutionPlan(ast: QueryAST, schema: Schema): ExecutionPlan {
  const edges: ExecutionEdge[] = [];

  const walk = (tableName: string, relations: RelationAST[]) => {
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
      walk(childTable, rel.relations);
    }
  };

  walk(ast.root, ast.relations);

  return {
    root: ast.root,
    edges
  };
}

function shouldUseMultiQuery(ast: QueryAST, schema: Schema): boolean {
  const depth = (relations: RelationAST[]): number => relations.reduce((max, rel) => Math.max(max, 1 + depth(rel.relations)), 0);
  if (ast._count) return false;
  if (depth(ast.relations) > 1) return true;
  return ast.relations.some((rel) => relationShapeNeedsBatch(rel, schema, ast.root));
}

async function hydratePlan(
  plan: ExecutionPlan,
  rows: Row[],
  schema: Schema,
  options: MultiOptions,
  cache: Map<CacheKey, Promise<Row[]>>
) {
  const groupedEdges = new Map<string, ExecutionEdge[]>();
  for (const edge of plan.edges) {
    const list = groupedEdges.get(edge.parentTable) || [];
    list.push(edge);
    groupedEdges.set(edge.parentTable, list);
  }
  for (const [tableName, edges] of groupedEdges.entries()) {
    groupedEdges.set(tableName, edges.slice().sort((a, b) => a.relationName.localeCompare(b.relationName)));
  }

  const frontier = new Map<string, Row[]>();
  frontier.set(plan.root, rows);

  const visited = new Set<string>();
  const maxPasses = Math.max(1, plan.edges.length + 1);

  const assignCount = (tableRows: Row[], relationName: string, parentKey: string, countMap: Map<unknown, number>) => {
    for (const row of tableRows) {
      const count = countMap.get(row[parentKey]) ?? 0;
      const current = row[relationName];
      if (Array.isArray(current)) {
        (current as Row[] & { _count?: number })._count = count;
      } else if (current && typeof current === "object") {
        (current as Row)._count = count;
      } else {
        row[relationName] = { _count: count };
      }
    }
  };

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
            row[edge.relationName] = edge._count ? { _count: 0 } : (edge.childKey === "id" ? null : []);
          }
          continue;
        }

        progressed = true;

        if (edge._count && !edge.select && edge.relations.length === 0) {
          const placeholders = values.map((_, idx) => `$${idx + 1}`);
          const sql = `SELECT ${quote(edge.childKey)} AS "__kadak_fk", COUNT(*) AS "__kadak_count" FROM ${edge.childTable} WHERE ${quote(edge.childKey)} IN (${placeholders.join(", ")}) GROUP BY ${quote(edge.childKey)}`;
          const countRows = await runQuery(sql, values, undefined, options.client) as Row[];
          const countMap = new Map<unknown, number>();
          for (const countRow of countRows) {
            const key = countRow.__kadak_fk;
            const count = typeof countRow.__kadak_count === "string" ? Number(countRow.__kadak_count) : Number(countRow.__kadak_count ?? 0);
            countMap.set(key, count);
          }
          assignCount(tableRows, edge.relationName, edge.parentKey, countMap);
          continue;
        }

        const childRows = await fetchBatch(edge.childTable, edge.childKey, values, schema, edge.select, options.client, cache);
        const childBucket = edge.childKey === "id" ? bucketRows(childRows, edge.childKey, edge.select).single : bucketRows(childRows, edge.childKey, edge.select).byKey;

        for (const row of tableRows) {
          const parentValue = row[edge.parentKey];
          if (edge.childKey === "id") {
            const child = (childBucket as Map<unknown, Row | null>).get(parentValue) ?? null;
            row[edge.relationName] = child ? project(child, edge.select) : null;
          } else {
            const items = (childBucket as Map<unknown, Row[]>).get(parentValue) || [];
            row[edge.relationName] = items.map((child) => project(child, edge.select));
          }
        }

        if (edge._count) {
          const countMap = new Map<unknown, number>();
          for (const [key, bucket] of bucketRows(childRows, edge.childKey, edge.select).byKey.entries()) {
            countMap.set(key, bucket.length);
          }
          assignCount(tableRows, edge.relationName, edge.parentKey, countMap);
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

function finalizeRows(rows: Row[], ast: QueryAST): Row[] {
  const select = ast.select;
  if (!select) return rows;
  return rows.map((row) => {
    const out: Row = {};
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
}

export async function executeMultiQuery(ast: QueryAST, schema: Schema, options: MultiOptions, resolvedUrl?: string) {
  const { sql, values } = buildRootSql(ast, schema);
  const rows = (await runQuery(sql, values, resolvedUrl, options.client)) as Row[];
  const cache = new Map<CacheKey, Promise<Row[]>>();
  const plan = buildExecutionPlan(ast, schema);
  await hydratePlan(plan, rows, schema, options, cache);
  return { rootRows: finalizeRows(rows, ast), sql, values };
}

export function buildMultiRootSql(ast: QueryAST, schema: Schema) {
  return buildRootSql(ast, schema);
}

export { shouldUseMultiQuery };
