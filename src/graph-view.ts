import * as vscode from 'vscode';
import { GraphService } from './graph-service.ts';
import type { Comparison } from './git.ts';
import type { ChangeGraph } from './change-graph.ts';
import { randomBytes } from 'node:crypto';
import { endpointLabel } from './comparison-selection.ts';

export interface GraphLocation { reviewId: string; filePath: string; side: 'before' | 'after'; startLine: number; endLine: number }
interface GraphPage { panel: vscode.WebviewPanel; review: Comparison; promise: Promise<ChangeGraph>; graph?: ChangeGraph; error?: string }

export class GraphView implements vscode.Disposable {
  private readonly pages = new Map<string, GraphPage>();
  constructor(private readonly extensionUri: vscode.Uri, private readonly openLocation: (location: GraphLocation) => Promise<void>, private readonly service: Pick<GraphService, 'build' | 'dispose'> = new GraphService()) {}

  async retry(reviewId: string): Promise<ChangeGraph | undefined> {
    const page = this.pages.get(reviewId);
    if (!page) return;
    if (page.error) {
      page.error = undefined;
      page.promise = this.settle(page, Promise.resolve().then(() => this.service.build(page.review)));
      this.publish(page);
    }
    return page.promise.catch(() => undefined);
  }

  show(review: Comparison, restoredPanel?: vscode.WebviewPanel): Promise<ChangeGraph> {
    const existing = this.pages.get(review.id);
    if (existing && !restoredPanel) {
      existing.panel.reveal();
      if (existing.error) void this.retry(review.id);
      return existing.promise;
    }
    if (existing?.panel !== restoredPanel) existing?.panel.dispose();
    const resources = vscode.Uri.joinPath(this.extensionUri, 'resources');
    const options = { enableScripts: true, localResourceRoots: [resources, vscode.Uri.joinPath(this.extensionUri, 'out')] };
    const panel = restoredPanel ?? vscode.window.createWebviewPanel('agentDiffReview.graph', 'Change graph', vscode.ViewColumn.Active, options);
    panel.title = 'Change graph';
    panel.webview.options = options;
    panel.iconPath = vscode.Uri.joinPath(resources, 'review.svg');
    const page: GraphPage = { panel, review, promise: Promise.resolve().then(() => this.service.build(review)) };
    this.pages.set(review.id, page);
    const messages = panel.webview.onDidReceiveMessage((message: unknown) => {
      if (!message || typeof message !== 'object') return;
      const action = message as { action?: unknown; id?: unknown; filePath?: unknown };
      if (action.action === 'ready') { this.publish(page); return; }
      if (action.action === 'retry') { void this.retry(review.id); return; }
      const operation = action.action === 'open-symbol' && typeof action.id === 'string' ? this.openSymbol(review.id, action.id)
        : action.action === 'open-usage' && typeof action.id === 'string' ? this.openUsage(review.id, action.id)
        : action.action === 'open-file' && typeof action.filePath === 'string' ? this.openFile(review.id, action.filePath) : undefined;
      void operation?.catch(error => vscode.window.showErrorMessage(`Agent Diff Review: ${error instanceof Error ? error.message : String(error)}`));
    });
    panel.onDidDispose(() => { messages.dispose(); if (this.pages.get(review.id) === page) this.pages.delete(review.id); });
    panel.webview.html = this.html(panel.webview);
    page.promise = this.settle(page, page.promise);
    return page.promise;
  }

  private settle(page: GraphPage, pending: Promise<ChangeGraph>): Promise<ChangeGraph> {
    return pending.then(graph => { page.graph = graph; this.publish(page); return graph; }, error => { page.error = String(error); this.publish(page); throw error; });
  }

  private publish(page: GraphPage): void {
    if (this.pages.get(page.review.id) !== page) return;
    void page.panel.webview.postMessage({ type: 'graph', reviewId: page.review.id, graph: page.graph, error: page.error, comparison: `${endpointLabel(page.review.base)} → ${endpointLabel(page.review.target)}`, createdAt: page.review.createdAt });
  }

  async openSymbol(reviewId: string, id: string): Promise<void> {
    const symbol = this.pages.get(reviewId)?.graph?.symbols.find(symbol => symbol.id === id);
    if (!symbol) throw new Error('This graph symbol is unavailable. Reopen the graph.');
    const range = symbol.after ?? symbol.before!;
    await this.openLocation({ reviewId, filePath: symbol.filePath, side: symbol.after ? 'after' : 'before', ...range });
  }

  async openUsage(reviewId: string, id: string): Promise<void> {
    const edge = this.pages.get(reviewId)?.graph?.edges.find(edge => edge.id === id);
    const usage = edge?.after ?? edge?.before;
    if (!usage) throw new Error('This graph usage is unavailable. Reopen the graph.');
    await this.openLocation({ reviewId, filePath: usage.filePath, side: edge!.after ? 'after' : 'before', startLine: usage.line, endLine: usage.line });
  }

  private async openFile(reviewId: string, filePath: string): Promise<void> {
    const file = this.pages.get(reviewId)?.graph?.files.find(file => file.path === filePath);
    if (!file) throw new Error('This file is not in the graph snapshot.');
    await this.openLocation({ reviewId, filePath, side: file.status === 'deleted' ? 'before' : 'after', startLine: 1, endLine: 1 });
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(24).toString('base64');
    const uiStyle = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'vscode-ui.css'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'graph.css'));
    const layout = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'graph-layout.js'));
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'graph.js'));
    const icons = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'codicons', 'codicon.css'));
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${icons}"><link rel="stylesheet" href="${uiStyle}"><link rel="stylesheet" href="${style}"><title>Change graph</title></head><body aria-busy="true">
<header><div class="heading"><div class="view-title"><span class="codicon codicon-type-hierarchy" aria-hidden="true"></span><h1>Change graph</h1></div><span class="heading-divider" aria-hidden="true"></span><span id="comparison"></span><span id="snapshot"></span></div>
<div class="toolbar"><div class="search-box"><span class="codicon codicon-search" aria-hidden="true"></span><input id="search" type="search" aria-label="Find a symbol or file" placeholder="Find a symbol or file"></div><div class="filter-group" role="group" aria-label="Change types"><label class="filter-option" title="Show added symbols"><input type="checkbox" data-status="added" aria-label="Added" checked><span class="filter-marker added">A</span><span>Added</span></label><label class="filter-option" title="Show modified symbols"><input type="checkbox" data-status="modified" aria-label="Modified" checked><span class="filter-marker modified">M</span><span>Modified</span></label><label class="filter-option" title="Show removed symbols"><input type="checkbox" data-status="deleted" aria-label="Removed" checked><span class="filter-marker deleted">D</span><span>Removed</span></label></div><span class="toolbar-divider" aria-hidden="true"></span><label class="filter-option context-option" title="Show directly related unchanged symbols"><input id="related" type="checkbox" aria-label="Related unchanged" checked><span class="codicon codicon-references" aria-hidden="true"></span><span>Context</span></label><div class="layout-control"><button id="layout-toggle" type="button" class="toolbar-button" aria-label="Layout" aria-expanded="false" aria-controls="layout-options" disabled><span class="codicon codicon-layout" aria-hidden="true"></span><span>Layout</span><span class="codicon codicon-chevron-down" aria-hidden="true"></span></button><div id="layout-options" hidden><label>Layout mode<select id="layout-mode" aria-label="Layout mode"><option value="relationships">Relationships</option><option value="axes">Axes</option></select></label><div id="axis-options" hidden><label>Horizontal axis<select id="axis-horizontal" aria-label="Horizontal axis"><option value="folder">Folder</option><option value="file">File</option><option value="changes">Changed lines</option><option value="status">Change type</option></select></label><label>Vertical axis<select id="axis-vertical" aria-label="Vertical axis"><option value="folder">Folder</option><option value="file">File</option><option value="changes">Changed lines</option><option value="status">Change type</option></select></label><button id="swap-axes" type="button" class="toolbar-button"><span class="codicon codicon-arrow-swap" aria-hidden="true"></span>Swap axes</button><p>Changed lines = added + removed. Connections stay the same.</p></div><label class="connections-option">Connections<select id="connections-mode" aria-label="Connections"><option value="all">All</option><option value="selected">Selected card</option></select></label></div></div><span id="axis-summary" hidden></span><button id="other-toggle" type="button" class="toolbar-button" disabled title="Available after graph analysis completes"><span class="codicon codicon-files" aria-hidden="true"></span><span>Other changes</span></button></div></header>
<div class="workspace"><main id="viewport" aria-label="Change graph canvas"><div id="world"><svg id="edges" aria-hidden="true"></svg><div id="cards"></div></div><div id="axis-guides" hidden></div><div class="analysis-message"><div id="notice" role="status">Analysing captured files…</div><button id="retry-analysis" type="button" class="action-button" hidden>Retry analysis</button></div><div id="other" hidden></div><div class="camera-controls" role="toolbar" aria-label="Graph view"><button id="scope-back" type="button" hidden><span class="codicon codicon-arrow-left" aria-hidden="true"></span>All files</button><button id="zoom-out" type="button" aria-label="Zoom out" title="Zoom out"><span class="codicon codicon-remove" aria-hidden="true"></span></button><span id="zoom-level">100%</span><button id="zoom-in" type="button" aria-label="Zoom in" title="Zoom in"><span class="codicon codicon-add" aria-hidden="true"></span></button><span class="toolbar-divider" aria-hidden="true"></span><button id="fit" type="button" aria-label="Fit graph" title="Fit graph to view"><span class="codicon codicon-screen-full" aria-hidden="true"></span></button></div></main>
<aside id="context" aria-label="Selection context"><div class="context-label">Details</div><div class="context-empty"><span class="codicon codicon-symbol-class" aria-hidden="true"></span><strong>Select a symbol</strong><p>Explore its changes, dependencies and usages.</p></div></aside></div>
<footer><span id="status" role="status" aria-live="polite">Preparing comparison…</span><span class="navigation-hint">Drag or scroll to pan · Shift + scroll to pan sideways · Ctrl/⌘ + scroll to zoom</span></footer>
<script nonce="${nonce}" src="${layout}"></script><script nonce="${nonce}" src="${script}"></script></body></html>`;
  }

  dispose(): void { for (const page of this.pages.values()) page.panel.dispose(); this.service.dispose(); }
}
