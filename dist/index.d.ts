import pg from 'pg';
export { closePool, getTransactionClient, runQuery } from './exec/client.js';

type ColumnObject = {
    type?: "string" | "varchar" | "int" | "text" | "jsonb" | "timestamp" | string;
    ref?: string;
    unique?: boolean;
    nullable?: boolean;
    default?: any;
    length?: number;
    onDelete?: "cascade" | "restrict" | "set null" | "no action";
    index?: boolean;
    autoUpdate?: boolean;
};
type ColumnDef = string | ColumnObject;
interface TableConfig<N extends string = string, C extends Record<string, ColumnDef> = Record<string, ColumnDef>> {
    name: N;
    columns: C;
}
interface Table<N extends string = string, C extends Record<string, ColumnDef> = Record<string, ColumnDef>> {
    config: TableConfig<N, C>;
}
type SchemaDefinition = Record<string, Record<string, ColumnDef>>;
declare class ColumnBuilder {
    private obj;
    constructor(type?: ColumnObject["type"]);
    default(val: any): this;
    defaultNow(): this;
    unique(): this;
    nullable(val?: boolean): this;
    notNull(): this;
    length(val: number): this;
    onDelete(val: ColumnObject["onDelete"]): this;
    index(): this;
    build(): ColumnObject;
}
declare const types: {
    string: () => ColumnBuilder;
    varchar: (len?: number) => ColumnBuilder;
    int: () => ColumnBuilder;
    text: () => ColumnBuilder;
    jsonb: () => ColumnBuilder;
    timestamp: () => ColumnBuilder;
    ref: (table: string) => ColumnBuilder;
    timestamps: () => {
        createdAt: ColumnObject;
        updatedAt: ColumnObject;
    };
};
declare const t: {
    string: () => ColumnBuilder;
    varchar: (len?: number) => ColumnBuilder;
    int: () => ColumnBuilder;
    text: () => ColumnBuilder;
    jsonb: () => ColumnBuilder;
    timestamp: () => ColumnBuilder;
    ref: (table: string) => ColumnBuilder;
    timestamps: () => {
        createdAt: ColumnObject;
        updatedAt: ColumnObject;
    };
};

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
 * Supports both aliased (table__col) and raw rows (for mutations).
 */
declare function normalize(rows: any[], ast: QueryAST, schema: Record<string, Record<string, any>>): any[];

declare function buildInsertSQL(table: string, data: Record<string, any>): {
    sql: string;
    values: any[];
};
declare function buildUpdateSQL(table: string, where: Record<string, any>, data: Record<string, any>): {
    sql: string;
    values: any[];
};
declare function buildDeleteSQL(table: string, where: Record<string, any>): {
    sql: string;
    values: any[];
};

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
type TableInsert<S, T extends keyof S> = {
    [K in keyof S[T]]?: any;
} & {
    id?: any;
};
type TableUpdate<S, T extends keyof S> = {
    where: Record<string, any>;
    data: Partial<TableInsert<S, T>>;
};
type TableDelete<S, T extends keyof S> = {
    where: Record<string, any>;
};
type InferredQuery<S> = {
    [K in keyof S]?: TableQuery<S, K>;
};
interface KadakInstance<S extends Record<string, any> = any> {
    readonly schema: Readonly<SchemaDefinition>;
    define<Tables extends Record<string, Table<any, any>>>(tables: Tables): KadakInstance<{
        [K in keyof Tables]: Tables[K]["config"]["columns"];
    }>;
    push(): Promise<void>;
    data<T = any>(input: InferredQuery<S>, options?: {
        debug?: boolean;
        client?: pg.PoolClient;
    }): KadakQuery<T>;
    insert<T extends keyof S>(table: T, data: TableInsert<S, T>, options?: {
        client?: pg.PoolClient;
    }): Promise<any>;
    update<T extends keyof S>(table: T, options: TableUpdate<S, T> & {
        client?: pg.PoolClient;
    }): Promise<any[]>;
    delete<T extends keyof S>(table: T, options: TableDelete<S, T> & {
        client?: pg.PoolClient;
    }): Promise<any[]>;
    transaction<T>(fn: (tx: Omit<KadakInstance<S>, "define" | "push" | "transaction" | "close">) => Promise<T>): Promise<T>;
    close(): Promise<void>;
}
interface KadakFactory {
    (config: KadakConfig): KadakInstance<any>;
    table: <N extends string, C extends Record<string, any>>(config: TableConfig<N, C>) => Table<N, C>;
    types: typeof types;
    t: typeof types;
}
declare const kadak: KadakFactory;

export { type Compiled, type InferredQuery, type KadakConfig, type KadakFactory, type KadakInstance, type KadakQuery, type OrderBy, type Plan, type Predicate, type QueryAST, type RelationAST, buildAST, buildDeleteSQL, buildInsertSQL, buildPlan, buildUpdateSQL, compileSQL, kadak, normalize, t, types };
