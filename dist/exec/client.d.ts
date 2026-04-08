import pg from 'pg';

declare function runQuery(sql: string, values: unknown[], url?: string, client?: pg.PoolClient): Promise<any[]>;
declare function getTransactionClient(url?: string): Promise<pg.PoolClient>;
declare function closePool(): Promise<void>;

export { closePool, getTransactionClient, runQuery };
