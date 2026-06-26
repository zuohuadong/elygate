import { resolve } from 'path';

export const workspaceRoot = resolve(import.meta.dir, '..', '..', '..', '..');

export function workspacePath(...segments: string[]): string {
    return resolve(workspaceRoot, ...segments);
}
