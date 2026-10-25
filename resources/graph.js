(() => {
  const vscode = acquireVsCodeApi();
  const byId = id => document.getElementById(id);
  const viewport = byId('viewport'), world = byId('world'), cardLayer = byId('cards'), svg = byId('edges'), context = byId('context');
  const saved = vscode.getState() || {};
  const axisNames = { folder: 'Folder', file: 'File', changes: 'Changed lines', status: 'Change type' };
  let layoutMode = saved.layoutMode === 'axes' ? 'axes' : 'relationships';
  let axes = saved.axes && axisNames[saved.axes.horizontal] && axisNames[saved.axes.vertical] && saved.axes.horizontal !== saved.axes.vertical ? { ...saved.axes } : { horizontal: 'changes', vertical: 'status' };
  let axesLayout, layoutRevision = 0;
  let connectionsMode = saved.connectionsMode === 'selected' ? 'selected' : 'all', connectionSummary = '';
  let graph, snapshotInfo, capturedAt, reviewId = saved.reviewId, symbols = new Map(), files = new Map(), cards = [], cardMap = new Map(), groups = [], rootIds = new Map(), membersByRoot = new Map();
  let feedback = {}, notesById = new Map();
  const memberPages = new Map(Object.entries(saved.memberPages || {}));
  const commentPages = new Map();
  let selected = saved.selected || null, expanded = new Set(saved.expanded || []), revealed = new Set(), scope = saved.scope || '', query = saved.query || '';
  let camera = saved.camera || { x: 24, y: 24, zoom: 1 }, frame = 0, searchTimer, dragging, pendingFocus, initialized = false, analysisState = 'loading';
  let restoreRetryFocus = false;
  const mountedCards = new Map();
  let cardsDirty = true, lastVisibleKey = '';
  const statuses = new Set(saved.statuses || ['added', 'modified', 'deleted']);
  const closedSections = new Set(saved.closedSections || []);
  const cardWidth = 320;
  const labels = { added: 'A', modified: 'M', deleted: 'D', unchanged: '·' };
  const symbolIcons = { class: 'symbol-class', interface: 'symbol-interface', function: 'symbol-method', method: 'symbol-method', field: 'symbol-field', file: 'file-code', dependency: 'references' };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(text, action, className = 'link') {
    const node = element('button', className, text); node.type = 'button'; node.addEventListener('click', action); return node;
  }
  function icon(name, className = '') {
    const node = element('span', `codicon codicon-${name} ${className}`); node.setAttribute('aria-hidden', 'true'); return node;
  }
  function symbolIcon(kind) { return icon(symbolIcons[kind] || 'symbol-misc', `symbol-icon ${kind}`); }
  function commentsFor(kind, id) {
    const ids = (kind === 'file' ? feedback.files : feedback.symbols)?.[id];
    return Array.isArray(ids) ? ids.map(id => notesById.get(id)).filter(Boolean) : [];
  }
  function commentAnchor(anchor, kind, id, label) {
    anchor.classList.add('comment-anchor'); Object.assign(anchor.dataset, { commentKind: kind, commentId: id, commentLabel: label });
    renderCommentBadge(anchor);
  }
  function renderCommentBadge(anchor) {
    const { commentKind: kind, commentId: id, commentLabel: label } = anchor.dataset;
    const notes = commentsFor(kind, id); let badge = anchor.querySelector(':scope > .comment-badge');
    if (!notes.length) {
      if (badge && document.activeElement === badge && document.hasFocus()) anchor.querySelector('.node-head, .member')?.focus({ preventScroll: true });
      badge?.remove(); return;
    }
    const replies = notes.reduce((total, note) => total + note.replies.length, 0);
    if (!badge) { badge = button('', () => showGraphComments(kind, id), 'relation-action comment-badge'); anchor.append(badge); }
    badge.replaceChildren(icon('comment-discussion'), element('span', '', String(notes.length)));
    if (replies) badge.append(icon('reply'), element('span', '', String(replies)));
    const summary = `${notes.length} comment${notes.length === 1 ? '' : 's'}${replies ? ` and ${replies} agent repl${replies === 1 ? 'y' : 'ies'}` : ''}`;
    badge.title = `${summary} · ${notes.filter(note => !note.resolved).length} open`;
    badge.setAttribute('aria-label', `Show ${summary} for ${label}`);
  }
  function setFeedback(value, refresh = true) {
    feedback = value || {}; notesById = new Map((feedback.notes || []).map(note => [note.id, note]));
    cardLayer.querySelectorAll('.comment-anchor').forEach(renderCommentBadge);
    if (refresh) renderComments();
  }
  function showGraphComments(kind, id) {
    closedSections.delete('Comments');
    if (kind === 'file') { selected = { kind: 'file', id }; renderContext(); schedule(); persist(); }
    else selectSymbol(id, false);
    const section = byId('graph-comments');
    if (section) {
      section.open = true;
      const summary = section.querySelector('summary'); summary.focus({ preventScroll: true });
      context.scrollTop += summary.getBoundingClientRect().top - context.getBoundingClientRect().top - (context.querySelector('.context-label')?.offsetHeight || 0);
    }
  }
  function commentTime(value) {
    const time = element('time', 'comment-time', new Date(value).toLocaleString()); time.dateTime = value; return time;
  }
  function renderComments() {
    let section = byId('graph-comments');
    const active = document.hasFocus() && section?.contains(document.activeElement) ? document.activeElement : null;
    const activeNote = active?.closest('.graph-comment')?.dataset.commentId;
    const activeMore = active?.classList.contains('show-more-comments');
    const panelBounds = context.getBoundingClientRect(), visibleTop = panelBounds.top + (context.querySelector('.context-label')?.offsetHeight || 0);
    const reading = active?.closest('.graph-comment') ?? [...(section?.querySelectorAll('.graph-comment') || [])].find(entry => { const bounds = entry.getBoundingClientRect(); return bounds.bottom > visibleTop && bounds.top < panelBounds.bottom; });
    const readingAnchor = reading ? { id: reading.dataset.commentId, top: reading.getBoundingClientRect().top } : null;
    const notes = selected && ['symbol', 'file'].includes(selected.kind) ? commentsFor(selected.kind, selected.id) : [];
    if (!notes.length) { section?.remove(); return; }
    const scrollTop = context.scrollTop;
    if (!section) {
      const body = contextSection('Comments', notes.length); section = body.parentElement; section.id = 'graph-comments';
      const firstSection = context.querySelector('.context-section'); if (firstSection !== section) context.insertBefore(section, firstSection);
    }
    section.querySelector('.count-badge').textContent = String(notes.length);
    const body = section.querySelector('.section-body'); body.replaceChildren();
    const key = `${selected.kind}:${selected.id}`, limit = commentPages.get(key) || 20;
    for (const note of notes.slice(0, limit)) {
      const entry = element('article', 'graph-comment'); entry.dataset.commentId = note.id; entry.tabIndex = -1;
      const header = element('div', 'graph-comment-header');
      const state = feedback.statuses?.[note.id];
      header.append(element('strong', '', 'You'), element('span', `comment-status ${state?.id || ''}`, state?.id === 'draft' ? 'Draft' : state?.label || 'Comment'));
      const location = `${note.filePath}:${note.startLine}${note.endLine === note.startLine ? '' : `–${note.endLine}`} · ${note.side === 'before' ? 'Before' : 'After'} snapshot`;
      entry.append(header, element('div', 'comment-location', location), commentTime(note.createdAt), element('p', 'comment-body', note.body));
      for (const reply of note.replies) {
        const response = element('div', 'agent-reply');
        const heading = element('div', 'graph-comment-header'); heading.append(element('strong', '', 'Agent'), commentTime(reply.createdAt));
        response.append(heading, element('p', 'comment-body', reply.body)); entry.append(response);
      }
      body.append(entry);
    }
    if (notes.length > limit) body.append(button(`Show more comments (${notes.length - limit} remaining)`, () => {
      commentPages.set(key, limit + 20); renderComments(); const next = byId('graph-comments')?.querySelectorAll('.graph-comment')[limit]; next?.focus();
    }, 'link show-more-comments'));
    if (activeNote) ([...body.querySelectorAll('.graph-comment')].find(entry => entry.dataset.commentId === activeNote) ?? section.querySelector('summary')).focus({ preventScroll: true });
    else if (activeMore) (body.querySelector('.show-more-comments') ?? section.querySelector('summary')).focus({ preventScroll: true });
    context.scrollTop = scrollTop;
    if (readingAnchor) {
      const restored = [...body.querySelectorAll('.graph-comment')].find(entry => entry.dataset.commentId === readingAnchor.id);
      if (restored) context.scrollTop += restored.getBoundingClientRect().top - readingAnchor.top;
    }
  }
  function symbolContext(node, symbol) {
    node.dataset.vscodeContext = JSON.stringify({ webviewSection: 'graphSymbol', graphReviewId: reviewId, graphSymbolId: symbol.id, preventDefaultContextMenuItems: true });
  }
  function symbolLink(symbol, action) {
    const link = button('', action, 'link symbol-link inline-symbol');
    link.append(symbolIcon(symbol.kind), element('span', '', symbol.qualifiedName)); link.title = `${symbol.qualifiedName}\n${symbol.filePath}`; return link;
  }
  function openButton(text, action) { const node = button(text, action, 'action-button secondary open-diff'); node.prepend(icon('go-to-file')); return node; }
  function diffActions(text, kind, target, commentable = true) {
    const actions = element('div', 'diff-actions');
    actions.setAttribute('role', 'group'); actions.setAttribute('aria-label', 'Review actions');
    const comment = button('Add Comment', () => vscode.postMessage({ action: `comment-${kind}`, ...target }), 'action-button secondary add-comment');
    comment.prepend(icon('comment-add')); comment.title = 'Open the saved diff and comment on these lines';
    actions.append(openButton(text, () => vscode.postMessage({ action: `open-${kind}`, ...target })));
    if (commentable) actions.append(comment);
    return actions;
  }
  function counts(changes, full = false) {
    const node = element('span', 'line-counts');
    if (!changes) { node.textContent = '—'; node.title = 'Line counts unavailable'; return node; }
    node.setAttribute('aria-label', `${changes.added} lines added, ${changes.removed} lines removed`);
    node.title = `${changes.added} lines added · ${changes.removed} lines removed`;
    if (changes.added) node.append(element('span', 'line-added', full ? `${changes.added} added` : `+${changes.added}`));
    if (changes.removed) node.append(element('span', 'line-removed', full ? `${changes.removed} removed` : `−${changes.removed}`));
    if (full && !changes.added && !changes.removed) node.append(element('span', 'muted', 'No line changes'));
    return node;
  }
  function persist() {
    vscode.setState({ reviewId, selected, camera, scope, query, layoutMode, axes, connectionsMode, related: byId('related').checked, statuses: [...statuses], memberPages: Object.fromEntries([...memberPages].slice(-100)), expanded: [...expanded].slice(-100), closedSections: [...closedSections] });
  }
  function rootFor(symbol) {
    if (rootIds.has(symbol.id)) return rootIds.get(symbol.id);
    let root = symbol, parent = symbols.get(symbol.parentId);
    if (!['class', 'interface'].includes(symbol.kind)) while (parent) {
      if (parent.filePath !== symbol.filePath) break;
      root = parent;
      if (['class', 'interface'].includes(parent.kind)) break;
      parent = symbols.get(parent.parentId);
    }
    rootIds.set(symbol.id, root.id); return root.id;
  }
  function includedByStatus(symbol) { return symbol.status !== 'unchanged' && statuses.has(symbol.status); }
  function filteredMembers(id) { return (membersByRoot.get(id) || []).filter(member => member.status === 'unchanged' || statuses.has(member.status)); }

  function rebuild(fit = false) {
    if (!graph) return;
    const included = new Set();
    for (const symbol of graph.symbols) if (includedByStatus(symbol) && (!scope || symbol.filePath === scope) && (!query || `${symbol.qualifiedName} ${symbol.filePath}`.toLowerCase().includes(query))) included.add(symbol.id);
    if (byId('related').checked) for (const edge of graph.edges) {
      if (included.has(edge.source) || included.has(edge.target)) {
        if (symbols.get(edge.source)?.status === 'unchanged') revealed.add(edge.source);
        if (symbols.get(edge.target)?.status === 'unchanged') revealed.add(edge.target);
      }
    }
    for (const id of revealed) if (symbols.has(id)) included.add(id);
    if (selected?.kind === 'symbol' && symbols.has(selected.id)) included.add(selected.id);
    const roots = new Map();
    for (const id of included) {
      const symbol = symbols.get(id), root = symbols.get(rootFor(symbol));
      if (!roots.has(root.id)) roots.set(root.id, { id: root.id, symbol: root, members: [] });
      if (symbol.id !== root.id) roots.get(root.id).members.push(symbol);
    }
    if (roots.size > 80 && !scope && !query) {
      const rootFiles = new Set([...roots.values()].map(card => card.symbol.filePath));
      cards = graph.files.filter(file => rootFiles.has(file.path)).map(file => ({ id: `file:${file.path}`, file, members: [], height: 144 }));
    } else {
      cards = [...roots.values()];
      for (const card of cards) {
        const allMembers = filteredMembers(card.id);
        if (expanded.has(card.id)) {
          const lastPage = Math.floor(Math.max(0, allMembers.length - 1) / 60) * 60;
          const start = Math.min(memberPages.get(card.id) || 0, lastPage);
          memberPages.set(card.id, start);
          card.members = allMembers.slice(start, start + 60); card.pageStart = start; card.totalMembers = allMembers.length;
        }
        card.members.sort((a, b) => (a.kind === 'field' ? 0 : 1) - (b.kind === 'field' ? 0 : 1) || (a.after?.startLine ?? a.before.startLine) - (b.after?.startLine ?? b.before.startLine));
        card.hiddenMembers = Math.max(0, allMembers.length - card.members.length);
        if (!expanded.has(card.id) && card.members.length > 6) { card.hiddenMembers += card.members.length - 6; card.members = card.members.slice(0, 6); }
        const sections = Number(card.members.some(member => member.kind === 'field')) + Number(card.members.some(member => member.kind !== 'field'));
        card.height = 64 + card.members.length * 28 + sections * 28 + (!card.members.length && !['class', 'interface'].includes(card.symbol.kind) ? 30 : 0) + (card.hiddenMembers || expanded.has(card.id) ? 28 : 0) + (card.totalMembers > 60 ? 28 : 0);
      }
    }
    cardMap = new Map(cards.map(card => [card.id, card]));
    const groupMap = new Map();
    for (const edge of graph.edges) {
      const source = symbols.get(edge.source), target = symbols.get(edge.target);
      const from = cardMap.has(`file:${source.filePath}`) ? `file:${source.filePath}` : rootFor(source);
      const to = cardMap.has(`file:${target.filePath}`) ? `file:${target.filePath}` : rootFor(target);
      if (from === to || !cardMap.has(from) || !cardMap.has(to)) continue;
      const key = `${from}:${to}`;
      if (!groupMap.has(key)) groupMap.set(key, { from, to, kind: edge.kind, edges: [] });
      groupMap.get(key).edges.push(edge);
    }
    groups = [...groupMap.values()];
    cardLayer.dataset.dense = String(groups.length > 24);
    for (const group of groups) group.kind = [...new Set(group.edges.map(edge => edge.kind))].join(' / ');
    layout();
    cardsDirty = true;
    byId('scope-back').hidden = !scope;
    byId('notice').textContent = cards.length ? '' : graph.files.length ? 'No symbols match. Other changes includes unsupported files and edits outside symbols.' : 'This comparison has no changed files.';
    if (fit) fitCamera(initialized ? .15 : .85);
    renderContext(); schedule(); persist();
  }

  function layout() {
    layoutRevision++;
    axesLayout = undefined;
    if (layoutMode === 'axes') {
      axesLayout = GraphLayout.layoutAxes(cards.map(card => ({ id: card.id, filePath: card.symbol?.filePath ?? card.file.path, label: card.symbol?.qualifiedName, status: (card.symbol ?? card.file).status, changes: (card.symbol ?? card.file).changes, height: card.height })), axes);
      for (const card of cards) Object.assign(card, axesLayout.positions.get(card.id));
      return;
    }
    const levels = new Map(cards.map(card => [card.id, 0])), incoming = new Map(cards.map(card => [card.id, 0])), outgoing = new Map();
    for (const group of groups) { incoming.set(group.to, incoming.get(group.to) + 1); const list = outgoing.get(group.from) || []; list.push(group.to); outgoing.set(group.from, list); }
    const queue = cards.filter(card => !incoming.get(card.id)).map(card => card.id);
    for (let index = 0; index < queue.length; index++) for (const to of outgoing.get(queue[index]) || []) {
      levels.set(to, Math.max(levels.get(to), levels.get(queue[index]) + 1)); incoming.set(to, incoming.get(to) - 1); if (!incoming.get(to)) queue.push(to);
    }
    const columns = new Map();
    cards.sort((a, b) => (a.symbol?.filePath ?? a.file.path).localeCompare(b.symbol?.filePath ?? b.file.path) || (a.symbol?.qualifiedName ?? '').localeCompare(b.symbol?.qualifiedName ?? ''));
    for (const card of cards) { const level = levels.get(card.id), column = columns.get(level) || []; column.push(card); columns.set(level, column); }
    let columnOffset = 0;
    for (const level of [...columns.keys()].sort((a, b) => a - b)) {
      const column = columns.get(level); let y = 0;
      column.forEach((card, index) => { if (index && index % 12 === 0) y = 0; card.x = (columnOffset + Math.floor(index / 12)) * 448; card.y = y; y += card.height + 44; });
      columnOffset += Math.ceil(column.length / 12);
    }
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; renderViewport(); }); }
  function renderViewport() {
    positionLayoutOptions();
    viewport.style.setProperty('--graph-axis-inset', `${contentInsets().left}px`);
    world.style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`;
    byId('zoom-level').textContent = `${Math.round(camera.zoom * 100)}%`;
    const left = -camera.x / camera.zoom - 150, top = -camera.y / camera.zoom - 150;
    const right = left + viewport.clientWidth / camera.zoom + 300, bottom = top + viewport.clientHeight / camera.zoom + 300;
    const inViewport = cards.filter(card => card.x < right && card.x + cardWidth > left && card.y < bottom && card.y + card.height > top);
    const visible = inViewport.slice(0, 160);
    const visibleIds = new Set(visible.map(card => card.id));
    const activeElement = document.activeElement, active = activeElement?.dataset;
    const focused = pendingFocus ?? active?.symbol ?? (active?.file ? `file:${active.file}` : undefined), focusedEdge = active?.edge;
    if (cardsDirty) { cardLayer.replaceChildren(); mountedCards.clear(); lastVisibleKey = ''; cardsDirty = false; }
    for (const [id, node] of mountedCards) if (!visibleIds.has(id)) { node.remove(); mountedCards.delete(id); }
    for (const card of visible) if (!mountedCards.has(card.id)) { const node = renderCard(card); mountedCards.set(card.id, node); cardLayer.append(node); }
    for (const [id, node] of mountedCards) {
      const card = cardMap.get(id); node.style.left = `${card.x}px`; node.style.top = `${card.y}px`;
      node.dataset.selected = String(selected?.kind === 'symbol' && rootFor(symbols.get(selected.id)) === id || selected?.kind === 'file' && cardMap.get(id)?.file?.path === selected.id);
      node.querySelectorAll('[data-symbol]').forEach(button => button.setAttribute('aria-pressed', String(selected?.kind === 'symbol' && selected.id === button.dataset.symbol)));
    }
    if (focused) {
      const target = !pendingFocus && activeElement?.isConnected ? activeElement : [...cardLayer.querySelectorAll('[data-symbol]')].find(node => node.dataset.symbol === focused) ?? mountedCards.get(focused)?.querySelector('[data-file]');
      if (target && pendingFocus) {
        const rect = target.getBoundingClientRect(), view = viewport.getBoundingClientRect(), inset = contentInsets();
        if (rect.top < view.top + inset.top || rect.bottom > view.bottom) {
          camera.y += view.top + inset.top + (view.height - inset.top) / 2 - rect.top - rect.height / 2;
          world.style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`;
          schedule(); persist();
        }
        pendingFocus = undefined;
      }
      if (target && document.activeElement !== target) target.focus({ preventScroll: true });
    }
    renderGuides();
    const viewInset = contentInsets();
    const actualVisible = visible.filter(card => camera.x + (card.x + cardWidth) * camera.zoom > viewInset.left && camera.x + card.x * camera.zoom < viewport.clientWidth && camera.y + (card.y + card.height) * camera.zoom > viewInset.top && camera.y + card.y * camera.zoom < viewport.clientHeight);
    const lostView = analysisState === 'ready' && cards.length > 0 && !actualVisible.length;
    const recovery = byId('recover-view'); recovery.hidden = !lostView;
    recovery.textContent = selectionCard() ? 'Show selection' : 'Fit graph';
    recovery.title = selectionCard() ? 'Bring the selected component into view' : 'Bring the graph back into view';
    document.querySelector('footer').dataset.recovery = String(lostView);
    const visibleKey = `${layoutRevision}:${connectionsMode}:${visible.map(card => card.id).join(',')}:${selected?.kind}:${selected?.id}:${axesLayout ? `${camera.x},${camera.y},${camera.zoom},${viewport.clientWidth},${viewport.clientHeight}` : ''}`;
    if (visibleKey !== lastVisibleKey) {
      const inset = contentInsets();
      const connectionIds = axesLayout ? new Set(visible.filter(card => camera.x + (card.x + cardWidth) * camera.zoom > inset.left && camera.x + card.x * camera.zoom < viewport.clientWidth && camera.y + (card.y + card.height) * camera.zoom > inset.top && camera.y + card.y * camera.zoom < viewport.clientHeight).map(card => card.id)) : visibleIds;
      drawEdges(connectionIds); lastVisibleKey = visibleKey;
    }
    if (focusedEdge && document.activeElement?.dataset.edge !== focusedEdge) [...cardLayer.querySelectorAll('[data-edge]')].find(node => node.dataset.edge === focusedEdge)?.focus({ preventScroll: true });
    if (graph && analysisState === 'ready') byId('status').textContent = `${scope || `${graph.files.length} files`} · ${cards.some(card => card.file) ? 'File overview — select a file to explore' : `${cards.length} components`}${inViewport.length > 160 ? ' · Zoom in to see more components' : ''}${connectionSummary}${lostView ? ' · No components in view' : ''}`;
  }
  function contentInsets() { return layoutMode === 'axes' ? { left: viewport.clientWidth < 500 ? 80 : 112, top: 52 } : { left: 0, top: 0 }; }
  function renderGuides() {
    const guides = byId('axis-guides'); guides.hidden = !axesLayout || analysisState !== 'ready';
    if (guides.hidden) return;
    const inset = contentInsets(); guides.style.setProperty('--axis-left', `${inset.left}px`);
    const horizontal = element('div', 'axis-horizontal'), vertical = element('div', 'axis-vertical');
    for (const band of axesLayout.columns) {
      const start = camera.x + band.start * camera.zoom, end = start + band.size * camera.zoom;
      if (end <= inset.left || start >= viewport.clientWidth) continue;
      const label = element('div', 'axis-band-label', band.label); label.title = `${axisNames[axes.horizontal]}: ${band.label}`;
      label.style.left = `${Math.max(inset.left, start)}px`; label.style.width = `${Math.min(end, viewport.clientWidth) - Math.max(inset.left, start)}px`; horizontal.append(label);
    }
    for (const band of axesLayout.rows) {
      const start = camera.y + band.start * camera.zoom, end = start + band.size * camera.zoom;
      if (end <= inset.top || start >= viewport.clientHeight) continue;
      const label = element('div', 'axis-band-label', band.label); label.title = `${axisNames[axes.vertical]}: ${band.label}`;
      label.style.top = `${Math.max(inset.top, start)}px`; label.style.height = `${Math.min(end, viewport.clientHeight) - Math.max(inset.top, start)}px`; vertical.append(label);
    }
    const corner = element('div', 'axis-corner'); corner.append(element('span', '', `→ ${axisNames[axes.horizontal]}`), element('span', '', `↓ ${axisNames[axes.vertical]}`));
    guides.replaceChildren(horizontal, vertical, corner);
  }
  function renderCard(card) {
    const node = element('article', 'node'); node.style.left = `${card.x}px`; node.style.top = `${card.y}px`; node.dataset.card = card.id;
    const item = card.symbol, head = button('', () => card.file ? selectFile(card.file.path) : selectSymbol(item.id, false), 'node-head');
    node.dataset.selected = String(selected?.kind === 'symbol' && rootFor(symbols.get(selected.id)) === card.id || selected?.kind === 'file' && card.file?.path === selected.id);
    if (item) { symbolContext(node, item); head.dataset.symbol = item.id; head.setAttribute('aria-pressed', String(selected?.kind === 'symbol' && selected.id === item.id)); }
    else head.dataset.file = card.file.path;
    head.title = `${item?.qualifiedName ?? card.file.path}\nDouble-click or press Enter to open diff`;
    head.setAttribute('aria-keyshortcuts', 'Enter');
    const main = element('span', 'node-main');
    main.append(symbolIcon(item?.kind || 'file'));
    const title = element('strong', 'node-title', item ? item.parentId && symbols.get(item.parentId)?.filePath !== item.filePath ? item.qualifiedName : item.name : card.file.path.split('/').pop()); title.title = item?.qualifiedName ?? card.file.path;
    const filePath = item?.filePath ?? card.file.path, path = element('span', 'path', filePath); path.title = filePath;
    main.append(title, counts(item?.changes ?? card.file?.changes));
    const meta = element('span', 'node-meta'); meta.append(path, element('span', 'kind', item ? `${item.kind}${item.status === 'unchanged' ? ' · unchanged' : ''}` : 'File'));
    head.append(main, meta);
    const header = element('div', 'node-header'); header.append(head); node.append(header);
    commentAnchor(header, item ? 'symbol' : 'file', item?.id ?? card.file.path, item?.qualifiedName ?? card.file.path);
    if (card.file) node.append(button('Show entities in this file →', () => { scope = card.file.path; revealed.clear(); rebuild(true); pendingFocus = cards.find(card => card.symbol)?.id; }, 'node-foot'));
    else if (!card.members.length && !['class', 'interface'].includes(item.kind)) node.append(memberRow(item, false));
    else for (const fieldGroup of [true, false]) {
      const members = card.members.filter(member => (member.kind === 'field') === fieldGroup); if (!members.length) continue;
      const compartment = element('div', 'compartment'); compartment.append(element('span', 'section-label', fieldGroup ? 'Fields' : 'Methods / functions')); members.forEach(member => compartment.append(memberRow(member))); node.append(compartment);
    }
    if (card.totalMembers > 60) node.append(button(`Members ${card.pageStart + 1}–${Math.min(card.pageStart + 60, card.totalMembers)} of ${card.totalMembers} · next`, () => {
      memberPages.set(card.id, card.pageStart + 60 < card.totalMembers ? card.pageStart + 60 : 0);
      rebuild();
      const updated = cardMap.get(card.id);
      centerCard(updated); pendingFocus = updated.members[0]?.id ?? card.id; persist();
    }, 'node-foot'));
    if (card.hiddenMembers || expanded.has(card.id)) {
      const more = button(expanded.has(card.id) ? 'Collapse members' : `Show ${card.hiddenMembers} more members`, () => {
        expanded.has(card.id) ? expanded.delete(card.id) : expanded.add(card.id);
        rebuild();
        const updated = cardMap.get(card.id);
        centerCard(updated);
        pendingFocus = expanded.has(card.id) ? updated.members.find(member => !card.members.some(previous => previous.id === member.id))?.id ?? card.id : card.id;
        persist();
      }, 'node-foot');
      more.prepend(icon(expanded.has(card.id) ? 'chevron-up' : 'chevron-down')); node.append(more);
    }
    return node;
  }
  function memberRow(symbol, showComments = true) {
    const row = button('', () => selectSymbol(symbol.id, false), 'member'); row.dataset.symbol = symbol.id;
    symbolContext(row, symbol);
    row.setAttribute('aria-pressed', String(selected?.kind === 'symbol' && selected.id === symbol.id)); row.title = `${symbol.qualifiedName}\n${symbol.signature}\nDouble-click or press Enter to open diff`;
    row.setAttribute('aria-keyshortcuts', 'Enter');
    row.append(symbolIcon(symbol.kind), element('code', '', symbol.signature), counts(symbol.changes), element('span', `badge ${symbol.status}`, symbol.status === 'unchanged' ? '' : labels[symbol.status]));
    const container = element('div', 'member-row'); container.append(row); symbolContext(container, symbol);
    if (showComments) commentAnchor(container, 'symbol', symbol.id, symbol.qualifiedName);
    return container;
  }
  function drawEdges(visible) {
    svg.replaceChildren(); cardLayer.querySelectorAll('.edge-label').forEach(node => node.remove());
    const ns = 'http://www.w3.org/2000/svg', defs = document.createElementNS(ns, 'defs'), marker = document.createElementNS(ns, 'marker'), arrow = document.createElementNS(ns, 'path');
    marker.id = 'graph-arrow'; marker.setAttribute('viewBox', '0 0 8 8'); marker.setAttribute('refX', '7'); marker.setAttribute('refY', '4'); marker.setAttribute('markerWidth', '8'); marker.setAttribute('markerHeight', '8'); marker.setAttribute('orient', 'auto');
    arrow.setAttribute('d', 'M1 1 L7 4 L1 7'); arrow.setAttribute('fill', 'none'); arrow.setAttribute('stroke', 'currentColor'); marker.append(arrow); defs.append(marker); svg.append(defs);
    const eligible = connectionsMode === 'selected' ? groups.filter(groupConnected) : groups;
    const inView = eligible.filter(group => visible.has(group.from) && visible.has(group.to)).slice(0, 300);
    connectionSummary = connectionsMode === 'selected' && !selected ? ' · Select a card to show connections' : ` · ${inView.length} of ${eligible.length} connections in view`;
    const routes = axesLayout ? GraphLayout.routeAxesConnections(axesLayout, inView.map(group => ({ id: group.edges[0].id, from: group.from, to: group.to }))) : [];
    const routesById = new Map(routes.map(route => [route.id, route.points]));
    for (const group of inView) {
      const a = cardMap.get(group.from), b = cardMap.get(group.to), forward = b.x > a.x, sameColumn = b.x === a.x;
      const x1 = a.x + (forward || sameColumn ? cardWidth : 0), y1 = a.y + 25, x2 = b.x + (forward ? 0 : cardWidth), y2 = b.y + 25, mid = sameColumn ? x1 + (a.y < b.y ? 42 : 72) : (x1 + x2) / 2;
      const vertical = Math.sign(y2 - y1), first = Math.sign(mid - x1), last = Math.sign(x2 - mid), radius = Math.min(7, Math.abs(y2 - y1) / 2, Math.abs(mid - x1) / 2, Math.abs(x2 - mid) / 2);
      const points = routesById.get(group.edges[0].id);
      const route = points ? points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ') : radius ? `M${x1},${y1} H${mid - first * radius} Q${mid},${y1} ${mid},${y1 + vertical * radius} V${y2 - vertical * radius} Q${mid},${y2} ${mid + last * radius},${y2} H${x2}` : `M${x1},${y1} H${x2}`;
      const edge = document.createElementNS(ns, 'path'); edge.setAttribute('d', route); edge.setAttribute('marker-end', 'url(#graph-arrow)');
      edge.dataset.edge = group.edges[0].id; edge.dataset.from = group.from; edge.dataset.to = group.to;
      edge.setAttribute('class', `graph-edge${groupConnected(group) ? ' active' : ''}`); svg.append(edge);
      const allAdded = group.edges.every(edge => edge.status === 'added'), allDeleted = group.edges.every(edge => edge.status === 'deleted');
      const label = button(`${points && group.kind.includes(' / ') ? 'Links' : group.kind}${group.edges.length > 1 ? ` ×${group.edges.length}` : ''}`, () => selectEdge(group.edges[0].id), 'edge-label');
      label.dataset.edge = group.edges[0].id;
      label.dataset.connected = String(groupConnected(group));
      label.title = `${allAdded ? 'Added · ' : allDeleted ? 'Removed · ' : ''}${group.kind} · ${group.edges.length} resolved links`;
      label.setAttribute('aria-label', `${symbols.get(group.edges[0].source).qualifiedName} ${group.kind} ${symbols.get(group.edges[0].target).qualifiedName}`);
      label.style.left = `${mid}px`; label.style.top = `${y2 - 12}px`; label.setAttribute('aria-pressed', String(group.edges.some(edge => selected?.kind === 'edge' && selected.id === edge.id))); cardLayer.append(label);
      if (points) placeAxisLabel(label, points);
    }
  }
  function groupConnected(group) {
    if (selected?.kind === 'edge') return group.edges.some(edge => edge.id === selected.id);
    const id = selected?.kind === 'symbol' ? rootFor(symbols.get(selected.id)) : selected?.kind === 'file' ? `file:${selected.id}` : undefined;
    return id === group.from || id === group.to;
  }
  function placeAxisLabel(label, points) {
    const halfWidth = label.offsetWidth / 2 + 4, halfHeight = label.offsetHeight / 2 + 4;
    const inset = contentInsets();
    const segments = points.slice(1).map((point, index) => ({ a: points[index], b: point })).sort((a, b) => Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y) - Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y));
    for (const { a, b } of segments) {
      const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
      if (camera.x + (x - halfWidth) * camera.zoom < inset.left || camera.x + (x + halfWidth) * camera.zoom > viewport.clientWidth || camera.y + (y - halfHeight) * camera.zoom < inset.top || camera.y + (y + halfHeight) * camera.zoom > viewport.clientHeight - 50) continue;
      if (cards.some(card => x + halfWidth > card.x && x - halfWidth < card.x + cardWidth && y + halfHeight > card.y && y - halfHeight < card.y + card.height)) continue;
      label.style.left = `${x}px`; label.style.top = `${y}px`; return;
    }
    label.remove();
  }

  function contextTopbar() {
    const node = element('div', 'context-label', 'Details'); node.prepend(icon('info'));
    if (selected) {
      const overview = button('Overview', () => {
        selected = null; pendingFocus = undefined; rebuild(); context.scrollTop = 0;
        const heading = context.querySelector('h2'); if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
      }, 'toolbar-button overview-back');
      overview.prepend(icon('arrow-left')); overview.title = 'Return to the whole saved comparison'; overview.setAttribute('aria-label', 'Review overview'); node.append(overview);
    }
    return node;
  }
  function contextHeading(kind, title) {
    const [type, status] = kind.split(' · '), heading = element('div', 'selection-heading'), typeRow = element('div', 'selection-kind');
    typeRow.append(symbolIcon(type.toLowerCase()), element('span', '', type));
    if (status) typeRow.append(element('span', `state-badge ${status}`, status));
    heading.append(typeRow, element('h2', '', title)); context.replaceChildren(contextTopbar(), heading);
  }
  function metadata(label, content, parent = context) { const row = element('div', 'meta-row'), value = element('div', 'meta-value'); value.append(content); row.append(element('span', 'meta-label', label), value); parent.append(row); }
  function contextSection(title, count) {
    const section = element('details', 'context-section'), summary = element('summary');
    section.open = !closedSections.has(title); summary.append(icon('chevron-right', 'chevron'), element('span', '', title), document.createTextNode(' '), element('span', 'count-badge', String(count)));
    const body = element('div', 'section-body'); section.append(summary, body); context.append(section);
    section.addEventListener('toggle', () => { section.open ? closedSections.delete(title) : closedSections.add(title); persist(); });
    return body;
  }
  function selectSymbol(id, center = true) {
    const symbol = symbols.get(id); if (!symbol) return;
    if (!center) { selected = { kind: 'symbol', id }; renderContext(); schedule(); persist(); return; }
    pendingFocus = id;
    selected = { kind: 'symbol', id }; revealed.add(id); scope = scope && symbol.filePath !== scope ? '' : scope;
    if (symbol.status !== 'unchanged') { statuses.add(symbol.status); document.querySelector(`[data-status="${symbol.status}"]`).checked = true; }
    if (query && !`${symbol.qualifiedName} ${symbol.filePath}`.toLowerCase().includes(query)) { query = ''; byId('search').value = ''; }
    rebuild();
    const card = cardMap.get(rootFor(symbol));
    if (card && !card.members.some(member => member.id === id) && card.id !== id) { expanded.add(card.id); const index = filteredMembers(card.id).findIndex(member => member.id === id); memberPages.set(card.id, Math.max(0, Math.floor(index / 60) * 60)); rebuild(); }
    if (center && cardMap.has(rootFor(symbol))) centerCard(cardMap.get(rootFor(symbol)));
    persist();
  }
  function selectEdge(id) { selected = { kind: 'edge', id }; renderContext(); schedule(); persist(); }
  function selectFile(filePath) { selected = { kind: 'file', id: filePath }; renderContext(); schedule(); setOtherOpen(false); persist(); }
  function renderOverview() {
    const overview = element('div', 'review-overview'), heading = element('div', 'selection-heading');
    heading.append(element('h2', '', 'Review overview'));
    const intro = element('p', 'scope-note', 'Whole saved comparison. Graph filters do not change these totals.');
    const fileCount = element('strong', 'overview-files', `${graph.files.length} changed file${graph.files.length === 1 ? '' : 's'}`); fileCount.id = 'overview-files';
    const statusCounts = element('div', 'overview-statuses'); statusCounts.id = 'overview-statuses';
    for (const [status, name] of [['added', 'added'], ['modified', 'modified'], ['deleted', 'removed']]) {
      const count = graph.files.filter(file => file.status === status).length;
      if (count) statusCounts.append(element('span', status, `${count} ${name}`));
    }
    const totals = { added: 0, removed: 0 };
    for (const file of graph.files) if (file.changes) { totals.added += file.changes.added; totals.removed += file.changes.removed; }
    const unavailable = graph.files.filter(file => !file.changes).length;
    const lines = element('div', 'overview-lines'); lines.id = 'overview-lines';
    lines.append(element('span', 'meta-label', unavailable ? 'Available text line changes' : 'Text line changes'), counts(unavailable === graph.files.length ? null : totals, true));
    overview.append(heading, intro, fileCount, statusCounts, lines);
    if (unavailable) { const note = element('p', 'scope-note', `Line counts unavailable for ${unavailable} file${unavailable === 1 ? '' : 's'}.`); note.id = 'overview-unavailable'; overview.append(note); }
    if (snapshotInfo) {
      const provenance = element('div', 'overview-provenance'); provenance.id = 'overview-provenance';
      for (const [side, label] of [['base', 'Base'], ['target', 'Compare']]) {
        const endpoint = snapshotInfo[side];
        const value = element('span', 'signature', endpoint.kind === 'worktree' ? `Captured working tree · ${endpoint.value}` : `${endpoint.label} · ${endpoint.value.slice(0, 8)}`);
        value.dataset.endpoint = side; value.title = endpoint.value; metadata(label, value, provenance);
      }
      const mode = element('span', '', snapshotInfo.mode === 'merge-base' ? 'Branch changes · since common ancestor' : 'Exact differences'); mode.id = 'overview-mode'; metadata('Show', mode, provenance);
      overview.append(provenance);
    }
    if (capturedAt) {
      const date = new Date(capturedAt), time = element('time', '', date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
      time.id = 'overview-captured'; time.dateTime = capturedAt; time.title = date.toLocaleString(); metadata('Captured', time, overview);
    }
    const largest = graph.files.filter(file => file.changes && file.changes.added + file.changes.removed > 0)
      .sort((a, b) => b.changes.added + b.changes.removed - a.changes.added - a.changes.removed || a.path.localeCompare(b.path, undefined, { numeric: true })).slice(0, 5);
    if (largest.length) {
      const section = element('section', 'overview-largest'); section.id = 'overview-largest';
      section.append(element('h3', 'overview-section-label', 'Largest text changes'));
      const list = element('ul', 'overview-file-list');
      for (const file of largest) {
        const row = element('li', 'overview-file'), content = element('div', 'overview-file-content');
        const name = button('', () => { selectFile(file.path); context.querySelector('.open-diff')?.focus(); }, 'link overview-file-name');
        name.dataset.reviewFile = file.path; name.title = file.path; name.setAttribute('aria-label', `Inspect ${file.path}`);
        name.append(symbolIcon('file'), element('span', 'overview-file-path', file.path));
        const meta = element('div', 'overview-file-meta');
        meta.append(element('span', file.status, { added: 'Added', modified: 'Modified', deleted: 'Removed' }[file.status] || file.status), counts(file.changes));
        content.append(name, meta);
        const open = button('', () => vscode.postMessage({ action: 'open-file', filePath: file.path }), 'relation-action');
        open.append(icon('git-compare')); open.title = 'Open captured file diff'; open.setAttribute('aria-label', `Open diff for ${file.path}`);
        row.append(content, open); list.append(row);
      }
      section.append(list); overview.append(section);
    }
    context.replaceChildren(contextTopbar(), overview);
  }
  function renderContext() {
    if (!selected && graph?.files.length) { renderOverview(); return; }
    if (!selected || !graph) { const empty = element('div', 'context-empty'); empty.append(icon('symbol-class'), element('strong', '', 'Select a symbol'), element('p', '', 'Explore its changes, dependencies and usages.')); context.replaceChildren(contextTopbar(), empty); return; }
    if (selected.kind === 'file') {
      const file = files.get(selected.id); if (!file) return;
      contextHeading('File', file.path.split('/').pop()); metadata('Location', element('span', 'signature', file.path)); metadata('Line changes', counts(file.changes, true));
      if (file.notice) context.append(element('p', 'detail', file.notice));
      context.append(diffActions('Open file diff', 'file', { filePath: file.path }, file.commentable !== false)); renderComments(); return;
    }
    if (selected.kind === 'edge') {
      const edge = graph.edges.find(edge => edge.id === selected.id); if (!edge) return;
      const related = groups.find(group => group.edges.includes(edge))?.edges ?? [edge];
      const kinds = [...new Set(related.map(item => item.kind))].join(' / ');
      contextHeading('Dependency', `${kinds}${related.length > 1 ? ` · ${related.length} links` : ''}`);
      const container = element('div', 'usage-list'); context.append(container);
      let shown = 0;
      const appendUsages = () => { const next = related.slice(shown, shown + 60); shown += next.length; for (const item of next) {
        const usage = item.after ?? item.before;
        container.append(element('h3', '', `${item.kind} · ${item.status}`));
        metadata('Source', symbolLink(symbols.get(item.source), () => selectSymbol(item.source)), container);
        metadata('Target', symbolLink(symbols.get(item.target), () => selectSymbol(item.target)), container);
        metadata('Location', element('span', 'signature', `${usage.filePath}:${usage.line} · ${item.after ? 'after' : 'before'}`), container);
        container.append(diffActions('Open usage in diff', 'usage', { id: item.id }));
      } if (shown < related.length) container.append(button(`Show more usages (${related.length - shown} remaining)`, event => { const start = shown; event.currentTarget.remove(); appendUsages(); container.querySelectorAll('.open-diff')[start]?.focus(); })); };
      appendUsages();
      return;
    }
    const symbol = symbols.get(selected.id); if (!symbol) return;
    contextHeading(`${symbol.kind} · ${symbol.status}`, symbol.name);
    context.append(element('div', 'signature signature-block', symbol.signature));
    if (symbol.qualifiedName !== symbol.name) metadata('Qualified name', element('span', 'signature', symbol.qualifiedName));
    const owner = symbols.get(symbol.parentId); if (owner) metadata('Owner', symbolLink(owner, () => selectSymbol(owner.id)));
    const range = symbol.after ?? symbol.before;
    metadata('Location', button(`${symbol.filePath}:${range.startLine}`, () => vscode.postMessage({ action: 'open-symbol', id: symbol.id }), 'link location'));
    context.append(element('span', 'snapshot-side', `${symbol.after ? 'After' : 'Before'} snapshot`), element('p', 'detail', symbol.detail));
    metadata('Line changes', counts(symbol.changes, true));
    context.append(diffActions('Open diff', 'symbol', { id: symbol.id }));
    renderComments();
    const children = new Set([symbol.id, ...graph.symbols.filter(item => rootFor(item) === symbol.id).map(item => item.id)]);
    relationships('Uses', graph.edges.filter(edge => children.has(edge.source)), 'target');
    relationships('Used by', graph.edges.filter(edge => children.has(edge.target) && !children.has(edge.source)), 'source');
    context.append(element('p', 'scope-note', 'Relationships resolved within this comparison.'));
  }
  function relationships(title, edges, direction) {
    const container = contextSection(title, edges.length);
    if (!edges.length) { container.append(element('span', 'muted', 'None resolved in this comparison')); return; }
    let shown = 0;
    const appendMore = () => { const next = edges.slice(shown, shown + 60); shown += next.length; for (const edge of next) {
      const relation = element('div', 'relation'), target = symbols.get(edge[direction]), content = element('div', 'relation-content');
      const name = button(target.qualifiedName, () => selectSymbol(target.id), 'link symbol-link'); name.title = target.qualifiedName;
      content.append(name, element('span', 'relation-description', `${edge.status === 'unchanged' ? '' : `${edge.status} · `}${edge.kind} · ${target.filePath}`));
      const usage = button('', () => selectEdge(edge.id), 'relation-action'); usage.append(icon('references')); usage.setAttribute('aria-label', `${edge.status === 'unchanged' ? '' : `${edge.status} · `}${edge.kind} · show usage`); usage.title = 'Show usage';
      relation.append(symbolIcon(target.kind), content, usage); container.append(relation);
    } if (shown < edges.length) container.append(button(`Show more (${edges.length - shown} remaining)`, event => { const start = shown; event.currentTarget.remove(); appendMore(); container.querySelectorAll('.symbol-link')[start]?.focus(); })); };
    appendMore();
  }
  function fitCamera(minZoom = .15) {
    if (!cards.length) return;
    const width = Math.max(...cards.map(card => card.x + cardWidth)), height = Math.max(...cards.map(card => card.y + card.height));
    const inset = contentInsets();
    camera.zoom = Math.max(minZoom, Math.min(1, (viewport.clientWidth - inset.left - 48) / width, (viewport.clientHeight - inset.top - 75) / height)); camera.x = inset.left + 24; camera.y = inset.top + 24; schedule(); persist();
  }
  function selectionCard() {
    if (selected?.kind === 'symbol') { const symbol = symbols.get(selected.id); return symbol && (cardMap.get(rootFor(symbol)) ?? cardMap.get(`file:${symbol.filePath}`)); }
    if (selected?.kind === 'file') return cardMap.get(`file:${selected.id}`) ?? cards.find(card => card.symbol?.filePath === selected.id);
  }
  function keepGraphVisible() {
    const visible = cards.some(card => {
      const left = camera.x + card.x * camera.zoom, top = camera.y + card.y * camera.zoom;
      return left < viewport.clientWidth && left + cardWidth * camera.zoom > 0 && top < viewport.clientHeight && top + card.height * camera.zoom > 0;
    });
    if (!visible) fitCamera();
  }
  function centerCard(card) { const inset = contentInsets(); viewport.scrollTo(0, 0); camera.x = inset.left + (viewport.clientWidth - inset.left) / 2 - (card.x + cardWidth / 2) * camera.zoom; camera.y = inset.top + 45 - card.y * camera.zoom; schedule(); }
  function zoom(factor, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) {
    const next = Math.max(.15, Math.min(2, camera.zoom * factor)); camera.x = x - (x - camera.x) * next / camera.zoom; camera.y = y - (y - camera.y) * next / camera.zoom; camera.zoom = next; schedule(); persist();
  }
  function otherChanges() {
    const panel = byId('other'); panel.replaceChildren(element('strong', '', 'Other changes'));
    const other = graph.files.filter(file => file.notice || file.otherChanges?.added || file.otherChanges?.removed);
    let shown = 0;
    const appendMore = () => { const next = other.slice(shown, shown + 60); shown += next.length; for (const file of next) { const action = button('', () => { selectFile(file.path); context.querySelector('.open-diff')?.focus(); }); action.append(element('span', '', file.path), document.createTextNode(' · '), counts(file.otherChanges)); if (file.notice) action.append(element('span', 'path', file.notice)); panel.append(action); } if (shown < other.length) panel.append(button(`Show more files (${other.length - shown} remaining)`, event => { const start = shown; event.currentTarget.remove(); appendMore(); panel.querySelectorAll("button")[start]?.focus(); })); };
    appendMore();
    if (!other.length) panel.append(element('p', 'muted', 'All changed lines are represented by symbols.'));
    byId('other-toggle').replaceChildren(icon('files'), element('span', '', 'Other changes'), element('span', 'count-badge', String(other.length)));
    byId('other-toggle').setAttribute('aria-label', `Other changes (${other.length})`);
  }
  function setOtherOpen(open, restoreFocus = false) {
    byId('other').hidden = !open;
    byId('other-toggle').setAttribute('aria-expanded', String(open));
    if (open) byId('other').querySelector('button')?.focus();
    if (restoreFocus) byId('other-toggle').focus();
  }
  window.addEventListener('message', event => {
    const message = event.data;
    if (message?.type === 'comments') { if (message.reviewId === reviewId) setFeedback(message.feedback); return; }
    if (message?.type !== 'graph') return;
    snapshotInfo = message.snapshot; capturedAt = message.createdAt;
    if (typeof message.reviewId === 'string') reviewId = message.reviewId;
    else if (message.graph) reviewId = message.graph.reviewId;
    setFeedback(message.feedback, false);
    byId('comparison').textContent = message.comparison || '';
    byId('snapshot').textContent = message.createdAt ? `Snapshot ${new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
    byId('snapshot').title = message.createdAt ? new Date(message.createdAt).toLocaleString() : '';
    analysisState = message.error ? 'error' : message.graph ? 'ready' : 'loading';
    if (analysisState !== 'ready') { byId('recover-view').hidden = true; document.querySelector('footer').dataset.recovery = 'false'; }
    byId('notice').tabIndex = analysisState === 'error' ? 0 : -1;
    document.body.setAttribute('aria-busy', String(analysisState === 'loading'));
    byId('retry-analysis').hidden = analysisState !== 'error';
    byId('retry-analysis').disabled = false;
    byId('other-toggle').disabled = analysisState !== 'ready';
    byId('layout-toggle').disabled = analysisState !== 'ready';
    if (analysisState !== 'ready') { setLayoutOpen(false); byId('axis-guides').hidden = true; }
    byId('other-toggle').title = analysisState === 'ready' ? 'Show files and changes outside graph symbols' : analysisState === 'error' ? 'Retry analysis to show other changes' : 'Available after graph analysis completes';
    if (analysisState !== 'ready') setOtherOpen(false);
    world.hidden = analysisState !== 'ready';
    document.querySelector('.camera-controls').hidden = analysisState !== 'ready';
    if (message.error) {
      byId('notice').textContent = `Unable to analyse this saved graph. ${message.error}`; byId('status').textContent = 'Graph analysis failed';
      if (restoreRetryFocus && document.hasFocus() && document.activeElement === document.body) byId('retry-analysis').focus({ preventScroll: true });
      restoreRetryFocus = false;
      persist(); return;
    }
    if (!message.graph) { byId('notice').textContent = 'Analysing captured files…'; byId('status').textContent = 'Analysing captured files…'; persist(); return; }
    restoreRetryFocus = false;
    const previousReviewId = graph?.reviewId ?? saved.reviewId;
    graph = message.graph; symbols = new Map(graph.symbols.map(symbol => [symbol.id, symbol])); files = new Map(graph.files.map(file => [file.path, file])); rootIds.clear(); revealed.clear(); membersByRoot.clear();
    const selectionExists = selected?.kind === 'symbol' ? symbols.has(selected.id)
      : selected?.kind === 'file' ? files.has(selected.id)
      : selected?.kind === 'edge' ? graph.edges.some(edge => edge.id === selected.id) : false;
    if (!selectionExists) { selected = null; pendingFocus = undefined; }
    for (const symbol of graph.symbols) { const id = rootFor(symbol); if (id !== symbol.id) { const members = membersByRoot.get(id) || []; members.push(symbol); membersByRoot.set(id, members); } }
    for (const members of membersByRoot.values()) members.sort((a, b) => (a.kind === 'field' ? 0 : 1) - (b.kind === 'field' ? 0 : 1) || (a.after?.startLine ?? a.before.startLine) - (b.after?.startLine ?? b.before.startLine));
    if (previousReviewId !== graph.reviewId) { selected = null; camera = { x: 24, y: 24, zoom: 1 }; scope = ''; expanded.clear(); }
    otherChanges(); rebuild(!initialized && saved.reviewId !== graph.reviewId); initialized = true;
  });
  byId('search').value = query; byId('related').checked = saved.related !== false;
  function updateLayoutControls() {
    byId('layout-mode').value = layoutMode; byId('axis-options').hidden = layoutMode !== 'axes';
    byId('axis-horizontal').value = axes.horizontal; byId('axis-vertical').value = axes.vertical;
    for (const direction of ['horizontal', 'vertical']) for (const option of byId(`axis-${direction}`).options) option.disabled = option.value === axes[direction === 'horizontal' ? 'vertical' : 'horizontal'];
    byId('axis-summary').hidden = layoutMode !== 'axes';
    byId('axis-summary').textContent = `→ ${axisNames[axes.horizontal]} · ↓ ${axisNames[axes.vertical]}`;
    byId('layout-toggle').title = layoutMode === 'axes' ? `Axes: horizontal ${axisNames[axes.horizontal]}, vertical ${axisNames[axes.vertical]}` : 'Layout: Relationships';
    positionLayoutOptions();
  }
  function positionLayoutOptions() {
    const popup = byId('layout-options'); if (popup.hidden) return;
    const anchor = byId('layout-toggle').getBoundingClientRect();
    popup.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - popup.offsetWidth - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(anchor.bottom + 4, innerHeight - popup.offsetHeight - 8))}px`;
  }
  function setLayoutOpen(open, restoreFocus = false) {
    byId('layout-options').hidden = !open; byId('layout-toggle').setAttribute('aria-expanded', String(open));
    if (open) { positionLayoutOptions(); byId('layout-mode').focus(); }
    if (restoreFocus) byId('layout-toggle').focus();
  }
  function changeLayout() {
    updateLayoutControls(); layout();
    const selectedCard = selectionCard();
    if (selectedCard) centerCard(selectedCard); else fitCamera();
    schedule(); persist();
  }
  updateLayoutControls();
  byId('connections-mode').value = connectionsMode;
  byId('connections-mode').addEventListener('change', event => { connectionsMode = event.target.value; schedule(); persist(); });
  byId('layout-toggle').addEventListener('click', () => setLayoutOpen(byId('layout-options').hidden));
  byId('layout-mode').addEventListener('change', event => { layoutMode = event.target.value; changeLayout(); });
  for (const direction of ['horizontal', 'vertical']) byId(`axis-${direction}`).addEventListener('change', event => { axes[direction] = event.target.value; changeLayout(); });
  byId('swap-axes').addEventListener('click', () => { axes = { horizontal: axes.vertical, vertical: axes.horizontal }; changeLayout(); });
  document.addEventListener('pointerdown', event => { if (!event.target.closest('.layout-control')) setLayoutOpen(false); });
  byId('retry-analysis').addEventListener('click', () => {
    restoreRetryFocus = document.activeElement === byId('retry-analysis');
    byId('retry-analysis').disabled = true;
    analysisState = 'loading';
    document.body.setAttribute('aria-busy', 'true');
    byId('status').textContent = 'Retrying graph analysis…';
    vscode.postMessage({ action: 'retry' });
  });
  function openGraphItem(event) {
    const target = event.target.closest('[data-symbol], [data-file]');
    if (target?.dataset.symbol) vscode.postMessage({ action: 'open-symbol', id: target.dataset.symbol });
    else if (target?.dataset.file) vscode.postMessage({ action: 'open-file', filePath: target.dataset.file });
    return !!target;
  }
  cardLayer.addEventListener('dblclick', openGraphItem);
  cardLayer.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.repeat && openGraphItem(event)) event.preventDefault();
  });
  byId('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { query = byId('search').value.trim().toLowerCase(); selected = null; revealed.clear(); rebuild(true); }, 150); });
  document.querySelectorAll('[data-status]').forEach(input => { input.checked = statuses.has(input.dataset.status); input.addEventListener('change', () => { input.checked ? statuses.add(input.dataset.status) : statuses.delete(input.dataset.status); selected = null; revealed.clear(); rebuild(); keepGraphVisible(); }); });
  byId('related').addEventListener('change', () => { revealed.clear(); rebuild(); keepGraphVisible(); });
  byId('other-toggle').setAttribute('aria-controls', 'other');
  setOtherOpen(false);
  byId('other-toggle').addEventListener('click', () => setOtherOpen(byId('other').hidden));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !byId('layout-options').hidden) { event.preventDefault(); setLayoutOpen(false, true); return; }
    if (event.key === 'Escape' && !byId('other').hidden) { event.preventDefault(); setOtherOpen(false, true); }
  });
  byId('scope-back').addEventListener('click', () => {
    const filePath = scope;
    scope = ''; revealed.clear(); rebuild(true);
    const card = cardMap.get(`file:${filePath}`) ?? cards.find(card => card.symbol?.filePath === filePath) ?? cards[0];
    if (card) { centerCard(card); pendingFocus = card.id; persist(); }
    else byId('search').focus({ preventScroll: true });
  });
  byId('fit').addEventListener('click', () => fitCamera()); byId('zoom-in').addEventListener('click', () => zoom(1.2)); byId('zoom-out').addEventListener('click', () => zoom(1 / 1.2));
  byId('recover-view').addEventListener('click', () => {
    const card = selectionCard();
    if (card) { centerCard(card); pendingFocus = selected?.kind === 'symbol' && (card.id === selected.id || card.members.some(member => member.id === selected.id)) ? selected.id : card.id; persist(); }
    else { fitCamera(); byId('fit').focus({ preventScroll: true }); }
  });
  cardLayer.addEventListener('focusin', event => {
    if (!event.target.matches(':focus-visible')) return;
    const rect = event.target.getBoundingClientRect(), view = viewport.getBoundingClientRect(), inset = contentInsets();
    const x = Math.max(0, view.left + inset.left + (inset.left ? 1 : 0) - rect.left), y = Math.max(0, view.top + inset.top + (inset.top ? 1 : 0) - rect.top);
    if (!x && !y) return;
    camera.x += x; camera.y += y;
    world.style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`;
    schedule(); persist();
  });
  viewport.addEventListener('scroll', () => {
    const x = viewport.scrollLeft, y = viewport.scrollTop;
    if (!x && !y) return;
    camera.x -= x; camera.y -= y;
    world.style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`;
    viewport.scrollTo(0, 0);
    schedule(); persist();
  });
  viewport.addEventListener('wheel', event => { if (event.target.closest('#other,.analysis-message')) return; event.preventDefault(); if (event.ctrlKey || event.metaKey) { const rect = viewport.getBoundingClientRect(); zoom(Math.exp(-event.deltaY * .01), event.clientX - rect.left, event.clientY - rect.top); } else { camera.x -= event.deltaX || (event.shiftKey ? event.deltaY : 0); if (!event.shiftKey) camera.y -= event.deltaY; schedule(); persist(); } }, { passive: false });
  viewport.addEventListener('pointerdown', event => { if (event.button || event.target.closest('button,input,#other,.analysis-message')) return; dragging = { x: event.clientX, y: event.clientY, cameraX: camera.x, cameraY: camera.y }; viewport.setPointerCapture(event.pointerId); });
  viewport.addEventListener('pointermove', event => { if (!dragging) return; camera.x = dragging.cameraX + event.clientX - dragging.x; camera.y = dragging.cameraY + event.clientY - dragging.y; schedule(); });
  viewport.addEventListener('pointerup', () => { dragging = null; persist(); }); viewport.addEventListener('pointercancel', () => { dragging = null; });
  new ResizeObserver(schedule).observe(viewport);
  vscode.postMessage({ action: 'ready' });
})();
