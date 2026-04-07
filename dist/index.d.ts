import pg from 'pg';
export { closePool, getTransactionClient, runQuery } from './exec/client.js';

type ColumnObject = {
    type?: "string" | "varchar" | "int" | "text" | "jsonb" | "timestamp" | string;
    min?: number;
    max?: number;
    lowercase?: boolean;
    array?: {
        type: "string" | "int";
    };
    ref?: {
        table: string;
        as: string;
        to?: string;
        source?: string;
    };
    unique?: boolean;
    nullable?: boolean;
    default?: unknown;
    length?: number;
    onDelete?: "cascade" | "restrict" | "set null" | "no action";
    index?: boolean;
    autoUpdate?: boolean;
};
type ColumnDef = string | ColumnObject | ColumnBuilder;
interface TableConfig<N extends string = string, C extends Record<string, ColumnDef> = Record<string, ColumnDef>> {
    name: N;
    columns: C;
}
interface Table<N extends string = string, C extends Record<string, ColumnDef> = Record<string, ColumnDef>> {
    config: TableConfig<N, C>;
}
type SchemaDefinition = Record<string, Record<string, ColumnDef>>;
declare class ColumnBuilder<T extends ColumnObject = ColumnObject> {
    obj: ColumnObject;
    constructor(type?: ColumnObject["type"]);
    default(val: unknown): this;
    min(val: number): this;
    max(val: number): this;
    lowercase(): this;
    defaultNow(): this;
    unique(): this;
    nullable(val?: boolean): this;
    notNull(): this;
    length(val: number): this;
    onDelete(val: ColumnObject["onDelete"]): this;
    index(): this;
    build(): T;
}
declare const types: {
    string: () => ColumnBuilder<{
        type: "string";
    }>;
    varchar: (len?: number) => ColumnBuilder<{
        type: "varchar";
        length?: number;
    }>;
    int: () => ColumnBuilder<{
        type: "int";
    }>;
    text: () => ColumnBuilder<{
        type: "text";
    }>;
    jsonb: () => ColumnBuilder<{
        type: "jsonb";
    }>;
    timestamp: () => ColumnBuilder<{
        type: "timestamp";
    }>;
    array: <T extends "string" | "int">(innerType: ColumnBuilder<{
        type: T;
    }>) => ColumnBuilder<{
        type: "array";
        array: {
            type: T;
        };
    }>;
    ref: <const TableName extends string, const RelationName extends string, const To extends string = "id">(table: TableName, opts: {
        as: RelationName;
        to?: To;
    }) => ColumnBuilder<{
        type: "int";
        ref: {
            table: TableName;
            as: RelationName;
            to: To;
        };
    }>;
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
    select?: Record<string, true>;
    relations: RelationAST[];
};
type OrderBy = {
    field: string;
    direction: "asc" | "desc";
};
type QueryAST = {
    root: string;
    select?: Record<string, true>;
    take?: number;
    skip?: number;
    where?: Predicate[];
    orderBy?: OrderBy;
    relations: RelationAST[];
};

declare function buildAST(queryInput: Record<string, unknown>): QueryAST;

type RelationDefinition = {
    table: string;
    as: string;
    to: string;
    source: string;
};
type SchemaEntry$1 = string | RelationDefinition | Record<string, unknown>;
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
declare function buildPlan(ast: QueryAST, schema: Record<string, Record<string, SchemaEntry$1>>): Plan;

type Compiled = {
    text: string;
    values: unknown[];
};
type SchemaEntry = string | {
    table: string;
    as: string;
    to: string;
    source: string;
} | Record<string, unknown>;
declare function compileSQL(plan: Plan, ast: QueryAST, schema: Record<string, Record<string, SchemaEntry>>): Compiled;

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
type SchemaMap = Record<string, Record<string, unknown>>;
type ColumnInput = string | ColumnObject | ColumnBuilder;
type TableColumns<T> = T extends {
    config: {
        columns: infer C;
    };
} ? C : never;
type DefinedSchema<Tables extends Record<string, Table<string, Record<string, ColumnInput>>>> = {
    [K in keyof Tables & string]: TableColumns<Tables[K]>;
};
type BuiltColumn<C> = C extends ColumnBuilder<infer O> ? O : C extends string ? {
    type: C;
} : C;
type RelationFromColumn<C> = BuiltColumn<C> extends {
    ref: {
        table: infer Table extends string;
        as: infer As extends string;
    };
} ? {
    table: Table;
    as: As;
} : never;
type RelationNames<Columns> = {
    [K in keyof Columns & string as RelationFromColumn<Columns[K]> extends never ? never : RelationFromColumn<Columns[K]>["as"]]: RelationFromColumn<Columns[K]>["table"];
};
type RelationFieldNames<Columns> = keyof RelationNames<Columns> & string;
type QueryFields<Columns> = {
    [K in keyof Columns & string]: K;
};
type QueryFieldKeys<Columns> = keyof QueryFields<Columns> & string;
type MutationFieldKeys<Columns> = keyof Columns & string;
type WhereInput<Columns> = Partial<Record<QueryFieldKeys<Columns>, unknown>> & {
    id?: unknown;
};
type SelectInput<Columns> = Partial<Record<QueryFieldKeys<Columns>, true>>;
type OrderByInput<Columns> = Partial<Record<QueryFieldKeys<Columns>, "asc" | "desc">>;
type RelationTargetSchema<S, TableName extends keyof S, RelationName extends string> = {
    [K in keyof S[TableName] & string]: RelationFromColumn<S[TableName][K]> extends {
        as: RelationName;
    } ? RelationFromColumn<S[TableName][K]>["table"] extends keyof S ? RelationFromColumn<S[TableName][K]>["table"] : never : never;
}[keyof S[TableName] & string];
type NestedNode<S extends SchemaMap, TableName extends keyof S> = {
    where?: WhereInput<S[TableName]>;
    orderBy?: OrderByInput<S[TableName]>;
    select?: SelectInput<S[TableName]>;
} & {
    [R in RelationFieldNames<S[TableName]>]?: NestedNode<S, RelationTargetSchema<S, TableName, R>> | true;
};
type RootNode<S extends SchemaMap, TableName extends keyof S> = NestedNode<S, TableName> & {
    take?: number;
    skip?: number;
};
interface KadakQuery<T> extends Promise<T> {
    toSQL: () => {
        sql: string;
        values: unknown[];
    };
    explain: () => Promise<unknown[]>;
    trace: () => {
        ast: unknown;
        plan: unknown;
        sql: string;
        values: unknown[];
    };
}
type TableQuery<S extends SchemaMap, T extends keyof S> = RootNode<S, T>;
type TableInsert<S extends SchemaMap, T extends keyof S> = Partial<Record<MutationFieldKeys<S[T]>, unknown>> & {
    id?: unknown;
};
type TableUpdate<S extends SchemaMap, T extends keyof S> = {
    where: WhereInput<S[T]>;
    data: Partial<TableInsert<S, T>>;
};
type TableDelete<S extends SchemaMap, T extends keyof S> = {
    where: WhereInput<S[T]>;
};
type InferredQuery<S extends SchemaMap> = {
    [K in keyof S]?: TableQuery<S, K>;
};
interface KadakInstance<S extends SchemaMap = SchemaMap> {
    readonly schema: Readonly<SchemaDefinition>;
    define<Tables extends Record<string, Table<string, Record<string, ColumnInput>>>>(tables: Tables): KadakInstance<DefinedSchema<Tables>>;
    push(): Promise<void>;
    data<T = unknown>(input: InferredQuery<S>, options?: {
        debug?: boolean;
        client?: pg.PoolClient;
    }): KadakQuery<T>;
    insert<T extends keyof S>(table: T, data: TableInsert<S, T>, options?: {
        client?: pg.PoolClient;
    }): Promise<unknown>;
    update<T extends keyof S>(table: T, options: TableUpdate<S, T> & {
        client?: pg.PoolClient;
    }): Promise<unknown[]>;
    delete<T extends keyof S>(table: T, options: TableDelete<S, T> & {
        client?: pg.PoolClient;
    }): Promise<unknown[]>;
    transaction<T>(fn: (tx: Omit<KadakInstance<S>, "schema" | "define" | "push" | "transaction" | "close">) => Promise<T>): Promise<T>;
    close(): Promise<void>;
}
interface KadakFactory {
    (config: KadakConfig): KadakInstance;
    table: <N extends string, C extends Record<string, ColumnInput>>(config: TableConfig<N, C>) => Table<N, C>;
    types: typeof types;
}
declare const kadak: KadakFactory;

export { type Compiled, type InferredQuery, type KadakConfig, type KadakFactory, type KadakInstance, type KadakQuery, type OrderBy, type Plan, type Predicate, type QueryAST, type RelationAST, buildAST, buildDeleteSQL, buildInsertSQL, buildPlan, buildUpdateSQL, compileSQL, kadak, normalize, types };
