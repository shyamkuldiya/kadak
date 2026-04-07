import { QueryAST, RelationAST, Predicate, OrderBy } from "./ast.js";

type RelationDefinition = {
  table: string;
  as: string;
  to: string;
  source: string;
};

type SchemaEntry = string | RelationDefinition | Record<string, unknown>;

export type Plan = {
  from: string;
  joins: Array<{
    table: string;
    alias?: string;
    on: [string, string];
  }>;
  where?: Predicate[];
  orderBy?: OrderBy;
};

export function buildPlan(ast: QueryAST, schema: Record<string, Record<string, SchemaEntry>>): Plan {
  const plan: Plan = {
    from: ast.root,
    joins: [],
    where: ast.where,
    orderBy: ast.orderBy
  };

  traverse(ast.root, ast.relations, plan, schema);
  return plan;
}

function traverse(
  parentTableOrAlias: string, 
  relations: RelationAST[], 
  plan: Plan, 
  schema: Record<string, Record<string, SchemaEntry>>
) {
  for (const rel of relations) {
    const parentTable = findTable(parentTableOrAlias, plan);
    const target = schema[parentTable]?.[rel.name];
    
    if (!target) {
      throw new Error(`Invalid relation: ${rel.name} not found on ${parentTable}`);
    }

    const relation = typeof target === "string"
      ? { table: target.split(".")[0], as: rel.name, to: target.split(".")[1] || "id", source: "id" }
      : (target as RelationDefinition);
    const targetTable = relation.table;
    const targetField = relation.to || "id";
    
    const alias = relation.as !== targetTable ? relation.as : undefined;
    const targetIdentifier = alias || targetTable;

    let onCondition: [string, string];
    onCondition = [`${parentTableOrAlias}.${relation.source}`, `${targetIdentifier}.${targetField}`];

    plan.joins.push({
      table: targetTable,
      alias: alias,
      on: onCondition
    });

    traverse(targetIdentifier, rel.relations, plan, schema);
  }
}

function findTable(id: string, plan: Plan): string {
  if (id === plan.from) return id;
  const join = plan.joins.find(j => (j.alias || j.table) === id);
  return join ? join.table : id;
}
