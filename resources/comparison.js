const vscode = acquireVsCodeApi();
const elements = Object.fromEntries(['base', 'target', 'mode', 'swap', 'compare', 'agent', 'status', 'showing', 'mode-help'].map(id => [id, document.getElementById(id)]));

for (const side of ['base', 'target']) elements[side].addEventListener('click', () => vscode.postMessage({ action: 'pick', side }));
elements.mode.addEventListener('change', () => vscode.postMessage({ action: 'mode', mode: elements.mode.value }));
elements.swap.addEventListener('click', () => vscode.postMessage({ action: 'swap' }));
elements.agent.addEventListener('click', () => vscode.postMessage({ action: 'agent' }));
elements.compare.addEventListener('click', () => {
  elements.compare.disabled = true;
  vscode.postMessage({ action: 'compare' });
});

window.addEventListener('message', event => {
  const state = event.data;
  if (state.type !== 'state') return;
  const disabled = state.busy || !state.selection;
  for (const id of ['base', 'target', 'mode', 'swap', 'compare']) elements[id].disabled = disabled;
  document.body.setAttribute('aria-busy', String(state.busy));
  for (const side of ['base', 'target']) {
    const endpoint = state.selection?.[side];
    document.getElementById(`${side}-value`).textContent = endpoint?.label.split(' · ')[0] ?? 'Choose a branch…';
    document.getElementById(`${side}-detail`).textContent = endpoint ? (endpoint.kind === 'worktree' ? 'Working tree' : endpoint.value.startsWith('refs/remotes/') ? 'Remote branch' : 'Branch / revision') : '';
    elements[side].title = endpoint?.value ?? '';
  }
  elements.mode.value = state.selection?.mode ?? 'exact';
  elements.mode.querySelector('[value="merge-base"]').disabled = state.selection?.base.kind !== 'ref';
  elements['mode-help'].textContent = elements.mode.value === 'merge-base' ? 'Changes introduced on the right since the common ancestor.' : 'Compare the two selected states directly.';
  elements.compare.textContent = state.busy ? 'Comparing…' : !state.showing ? 'Compare' : state.dirty ? 'Apply Comparison' : 'Refresh Changes';
  elements.status.textContent = !state.selection ? 'Open a Git repository to compare changes.' : state.busy ? 'Preparing the diff…' : state.dirty && state.showing ? 'Selection changed. Apply it to update the diff.' : state.showing ? `${state.showing.files} changed file${state.showing.files === 1 ? '' : 's'} · snapshot ${new Date(state.showing.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Choose the left and right sides, then compare.';
  elements.showing.textContent = state.showing && state.dirty ? `Showing: ${state.showing.base} → ${state.showing.target}` : '';
  elements.agent.disabled = !state.repository || state.busy;
  elements.agent.textContent = state.agent ? `Agent: ${state.agent}` : 'Connect an agent…';
});

vscode.postMessage({ action: 'ready' });
