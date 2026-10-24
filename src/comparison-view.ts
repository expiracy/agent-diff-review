import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { CompareOptions } from './command-options.ts';

export interface ComparisonViewState {
  selection?: CompareOptions;
  showing?: { base: string; target: string; files: number; createdAt: string };
  agent?: string;
  repository?: string;
  dirty: boolean;
  busy: boolean;
}

export class ComparisonView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private currentState: ComparisonViewState = { dirty: false, busy: false };
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly extensionUri: vscode.Uri, private readonly onAction: (message: unknown) => Promise<unknown>) {}

  get state(): Readonly<ComparisonViewState> { return this.currentState; }

  update(state: ComparisonViewState): void {
    this.currentState = state;
    this.publish();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const resources = vscode.Uri.joinPath(this.extensionUri, 'resources');
    const icons = vscode.Uri.joinPath(this.extensionUri, 'out', 'codicons');
    view.webview.options = { enableScripts: true, localResourceRoots: [resources, icons] };
    const nonce = randomBytes(24).toString('base64');
    const uiStyle = view.webview.asWebviewUri(vscode.Uri.joinPath(resources, 'vscode-ui.css'));
    const style = view.webview.asWebviewUri(vscode.Uri.joinPath(resources, 'comparison.css'));
    const script = view.webview.asWebviewUri(vscode.Uri.joinPath(resources, 'comparison.js'));
    const iconStyle = view.webview.asWebviewUri(vscode.Uri.joinPath(icons, 'codicon.css'));
    view.webview.html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; font-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${iconStyle}"><link rel="stylesheet" href="${uiStyle}"><link rel="stylesheet" href="${style}"><title>Comparison</title></head>
<body>
  <div class="field">
    <div class="field-heading"><span class="field-label" id="base-label">Base · left side</span>
      <button id="swap" class="icon-button" title="Swap left and right" aria-label="Swap left and right" disabled><span class="codicon codicon-arrow-swap" aria-hidden="true"></span></button>
    </div>
    <button id="base" class="choice" aria-labelledby="base-label base-value base-detail" disabled>
      <strong id="base-value">Choose a branch…</strong><span id="base-detail" class="detail"></span><span class="codicon codicon-chevron-down chevron" aria-hidden="true"></span>
    </button>
  </div>
  <div class="field">
    <span class="field-label" id="target-label">Compare · right side</span>
    <button id="target" class="choice" aria-labelledby="target-label target-value target-detail" disabled>
      <strong id="target-value">Choose a branch or worktree…</strong><span id="target-detail" class="detail"></span><span class="codicon codicon-chevron-down chevron" aria-hidden="true"></span>
    </button>
  </div>
  <label class="field-label" for="mode">Show</label>
  <div class="mode-row">
    <select id="mode" aria-describedby="mode-help" disabled><option value="exact">Exact differences</option><option value="merge-base">Branch changes</option></select>
  </div>
  <p id="mode-help" class="muted"></p>
  <button id="compare" class="action-button" disabled>Compare</button>
  <div id="status" class="muted" role="status" aria-live="polite">Open a Git repository to compare changes.</div>
  <div id="showing" class="muted"></div>
  <button id="agent" class="link" disabled>Connect an agent…</button>
  <script nonce="${nonce}" src="${script}"></script>
</body></html>`;
    this.disposables.push(view.webview.onDidReceiveMessage(message => {
      if (message?.action === 'ready') { this.publish(); return; }
      void this.onAction(message).catch(error => vscode.window.showErrorMessage(`Agent Diff Review: ${error instanceof Error ? error.message : String(error)}`));
    }));
    this.publish();
  }

  private publish(): void {
    void this.view?.webview.postMessage({ type: 'state', ...this.currentState });
  }

  dispose(): void { for (const disposable of this.disposables) disposable.dispose(); }
}
