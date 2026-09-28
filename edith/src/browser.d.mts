export function browserEnabled(env?: Record<string, string | undefined>): boolean;
export function modifierMask(m?: { alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean }): number;
export function keyEventParams(k: Record<string, unknown>): Record<string, unknown>;
export function mouseEventParams(m: Record<string, unknown>, size: { width: number; height: number }): Record<string, unknown>;
export function viewSize(w?: unknown, h?: unknown): { width: number; height: number };
export function closeBrowser(): Promise<void>;
export function handleBrowserSocket(socket: unknown): void;
export interface LaunchCandidate { label: string; id: string; opts: { executablePath?: string; channel?: string } }
export function launchCandidates(o?: { platform?: string; env?: Record<string, string | undefined>; exists?: (p: string) => boolean }): LaunchCandidate[];
export function staleBrowserCommand(platform: string, dir: string): { file: string; args: string[]; env: Record<string, string> };
