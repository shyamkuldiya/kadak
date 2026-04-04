declare function runQuery(sql: string, values: unknown[], url?: string): Promise<any[]>;
declare function closePool(): Promise<void>;

type ColumnObject = {
    type?: "string" | "varchar" | "int" | "text" | "jsonb" | string;
    ref?: string;
    unique?: boolean;
    nullable?: boolean;
    default?: any;
    length?: number;
    onDelete?: "cascade" | "restrict" | "set null" | "no action";
    index?: boolean;
};
type ColumnDef = string | ColumnObject;
type SchemaDefinition = Record<string, Record<string, ColumnDef>>;

type Predicate = {
    field: string;
    value: unknown;
};
type RelationAST = {
    name: string;
    relations: RelationAST[];
};
type OrderBy = {
    field: string;
    direction: "asc" | "desc";
};
type QueryAST = {
    root: string;
    where?: Predicate[];
    orderBy?: OrderBy;
    relations: RelationAST[];
};

declare function buildAST(queryInput: Record<string, unknown>): QueryAST;

type Plan = {
    from: string;
    joins: Array<{
        table: string;
        alias?: string;
        on: [string, string];
    }>;
    where?: Predicate[];
    orderBy?: OrderBy;
};
declare function buildPlan(ast: QueryAST, schema: Record<string, Record<string, string>>): Plan;

type Compiled = {
    text: string;
    values: unknown[];
};
declare function compileSQL(plan: Plan, schema: Record<string, Record<string, any>>): Compiled;

/**
 * Normalizes flat SQL rows into a nested object graph based on the AST structure.
 * Groups by 'id' and avoids duplicates.
 * All columns are expected to be aliased as 'tableId__columnName'.
 */
declare function normalize(rows: any[], ast: QueryAST, schema: Record<string, Record<string, any>>): any[];

type KadakConfig = {
    url: string;
};
declare function kadak(config: KadakConfig): {
    schema(definition: SchemaDefinition): {
        push: () => Promise<void>;
    };
    data: typeof data;
    close: typeof closePool;
};
interface KadakQuery<T> extends Promise<T> {
    toSQL: () => {
        sql: string;
        values: unknown[];
    };
    explain: () => Promise<any[]>;
    trace: () => {
        ast: any;
        plan: any;
        sql: string;
        values: unknown[];
    };
}
declare function data<T = any>(input: Record<string, unknown>, options?: {
    debug?: boolean;
}): KadakQuery<T>;

export { type Compiled, type KadakConfig, type KadakQuery, type OrderBy, type Plan, type Predicate, type QueryAST, type RelationAST, buildAST, buildPlan, closePool, compileSQL, data, kadak, normalize, runQuery };
