export class MotionCodeError extends Error {}
export interface MotionProgram { frame: (t: number) => string; dispose: () => void }
export function compileMotion(code: string, o: { width: number; height: number; seconds: number }): MotionProgram;
