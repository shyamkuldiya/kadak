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
interface TableConfig<N extends string = string, C extends Record<string, ColumnDef> = Record<string, ColumnDef>> {
    name: N;
    columns: C;
}
interface Table<N extends string = string, C extends Record<string, ColumnDef> = Record<string, ColumnDef>> {
    config: TableConfig<N, C>;
}

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

declare function runQuery(sql: string, values: unknown[], url?: string): Promise<any[]>;
declare function closePool(): Promise<void>;

/**
 * Normalizes flat SQL rows into a nested object graph based on the AST structure.
 * Groups by 'id' and avoids duplicates.
 * All columns are expected to be aliased as 'tableId__columnName'.
 */
declare function normalize(rows: any[], ast: QueryAST, schema: Record<string, Record<string, any>>): any[];

type KadakConfig = {
    url: string;
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
type RelationName<V> = V extends {
    ref: infer R;
} ? R : V extends `ref:${infer R}` ? R : never;
type TableQuery<S, T extends keyof S> = {
    where?: Record<string, any>;
    orderBy?: Record<string, "asc" | "desc">;
} & {
    [K in keyof S[T]]?: RelationName<S[T][K]> extends keyof S ? TableQuery<S, RelationName<S[T][K]>> | true : any;
};
type InferredQuery<S> = {
    [K in keyof S]?: TableQuery<S, K>;
};
interface KadakInstance<S extends Record<string, any> = any> {
    define<Tables extends Record<string, Table<any, any>>>(tables: Tables): KadakInstance<{
        [K in keyof Tables]: Tables[K]["config"]["columns"];
    }>;
    push(): Promise<void>;
    data<T = any>(input: InferredQuery<S>, options?: {
        debug?: boolean;
    }): KadakQuery<T>;
    close(): Promise<void>;
}
declare const kadak: {
    (config: KadakConfig): KadakInstance<any>;
    table<N extends string, C extends Record<string, any>>(config: TableConfig<N, C>): Table<N, C>;
};

export { type Compiled, type InferredQuery, type KadakConfig, type KadakInstance, type KadakQuery, type OrderBy, type Plan, type Predicate, type QueryAST, type RelationAST, buildAST, buildPlan, closePool, compileSQL, kadak, normalize, runQuery };
