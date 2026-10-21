import type { Comparison, Endpoint } from './git.ts';

export type CompareOptions = { base: Endpoint; target: Endpoint; mode?: Comparison['mode'] };
export type SendOptions = { connectionId: string; instruction?: string };

export function comparisonOptions(argument: unknown): CompareOptions | undefined {
  if (!argument || typeof argument !== 'object') return undefined;
  const value = argument as Record<string, unknown>;
  const endpoint = (item: unknown): item is Endpoint => {
    if (!item || typeof item !== 'object') return false;
    const source = item as Record<string, unknown>;
    return (source.kind === 'ref' || source.kind === 'worktree') && typeof source.value === 'string' && typeof source.label === 'string';
  };
  return endpoint(value.base) && endpoint(value.target) ? argument as CompareOptions : undefined;
}

export function sendOptions(argument: unknown): SendOptions | undefined {
  return argument && typeof argument === 'object' && 'connectionId' in argument && typeof argument.connectionId === 'string'
    ? argument as SendOptions : undefined;
}
