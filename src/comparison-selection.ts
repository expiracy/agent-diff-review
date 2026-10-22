import type { CompareOptions } from './command-options.ts';
import type { Comparison, Endpoint } from './git.ts';

export function comparisonSources(review: Comparison): CompareOptions {
  return { base: review.sourceBase ?? review.base, target: review.sourceTarget ?? review.target, mode: review.mode };
}

export function endpointLabel(endpoint: Endpoint): string {
  return endpoint.kind === 'worktree' ? endpoint.label.split(' · ')[0] : endpoint.label;
}

export function matchesComparison(selection: CompareOptions, review: Comparison): boolean {
  const shown = comparisonSources(review);
  return selection.mode === shown.mode && (['base', 'target'] as const).every(side =>
    selection[side].kind === shown[side].kind && selection[side].value === shown[side].value);
}

export function swapComparison(selection: CompareOptions): CompareOptions {
  return { base: selection.target, target: selection.base, mode: selection.target.kind === 'worktree' ? 'exact' : selection.mode };
}
