# Agent Diff Review

Review local branches, remote-tracking branches, commits, and linked worktrees inside VS Code. Open a native diff, leave comments on either side, and send a batch of feedback to the coding agent session you are already using.

The first version uses a local bridge and a dependency-free Node.js script. The agent runs the script through its existing shell tool; feedback returns as that tool's output. A bundled skill explains how to connect, wait, acknowledge feedback, and reply. The extension does not need an agent API key.

**Try it**

1. In VS Code, run **Extensions: Install from VSIX…** and select `agent-diff-review-0.6.2.vsix` from this project.
2. Open a trusted Git repository and click the **Agent Diff Review** activity-bar icon. The **Comparison** panel keeps the left and right sources visible above the changed files.
3. Click **Base · left side** or **Compare · right side** to choose a branch, worktree, or revision. Choose **Exact differences** to compare the selected states directly, or **Branch changes** to see changes introduced on the right since the common ancestor. Use **Swap left and right** beside the source controls, then **Compare** or **Apply Comparison** to update the diff. An unapplied selection leaves the shown comparison clearly labelled. Remote branches reflect the last fetch; **Fetch Remote Branches** updates them explicitly.
4. Expand folders in **Changes** and open a changed file. The tree uses your VS Code file icon theme, with A/M/D badges for added, modified, and deleted files. Hover in the comment gutter or select lines and use **Agent Diff Review: Comment on Selected Lines** from the editor context menu. **Add Comment** saves a draft. Removed lines can be commented on in the left pane.
5. Click **Connect an agent…** in Comparison, or run **Agent Diff Review: Connect Agent**. It opens the bundled skill and copies a message to paste into your existing agent session. Ask that agent to follow the skill. Use **… → Select Agent Session** to choose among connected sessions. The selected session appears in Comparison.
6. Use **Send Review** in **Comments** and optionally add an overall instruction. The agent's waiting command receives the comments and captured code. Comments from older snapshots can be sent from their context menu; when several snapshots have drafts, Send Review lets you choose which one to send.

New workspace layouts give Comparison room for its controls. VS Code keeps panel sizes you have already saved; drag the divider below Comparison to resize an existing layout. The activity-bar badge counts open comments, while the Changes heading shows the file count.

**Change graph**

The **Review overview** in Details shows the whole saved comparison: file status totals, exact text-line counts, captured revisions or working-tree folders, comparison mode and capture time. Counts come from files, so class and member changes are counted once. Unavailable counts are identified separately. **Largest text changes** lists up to five files to start with; select a path to inspect its details or use the adjacent diff action. **Overview** returns from a selection without changing filters, axes or the camera.

After applying a comparison, click **Open Change Graph** in the Changes title bar, or run **Agent Diff Review: Open Change Graph**. The graph opens in its own editor tab. Cards show classes, interfaces, functions, methods and fields from TypeScript/JavaScript, Python, C++, Java and C# snapshots. Every card puts the entity name above its repository-relative file path. Added, modified and removed members carry A/M/D badges and `+added −removed` line counts. Class totals count each changed line once, including captured C++ member definitions in other files.

The view follows your VS Code theme, uses native symbol icons and your configured editor font for signatures, and keeps file paths and line counts in consistent positions. Controls share VS Code corner sizes, hover/focus styling and button roles; routine refresh and diff navigation use secondary buttons. Graph cards stay flat, while popovers use the host widget styling. Dense graphs reveal relationship labels on selection, hover or keyboard focus. The Details sidebar groups relationships into collapsible Uses and Used by sections.

Use **Layout → Axes** to group full cards into labelled bands. Each axis can show **Folder**, **File**, **Changed lines**, or **Change type**; **Swap axes** exchanges the dimensions. Changed lines means additions plus removals, with bands for 0, 1–10, 11–50, 51–200, 201+ and unavailable counts. Class totals stay the same when members are expanded or filtered. **Relationships** keeps the original dependency layout. The selected layout and axes are saved with the graph.

In Layout, set **Connections** to **All** or **Selected card**. Selecting a class includes its members’ incoming and outgoing links. Axes route directed links through gaps between cards, with arrowheads at their targets. The footer reports connection groups in view; the Details lists retain the underlying usages, including off-screen connections. **Escape** closes Layout and returns focus to its button.

Hover a component to emphasise its direct incoming and outgoing neighbours, arrows and relationship labels. Unrelated items recede. Hover a member to trace only its own usages, including linked members within the same class. Keyboard focus provides the same preview. Moving away restores the selected connections and leaves Details unchanged; **Selected card** mode also supports these temporary previews.

Select a card or member to see its full signature, owner, exact location, line counts, **Uses**, and **Used by** in the right sidebar. Follow a related symbol to select it in the graph, or select a relationship to inspect its source, target and call/type-reference location. **Open diff** and **Open usage in diff** open the native diff at the captured lines; removed symbols and usages open the original side. Earlier graph tabs stay pinned to their saved review when another comparison becomes current.

Right-click a component or one of its members and choose **Add Comment** to write feedback without leaving the graph. The native VS Code prompt identifies the captured file, lines and diff side. A component comment covers its full range; a member comment covers only that member. These are ordinary diff comments: opening the saved diff shows the same native thread, and existing feedback on that range is reused.

Comment badges show the number of comments and agent replies beside components and subfunctions. Component totals include member feedback, counted once; each member shows its own conversation. Click a badge to read comments, agent replies, locations and review status in **Comments** within graph Details. Updates arrive live without refreshing the comparison or opening a diff. Resolved feedback stays readable, and long conversations load 20 comments at a time. Graphs keep the comments belonging to their saved snapshot when you reload or change comparisons.

Badge icons distinguish open feedback, agent replies ready for review, needs-changes feedback and fully resolved conversations. Hover for the open count and shared review status; the totals still include resolved comments. Each conversation offers **Go to Comment** to open its exact captured diff location and **Mark as Resolved** or **Reopen Comment** to update the shared native thread without leaving the graph. Keyboard focus stays on the matching action when the status changes.

Use **Add Comment** beside a diff action in Details to open VS Code’s native inline comment editor instead. Symbol comments select the captured symbol’s lines; connection comments target the actual usage. File Details starts a comment at line 1, including text files in Other changes. Removed code uses the original side. Binary and omitted previews have no line-comment action. Both entry points save drafts in the existing **Comments** view; use **Send Review** there to send them to your linked agent. Agent replies appear in the same native threads and Comments view, including feedback from earlier graph snapshots.

Double-click a graph card heading or member, or focus it and press **Enter**, to open its diff directly. A single click shows Details; **Space** also selects a focused item. **Escape** dismisses Other changes and returns focus to its button. Opening Other changes focuses its file list. Choosing a file shows Details and focuses **Open file diff**, ready for **Enter**. Expanding a card focuses its first newly revealed member; paging focuses the first member on the next page, and collapsing returns focus to the card heading.

In a saved review diff, the editor title bar offers **Open Previous Changed File** and **Open Next Changed File**. They follow the folders-first, natural file order used by Changes, wrap at either end, and reuse a native preview tab. Navigation stays within that diff's saved snapshot, including earlier snapshots, and focuses the original side for removed files. A brief status message shows the file's position. These actions appear only when the review has multiple files and do not assign default keyboard shortcuts.

Following a related symbol brings its selected member into view and moves keyboard focus to it. Exploring a file from the overview focuses its first symbol. **All files** returns focus to that file or a matching component; with no results, it focuses search. If analysis fails, **Retry analysis** rebuilds the same saved graph in its existing tab while keeping the view settings. **Open Change Graph** also retries an already-open failed comparison in that tab.

In long lists, **Show more** moves focus to the first new file, related symbol or usage action.

Reloading VS Code restores graph tabs with their original saved snapshot, selection, filters and camera position. If the saved review is unavailable, the unusable tab closes with a message explaining how to reopen the graph.

If panning leaves every card off-screen, the footer offers **Show selection**, or **Fit graph** when nothing is selected. Recovery is explicit; reloading keeps the saved camera until you choose to move it.

Drag the background or scroll to pan. Hold **Shift** while scrolling to pan sideways. Ctrl/⌘ + scroll and the zoom buttons change scale. **Fit** frames the visible graph. Search finds symbols and paths, filters select change kinds, and **Context** includes directly connected context from the captured files. Expanded members follow the change filters; narrowing filters keeps the remaining members visible. Large comparisons start with a file overview; expand a file to inspect its entities. Cards outside the viewport are not rendered, and large member/relationship lists load in batches. **Other changes** keeps imports, configuration, unsupported languages, parse notices and omitted files accessible through their file diffs.

Parsing runs in a worker with bounded content and review caches. Parser binaries ship in the extension and require no runtime download. Links reflect syntax that can be resolved within the captured files; the graph does not index unchanged files outside the review, infer runtime dispatch, or guess ambiguous call targets. Line counts measure textual additions and removals, so replacing one line counts once on each side. Analysis is limited to 20,000 symbols per file and 50,000 per comparison; any remaining files/lines stay available in Other changes.

**Reviewing fixes and following up**

The **Comments** view keeps feedback from every snapshot in one place. Drafts, comments waiting for an agent, replies ready to review, items you mark as needing changes, and resolved comments appear in separate groups. Expand a comment to read its agent replies. **Find Review Comment** searches comment text, file names, and replies.

Select a comment to open its saved diff on the original left or modified right lines. Earlier snapshots are labelled so their line numbers remain meaningful. Use the comment's **Review Latest Changes** action to capture the latest saved state and inspect the file again. If the file no longer differs, the current working file opens when available; the original feedback stays in Comments.

Mark a comment **Resolved** once you are satisfied, or **Needs Changes** to keep it in the follow-up queue. Marking Needs Changes tracks your assessment; add a follow-up comment in the diff and send that draft to request more work from the agent. Refreshing or checking the latest code never resolves comments automatically.

**Why a script and skill?**

This is a practical first integration for any harness that can execute a command and read its output. The JSON mailbox protocol owns delivery; the skill is just the workflow adapter. This avoids coupling the review UI to a particular agent's conversation database or terminal controls. A future MCP or harness-specific adapter can use the same protocol.

It does not wake an arbitrary idle session. The agent must run or repeat `wait`; each call waits at most 25 seconds. Feedback repeats until acknowledged, so a tool timeout or extension reload does not silently discard a batch. Connecting creates a mailbox for the calling session rather than discovering private harness session IDs.

**Script usage**

The script ships with the extension and can also be copied together with its skill folder into your harness's skill directory. Resolve the following path relative to this project, or use the installed skill's path:

```sh
node skills/agent-diff-review/scripts/agent-review.mjs connect --cwd /path/to/worktree --label "My session"
node skills/agent-diff-review/scripts/agent-review.mjs wait --connection <returned-connection> --timeout 25
node skills/agent-diff-review/scripts/agent-review.mjs ack --connection <returned-connection> --batch <batch-id>
node skills/agent-diff-review/scripts/agent-review.mjs reply --connection <returned-connection> --comment <comment-id> --message "Updated and tested"
node skills/agent-diff-review/scripts/agent-review.mjs disconnect --connection <returned-connection>
```

Run `help` for all commands. `discover --cwd /path/to/worktree` lists matching windows; use `connect --bridge <bridge-id>` when multiple windows have the same repository open.

The bridge listens only on `127.0.0.1` and requires a token from a private registration file under `~/.agent-diff-review/bridges`. Review data is stored in VS Code's workspace storage, outside the repository. `AGENT_DIFF_REVIEW_REGISTRY` overrides the registration directory for both the extension and script. The extension sends no code to an external service; the linked agent receives the submitted file snapshots and may process them using its configured provider.

**Scope of version 0.1**

- Comparisons use **saved files**. Save editor changes before starting or refreshing a comparison.
- Reviews are immutable. Refresh creates a new review; earlier comments remain in **Comments** with their original code, and earlier file snapshots remain under **Previous reviews**. Comments do not move automatically between versions.
- Worktree comparisons include tracked and non-ignored untracked files. They show final working-file contents, rather than a separate staging-area view. Renames appear as a deletion and an addition.
- An agent must be attached to the target worktree. For a branch/commit target, its worktree HEAD must match the reviewed commit.
- Text previews are limited to 512 KiB per file and 16 MiB per review; submitted batches are limited to 4 MiB. Binary/non-UTF-8 files are listed without line comments. Submodules show commit pointers, not changes inside their working directories.
- One repository is selected per VS Code window: the first Git repository in the workspace. For SSH, WSL, or containers, the workspace extension and script must run on the same host; those environments and Windows have not been validated in this first version. Browser-only VS Code is unsupported.

**Development and verification**

```sh
npm ci
npm test
npm run test:extension
npx playwright install chromium
npm run test:webviews
npm run package
```

`npm test` compiles TypeScript and exercises real temporary Git repositories, persisted reviews, local HTTP authentication, worktree/session isolation, and a separate CLI process. `npm run test:extension` opens an isolated VS Code profile and exercises native diffs, original/modified-side comments, script delivery, agent replies, and thread resolution. It uses the installed macOS VS Code when available; set `VSCODE_EXECUTABLE` to another installation, or let the test runner download VS Code. Tests do not install into your normal VS Code profile.

`npm run test:webviews` runs the actual graph and Comparison HTML, styles and scripts in headless Chromium, with the VS Code messaging API replaced by a test adapter. It covers selection, double-click and keyboard diff requests, popup dismissal, search, snapshot restoration, 10,000-symbol rendering, theme typography, and narrow sidebar layouts. Native integration tests verify the extension side of those diff requests. Set `WEBVIEW_TEST_ARTIFACTS` to an absolute directory to retain screenshots, or `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use a specific Chromium installation. Both runners print their actual runtime versions; browser tests fix the display scale so wheel distances remain consistent on Retina displays.

To develop interactively, run **Run Agent Diff Review** with F5, then open a Git repository in the Extension Development Host. Native editor integration follows Microsoft's [diff command](https://code.visualstudio.com/api/references/commands), [virtual document API](https://code.visualstudio.com/api/extension-guides/virtual-documents), and [comment sample](https://github.com/microsoft/vscode-extension-samples/tree/main/comment-sample).

**License**

Copyright (c) 2026.

Agent Diff Review is licensed under the **GNU Affero General Public License, version 3 only** (`AGPL-3.0-only`). You may redistribute and modify the project's original code under those terms. The complete license, including its warranty disclaimer, is in [LICENSE](LICENSE).

Distributing a covered modified or combined work requires complying with AGPLv3's copyleft and corresponding-source requirements. If you modify the program and let users interact with that version over a network, section 13 requires offering those users its corresponding source code. Using this extension to review a project does not change that project's license.

Third-party dependencies and assets retain their own licenses and notices. Bundled grammar notices are in [resources/graph-parser-notices.txt](resources/graph-parser-notices.txt); packaged parser/runtime notices and Codicons licenses are included under `out/src/parsers/` and `out/codicons/` respectively.

This license change applies to this revision. Copies of earlier revisions released under MIT retain their existing MIT permissions.
