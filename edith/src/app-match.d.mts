export function normalizeName(s: string): string;
export const ALIASES: Record<string, string>;
export const JUNK: RegExp;
export function lev(a: string, b: string): number;
export function matchScore(query: string, appName: string): number;
export function findApp<T extends { name: string }>(query: string, apps: T[]): { app: T; score: number } | { app: null; suggestions: string[] };
