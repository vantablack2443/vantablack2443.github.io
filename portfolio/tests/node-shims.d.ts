// The few Node APIs tests/river.test.ts uses, typed by hand so the project needs no @types/node.
declare module 'node:fs' {
  export function readFileSync(path: URL | string): Uint8Array<ArrayBuffer>;
}
declare module 'node:os' {
  export function homedir(): string;
}
declare module 'node:path' {
  export const delimiter: string;
}
declare module 'node:child_process' {
  export function execFileSync(
    file: string,
    args: string[],
    options: { cwd?: string; env?: Record<string, string | undefined>; encoding: 'utf8'; stdio?: string },
  ): string;
}
declare const process: { env: Record<string, string | undefined> };
