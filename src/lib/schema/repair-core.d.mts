export interface SchemaSnapshot { tables: Set<string>; columns: Set<string>; indexes: Set<string>; constraints: Set<string>; types: Set<string> }
export interface DbObject { kind: "table" | "column" | "index" | "constraint" | "type"; name: string }
export interface PlanItem { name: string; additive: boolean; missing: DbObject[]; complete: boolean | null; sql: string[]; checksum: string }
export interface RepairClient { $queryRawUnsafe<T = unknown>(sql: string, ...v: unknown[]): Promise<T>; $executeRawUnsafe(sql: string, ...v: unknown[]): Promise<number> }
export interface RepairResult { repaired: string[]; failed: { name: string; error: string }[]; blocked: string[]; recorded: number; stillMissing: { name: string; missing: string[] }[] }
export function statements(sql: string): string[];
export function classify(stmt: string): { objects: DbObject[]; sql: string } | null;
export function planRepair(migrations: { name: string; sql: string }[], schema: SchemaSnapshot): PlanItem[];
export function readSchema(client: RepairClient): Promise<SchemaSnapshot>;
export function repairSchema(client: RepairClient, migrations: { name: string; sql: string }[]): Promise<RepairResult>;
export function loadMigrations(dir: string): Promise<{ name: string; sql: string }[]>;
