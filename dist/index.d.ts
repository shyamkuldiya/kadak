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
        backRef?: string;
    };
    unique?: boolean;
    nullable?: boolean;
    default?: unknown;
    length?: number;
    onDelete?: "cascade" | "restrict" | "set null" | "no action";
    index?: boolean;
    autoUpdate?: boolean;
};
type Column<T = unknown> = {
    __type: T;
};
type ColumnDef = string | ColumnObject | ColumnBuilder | Column<unknown>;
type InferColumns<T> = {
    [K in keyof T]: T[K] extends Column<infer U> ? U : never;
};
interface TableConfig<N extends string = string, C extends Record<string, ColumnDef> = Record<string, ColumnDef>> {
    name: N;
    columns: C;
}
interface Table<N extends string = string, C extends Record<string, ColumnDef> = Record<string, ColumnDef>> {
    config: TableConfig<N, C>;
    columns: C;
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
    }> & Column<string>;
    varchar: (len?: number) => ColumnBuilder<{
        type: "varchar";
        length?: number;
    }> & Column<string>;
    int: () => ColumnBuilder<{
        type: "int";
    }> & Column<number>;
    text: () => ColumnBuilder<{
        type: "text";
    }> & Column<string>;
    jsonb: () => ColumnBuilder<{
        type: "jsonb";
    }> & Column<unknown>;
    timestamp: () => ColumnBuilder<{
        type: "timestamp";
    }> & Column<string>;
    array: <T extends "string" | "int">(innerType: ColumnBuilder<{
        type: T;
    }> & Column<T extends "string" ? string : number>) => ColumnBuilder<{
        type: "array";
        array: {
            type: T;
        };
    }> & Column<T extends "string" ? string[] : number[]>;
    ref: <const TableName extends string, const RelationName extends string, const To extends string = "id", const BackRef extends string | undefined = undefined>(table: TableName, opts: {
        as: RelationName;
        to?: To;
        backRef?: BackRef;
    }) => ColumnBuilder<{
        type: "int";
        ref: {
            table: TableName;
            as: RelationName;
            to: To;
            backRef?: BackRef;
        };
    }> & Column<number>;
    timestamps: () => {
        createdAt: ColumnBuilder<{
            type: "timestamp";
        }> & Column<string>;
        updatedAt: Column<string> & ColumnObject;
    };
};

type Predicate = {
    field: string;
    value: unknown;
};
type RelationAST = {
    name: string;
    _count?: boolean;
    select?: Record<string, true>;
    relations: RelationAST[];
};
type OrderBy = {
    field: string;
    direction: "asc" | "desc";
};
type QueryAST = {
    root: string;
    _count?: boolean;
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

type Row = Record<string, unknown>;
type Schema = Record<string, Record<string, unknown>>;
/**
 * Normalizes flat SQL rows into a nested object graph based on the AST structure.
 * Groups by 'id' and avoids duplicates.
 * Supports both aliased (table__col for roots, relation_col for relations) and raw rows (for mutations).
 */
declare function normalize(rows: Row[], ast: QueryAST, schema: Schema): Row[];

declare function buildInsertSQL(table: string, data: Record<string, unknown>): {
    sql: string;
    values: unknown[];
};
declare function buildUpdateSQL(table: string, where: Record<string, unknown>, data: Record<string, unknown>): {
    sql: string;
    values: unknown[];
};
declare function buildDeleteSQL(table: string, where: Record<string, unknown>): {
    sql: string;
    values: unknown[];
};

type KadakConfig = {
    url: string;
};
type SchemaMap = Record<string, Record<string, unknown>>;
type ColumnInput = string | ColumnObject | ColumnBuilder | Column<unknown>;
type TableColumns<T> = T extends {
    columns: infer C;
} ? C : T extends {
    config: {
        columns: infer C;
    };
} ? C : never;
type DefinedSchema<Tables extends Record<string, Table<string, Record<string, ColumnInput>>>> = {
    [K in keyof Tables & string]: TableRow<TableColumns<Tables[K]>>;
};
type BuiltColumn<C> = C extends ColumnBuilder<infer O> ? O : C extends Column<infer U> ? {
    __type: U;
} : C extends string ? C extends `${string}.${string}` ? {
    relation: C;
} : {
    type: C;
} : C;
type ColumnValue<C> = BuiltColumn<C> extends {
    relation: string;
} ? never : BuiltColumn<C> extends {
    array: {
        type: "string";
    };
} ? string[] : BuiltColumn<C> extends {
    array: {
        type: "int";
    };
} ? number[] : BuiltColumn<C> extends {
    ref: unknown;
} ? number : BuiltColumn<C> extends {
    type: "int";
} ? number : BuiltColumn<C> extends {
    type: "timestamp";
} ? string : BuiltColumn<C> extends {
    type: "jsonb";
} ? unknown : BuiltColumn<C> extends {
    type: "text" | "string" | "varchar";
} ? string : never;
type TableRow<Columns> = {
    id: number;
} & {
    [K in keyof Columns & string as ColumnValue<Columns[K]> extends never ? never : K]: ColumnValue<Columns[K]>;
};
type RelationFromColumn<C, K extends string> = BuiltColumn<C> extends {
    ref: {
        table: infer Table extends string;
        as: infer As extends string;
    };
} ? BuiltColumn<C> extends {
    ref: {
        backRef: infer BackRef extends string;
    };
} ? {
    table: Table;
    as: As;
} | {
    table: K extends string ? any : never;
    as: BackRef;
} : {
    table: Table;
    as: As;
} : BuiltColumn<C> extends {
    relation: infer Rel extends string;
} ? Rel extends `${infer Table}.${string}` ? {
    table: Table;
    as: K;
} : never : never;
type RelationNames<Columns> = {
    [K in keyof Columns & string as RelationFromColumn<Columns[K], K> extends never ? never : RelationFromColumn<Columns[K], K>["as"]]: RelationFromColumn<Columns[K], K>["table"];
};
type QueryFieldKeys<Columns> = keyof Columns & string;
type WhereInput<Columns> = Partial<{
    [K in keyof Columns & string]: Columns[K];
}> & {
    id?: number;
};
type SelectInput<Columns> = Partial<Record<QueryFieldKeys<Columns>, true>>;
type OrderByInput<Columns> = Partial<Record<QueryFieldKeys<Columns>, "asc" | "desc">>;
type RelationGraph<Tables extends Record<string, Table<string, Record<string, ColumnInput>>>> = {
    [K in keyof Tables & string]: RelationNames<TableColumns<Tables[K]>>;
};
type QueryNode<S extends SchemaMap, D extends Record<string, Record<string, string>>, TableName extends keyof S & keyof D> = {
    where?: WhereInput<S[TableName]>;
    orderBy?: OrderByInput<S[TableName]>;
    select?: SelectInput<S[TableName]>;
} & {
    [R in keyof D[TableName] & string]?: D[TableName][R] extends keyof S ? (QueryNode<S, D, D[TableName][R]> & {
        _count?: true;
    }) | true : never;
};
type RootNode<S extends SchemaMap, D extends Record<string, Record<string, string>>, TableName extends keyof S & keyof D> = QueryNode<S, D, TableName> & {
    _count?: true;
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
type TableQuery<S extends SchemaMap, D extends Record<string, Record<string, string>>, T extends keyof S & keyof D> = RootNode<S, D, T>;
type TableInsert<S extends SchemaMap, T extends keyof S> = Partial<{
    [K in keyof S[T] & string as K extends "id" ? never : K]: S[T][K];
}> & {
    id?: number;
};
type TableUpdate<S extends SchemaMap, T extends keyof S> = {
    where: WhereInput<S[T]>;
    data: Partial<TableInsert<S, T>>;
};
type TableDelete<S extends SchemaMap, T extends keyof S> = {
    where: WhereInput<S[T]>;
};
type InferredQuery<S extends SchemaMap, D extends Record<string, Record<string, string>>> = {
    [K in keyof S & keyof D]?: TableQuery<S, D, K> | true;
};
type ColumnSelection<Columns, Selection> = Selection extends Record<string, true> ? {
    [K in keyof Selection & keyof Columns as Selection[K] extends true ? K : never]: ColumnValue<Columns[K]>;
} : {
    [K in keyof Columns]: ColumnValue<Columns[K]>;
};
type RelationCountSelection<Node> = Node extends {
    _count: true;
} ? {
    _count: number;
} : {};
type RowResult<S extends SchemaMap, D extends Record<string, Record<string, string>>, TableName extends keyof S & keyof D, Node> = ColumnSelection<S[TableName], Node extends {
    select: infer Sel;
} ? Sel : never> & RelationCountSelection<Node> & RelationMapResult<S, D, TableName, Node>;
type RelationMapResult<S extends SchemaMap, D extends Record<string, Record<string, string>>, TableName extends keyof S & keyof D, Node> = Node extends Record<string, unknown> ? {
    [R in keyof D[TableName] & string as R extends keyof Node ? R : never]: D[TableName][R] extends keyof S ? Node[R] extends {
        _count: true;
    } ? {
        _count: number;
    } : Node[R] extends true ? RowResult<S, D, D[TableName][R], true> : RowResult<S, D, D[TableName][R], Node[R]> : never;
} : {};
type QueryResult<S extends SchemaMap, D extends Record<string, Record<string, string>>, Q extends InferredQuery<S, D>> = {
    [K in keyof Q & keyof S & keyof D]: Array<RowResult<S, D, K, Q[K]>>;
};
interface KadakInstance<S extends SchemaMap = SchemaMap, D extends Record<string, Record<string, string>> = Record<string, never>> {
    readonly schema: Readonly<SchemaDefinition>;
    define<Tables extends Record<string, Table<string, Record<string, ColumnInput>>>>(tables: Tables): KadakInstance<DefinedSchema<Tables>, RelationGraph<Tables>>;
    push(): Promise<void>;
    data<Q extends InferredQuery<S, D>>(input: Q, options?: {
        debug?: boolean;
        client?: pg.PoolClient;
    }): KadakQuery<Q[keyof Q & keyof S & keyof D] extends {
        _count: true;
    } ? {
        [K in keyof Q & keyof S & keyof D]: {
            _count: number;
        };
    } : QueryResult<S, D, Q>>;
    insert<T extends keyof S & string>(table: T, data: TableInsert<S, T>, options?: {
        client?: pg.PoolClient;
    }): Promise<unknown>;
    update<T extends keyof S & string>(table: T, options: TableUpdate<S, T> & {
        client?: pg.PoolClient;
    }): Promise<unknown[]>;
    delete<T extends keyof S & string>(table: T, options: TableDelete<S, T> & {
        client?: pg.PoolClient;
    }): Promise<unknown[]>;
    transaction<T>(fn: (tx: Omit<KadakInstance<S, D>, "schema" | "define" | "push" | "transaction" | "close">) => Promise<T>): Promise<T>;
    close(): Promise<void>;
}
interface KadakFactory {
    (config: KadakConfig): KadakInstance;
    table: <N extends string, C extends Record<string, ColumnInput>>(config: TableConfig<N, C>) => Table<N, C>;
    types: typeof types;
}
declare const kadak: KadakFactory;

export { type Compiled, type InferColumns, type InferredQuery, type KadakConfig, type KadakFactory, type KadakInstance, type KadakQuery, type OrderBy, type Plan, type Predicate, type QueryAST, type RelationAST, buildAST, buildDeleteSQL, buildInsertSQL, buildPlan, buildUpdateSQL, compileSQL, kadak, normalize, types };
