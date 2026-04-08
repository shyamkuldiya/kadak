import { QueryAST, RelationAST } from "../query/ast.js";

export type SchemaEntry = string | { table: string; as: string; to: string; source: string } | Record<string, unknown>;
export type Schema = Record<string, Record<string, SchemaEntry>>;

export type ExecutionEdge = {
  parentTable: string;
  relationName: string;
  childTable: string;
  parentKey: string;
  childKey: string;
  select?: Record<string, true>;
  _count?: boolean;
  relations: RelationAST[];
};

export type ExecutionPlan = {
  root: QueryAST["root"];
  edges: ExecutionEdge[];
};

function isRelationEntry(entry: SchemaEntry | undefined): entry is { table: string; as: string; to: string; source: string } {
  return !!entry && typeof entry === "object" && "table" in entry && "as" in entry && "to" in entry && "source" in entry;
}

function getRelation(tableSchema: Record<string, SchemaEntry>, relName: string) {
  const entry = tableSchema[relName];
  if (isRelationEntry(entry)) return entry;
  if (typeof entry === "string" && entry.includes(".")) {
    const [table, to] = entry.split(".");
    return { table, as: relName, to: to || "id", source: "id" };
  }
  return undefined;
}

function relationNeedsBatch(rel: RelationAST, schema: Schema, root: string): boolean {
  const relation = getRelation(schema[root] || {}, rel.name);
  if (!relation) return false;
  return rel.relations.length > 0 || !!rel._count || relation.source !== "id" || relation.to !== "id";
}

function buildExecutionPlan(ast: QueryAST, schema: Schema): ExecutionPlan {
  const edges: ExecutionEdge[] = [];
  const queue: Array<{ tableName: string; relations: RelationAST[] }> = [{ tableName: ast.root, relations: ast.relations }];

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

function shouldUseMultiQuery(ast: QueryAST, schema: Schema): boolean {
  const depth = (relations: RelationAST[]): number => relations.reduce((max, rel) => Math.max(max, 1 + depth(rel.relations)), 0);
  if (ast._count) return false;
  if (depth(ast.relations) > 1) return true;
  return ast.relations.some((rel) => relationNeedsBatch(rel, schema, ast.root));
}

export function analyzeQuery(ast: QueryAST, schema: Schema) {
  return { plan: buildExecutionPlan(ast, schema), useMulti: shouldUseMultiQuery(ast, schema) };
}
