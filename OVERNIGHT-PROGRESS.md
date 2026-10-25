# Overnight app improvements — 22–23 October 2026

Work until 08:00 Europe/London on 23 October, preserving the existing uncommitted graph feature. Do not publish or send external messages. Continue from this checklist, choosing one behavior at a time using Canon TDD.

Current installed and loaded build: **v0.3.18**. Fifteen improvement passes plus picker and native-layout audits are recorded below; automatic picker focus return is explicitly deferred. The current unit suite has **51 passing tests**. Continue with the remaining audit risks at the end; do not repeat completed work without a new reason.


Version bumps must target only `package.json.version`, the lockfile's root `version`, and `packages[""].version`. Never globally replace matching version strings: a dependency may share the app's previous version. Preserve the manifest's existing compact contribution formatting. A prior VSIX was used to recover that formatting only after parsed contents were verified equal except for the app version.

## Baseline

- Existing work: graph implementation, resources, parser build, package changes, README and TEST-SCENARIOS changes were already uncommitted before this request.
- `npm test`: 49 passed after granting localhost access. The restricted run had 45 passes and four `listen EPERM` bridge failures; those were environment restrictions.
- `npm run test:extension`: passed against the installed macOS VS Code in an isolated temporary profile.
- Inspected the running extension sidebar and graph in Quiet Light. Comparison repeats working-tree text, puts Swap next to the unrelated mode control, uses text glyphs rather than Codicons, and the empty Comments view offers a redundant Select Comparison button.

## Scenarios

- [x] A single graph click shows details; double-click opens that symbol's saved diff, including removed members.
- [x] Keyboard users can open a focused graph symbol's diff without tabbing through Details (Enter opens; Space selects).
- [x] Other changes can be dismissed with Escape and its toggle exposes expanded state.
- [x] Comparison controls use consistent VS Code typography, icons, spacing, focus and theme colors at narrow widths.
- [x] Comparison clearly distinguishes unapplied selection, shown snapshot and busy state.
- [x] Sidebar actions and empty states have clear purpose and avoid redundant calls to action.
- [x] Run the full unit, native extension, browser interaction/theme and packaging checks after changes.

## First pass delivered: v0.3.2

- Changed `resources/graph.js` to keep visible symbol/file buttons mounted during selection, which preserves double-click and keyboard focus. Delegated double-click/Enter requests the symbol/file diff. Escape closes Other changes and returns focus; expanded state is exposed to assistive technology.
- Restyled Comparison with bundled Codicons, dropdown theme colors, font-relative secondary text, consistent focus/borders and truncation. Swap now sits with source controls. Working-tree details show the folder name; refs distinguish local/remote branches and revisions.
- Removed repeated comparison/agent summaries above Changes and repeated instructions above populated Comments. Kept empty-comparison guidance. Removed duplicate Graph and Comments shortcuts and the irrelevant Select Comparison button in empty Comments. Send Review appears in Comments when drafts exist. Graph uses the hierarchy icon.
- Promoted the previous temporary browser checks into `scripts/test-webviews.cjs` and added `npm run test:webviews`, pinned Playwright 1.62.1, and documented Chromium installation and screenshot output. Browser 151.0.7922.34 / Playwright Chromium revision 1234 is installed.
- Added regression assertions one scenario at a time. Observed behavioral red for double-click, Enter, missing expanded state, duplicate working-tree label and repeated native tree summary; each passed after implementation. Existing graph coverage also remains green.
- `npm test`: 49/49 pass with localhost access.
- `npm run test:extension`: pass, including native before/after diffs, comments, replies, status changes, older snapshots, graph locations and actual CLI delivery. Logs: `/private/tmp/agent-overnight-native-green.log` and `/private/tmp/agent-overnight-native-visual.log`.
- `WEBVIEW_TEST_ARTIFACTS=/private/tmp/agent-overnight-webviews npm run test:webviews`: pass. Covers single-click safety, removed-member double-click, Enter, file overview double-click, Escape/focus, search, saved selection/camera, 10,000 symbols, bounded DOM, dense labels, untrusted filenames, Comparison dirty/busy states and four theme classes at widths 220/280/360/520px. Screenshots retained in that directory. Browser messaging is a test adapter; native integration separately verifies host behavior.
- `npm run package`: pass, 42-file v0.3.2 VSIX, including parser WASMs, worker and icons, excluding tests/dev dependencies/progress notes. Installed locally with VS Code's CLI.
- Visually inspected the installed v0.3.2 in the user's actual Quiet Light review window. Verified new sidebar colors/icons, clear worktree folder and quieter Changes/Comments. Manually double-clicked `run` in `test/extension/index.ts`; the correct captured native diff opened with its function range selected. Closed that test diff, leaving the graph open.
- `git diff --check` and JavaScript syntax checks pass. Existing user changes remain uncommitted; no commits, publication or external messages were made.

## Native UI caveat for follow-up

The normal VS Code main process starts with another project's extension-development path. The user's Agent Diff Review window uses the installed extension: source compilation alone does not update it. Opening this same repository as another dev window reuses the existing window and may leave a temporary empty window. That empty window was closed. Use a newly packaged/installed version and reload the intended window for live visual checks; isolated native tests load the current source independently. The v0.3.18 update is already installed and loaded, so do not repeat installation unless code changes justify another build. The CUA `app` binding survived the latest heartbeat and was reused successfully. Reuse it when valid; initialize with `cua.getApp` after an actual runtime reset. At the start of a heartbeat call `app.getAXState` before sending input, so native computer-use activation is refreshed. Avoid printing the entire graph accessibility tree when a filtered state read is sufficient. **Graph tabs now restore automatically on reload**; do not manually reopen them as a workaround. The transition from pre-0.3.5 needed one final manual reopen because older versions had no serializer.

## Follow-up audit

Seventeenth-pass audit (06:42 London):

- [x] Inspect the installed Comparison/sidebar at narrower native widths using verified resize controls (approximately 240px and 180px; Quiet Light, Dark Modern and Dark High Contrast inspected).
- [x] Restore the original sidebar width, theme and saved review after the visual check (original separator position, Quiet Light, snapshot 22:36, 17 files / 62 components, no selection and 85% verified).

Sixteenth-pass audit (06:12 London):

- [x] Cancelling Base, Compare and an edited custom Git ref preserves the selected sources and original captured snapshot (native checks).
- [x] Clicking back into the already-active graph while a picker is open leaves keyboard focus on the chosen graph control (stable v0.3.18 native check).
- [x] Evaluate automatic picker focus return, check different-tab and disposal boundaries, reject its same-graph pointer focus theft, and restore the verified stable application assets.
- [ ] **Deferred:** automatic return to Comparison after Escape. The supported QuickInput API does not expose the hide reason, so the prototype could not distinguish Escape from deliberately clicking another control in the same active editor. Keep native behavior; do not reintroduce unconditional focus restoration or add global Escape bindings as part of this polish scope.

Fifteenth-pass scenarios (05:42 London):

- [x] Run the existing native workflow suite against minimum-supported VS Code 1.94.0 in an isolated temporary profile, without replacing the installed app (passed on Node 20.16.0 / Electron 30.5.1 / Chromium 124.0.6367.243).
- [x] Run the real-resource webview regression suite in Chromium 124 as an older renderer compatibility check (all groups pass; separate browser boundary).
- [x] Long analysis-error details are keyboard reachable and scrollable on Chromium 124 as well as current Chromium (existing regression exposed a genuine older-renderer failure; explicit error-only focus fixed it).
- [x] Run all compiled unit tests using the minimum VS Code build's actual Node 20.16.0 runtime, including parser WASMs and worker recovery (51/51 pass).
- [x] Extract the delivered VSIX outside the repository and parse all six supported languages plus TSX through its bundled worker on Node 20, without development dependencies (25 expected symbols and no parser notices).

Fourteenth-pass scenarios (05:12 London):

- [x] Shift+Tab back through a tall expanded card keeps the focused heading visible and the viewport scroll origin at zero (invisible heading reproduced and fixed).
- [x] Backward navigation within a card clipped on the left reveals its focused heading (invisible focus reproduced and fixed).
- [x] Redrawing a graph preserves the exact focused control when heading and signature share a symbol ID (signature-to-heading focus jump reproduced and fixed).
- [x] Clicking and double-clicking a partly visible card still selects and opens the intended diff (real pointer characterization passed; camera stays unchanged).

Thirteenth-pass scenarios (04:41 London):

- [x] Other changes is interactive only when graph data is available, including recovery after failure (premature availability reproduced and fixed).
- [x] A failed inline Retry analysis returns keyboard focus to Retry (focus loss reproduced and fixed).
- [x] Retry completion preserves focus when the user has moved to another control (real DOM characterization passed).
- [x] Keyboard focus on primary graph actions remains visible when the focus color matches the button fill (invisible inset focus reproduced and fixed with an exterior ring).


Twelfth-pass scenarios (04:11 London):

- [x] A real worker stopping with analysis pending rejects that request and permits a fresh analysis of the same captured review (existing behaviour covered using an actual Node worker termination).
- [x] Closing and reopening a graph before analysis settles leaves the replacement panel usable (existing behaviour covered with controlled analysis and real native panels).
- [x] Reopening a failed graph retries in its existing panel so its view state is retained (native panel replacement reproduced and fixed).


Eleventh-pass scenarios (03:41 London):

- [x] Shift plus vertical wheel pans horizontally without changing vertical position or scale (wrong-axis pan reproduced and fixed).
- [x] Ctrl plus wheel zooms around the world point beneath the cursor (existing behaviour covered through the rendered CSS transform).
- [x] Command plus wheel uses the same anchored zoom behaviour (existing behaviour covered through rendered transforms at a different cursor point).


Tenth-pass scenarios (03:11 London):

- [x] Show more files in Other changes focuses the first newly revealed file and keeps a panned graph stable (focus loss reproduced and fixed).
- [x] Show more relationships focuses the first newly revealed related symbol (focus loss reproduced and fixed).
- [x] Show more usages focuses the first newly revealed usage action, ready for Enter (focus loss reproduced and fixed).


Ninth-pass scenarios (02:41 London):

- [x] Opening Other changes focuses its first file so keyboard users can choose it immediately (focus omission reproduced and fixed).
- [x] Selecting a file in Other changes moves keyboard focus to Open file diff without opening it automatically (focus loss reproduced and fixed).
- [x] A keyboard comparison returns focus to its action when the update finishes (focus loss reproduced and fixed).
- [x] Finishing a comparison respects a controlled inactive-host focus flag; actual tab blur could not be reproduced because of runner focus emulation.
- [x] Finishing a comparison preserves focus already moved to another enabled control (real DOM characterization passed without a production change).


Eighth-pass scenarios (02:11 London):

- [x] Narrowing filters after panning deep through an expanded card leaves the remaining content visible (empty viewport reproduced and fixed).
- [x] Turning off Context while panned to an unchanged neighbour leaves changed components visible (empty viewport reproduced and fixed).
- [x] Comparison controls remain readable and reachable with larger UI text at a narrow width (Show height reproduced and fixed).
- [x] Opening a file overview puts keyboard focus on its first symbol (focus loss reproduced and fixed).
- [x] Returning to All files restores focus to that file (focus loss reproduced and fixed).
- [x] Returning to filtered All files focuses a matching component when no file overview is shown (focus loss reproduced and fixed).
- [x] Returning to empty All files focuses search without clearing the query (focus loss reproduced and fixed).


Seventh-pass scenarios (01:41 London):

- [x] Expanding a graph card moves keyboard focus to its first newly revealed member (focus loss reproduced and fixed).
- [x] Collapsing a graph card returns keyboard focus to its heading (focus loss reproduced and fixed).
- [x] Paging members moves focus to the beginning of the new page (focus loss reproduced and fixed).
- [x] Inspected installed Comparison/graph in Dark Modern and Dark High Contrast; restored Quiet Light.


Sixth-pass scenarios (01:11 London):

- [x] A restored selection whose symbol no longer exists cannot crash the graph; valid camera state survives (undefined-symbol crash reproduced and fixed).
- [x] Tab navigation to off-screen graph items keeps the camera state consistent with the visible view (427px hidden-scroll drift reproduced and fixed).
- [x] Long error details can be focused and scrolled with the keyboard while Retry remains reachable (existing Chromium behaviour covered).

Fifth-pass scenarios (00:41 London):

- [x] A graph analysis error has a truthful status and a clear Retry analysis action (stuck Preparing status reproduced and fixed).
- [x] Retrying rebuilds the same saved graph in the same panel, preserves view settings and avoids concurrent duplicate analysis (native panel and browser recovery checks pass).
- [x] A worker-reported failure does not poison a later retry of that review (existing worker/cache behaviour covered with a forced invalid-path error followed by a valid fixture).
- [x] Following a relationship to a filtered/paged member reveals the right member and supports keyboard opening (off-screen member regression reproduced and fixed).
- [x] A restored tab with a valid saved review stays open for Retry if analysis fails (premature tab disposal reproduced and fixed).
- [x] Long analysis errors keep Retry visible in a short graph pane (long-message clipping reproduced and fixed).

Fourth-pass scenarios (00:11 London):

- [x] Restore a graph tab from its original saved review without changing the active comparison (native panel regression reproduced and fixed).
- [x] Close an un-restorable graph cleanly with an actionable explanation (missing saved snapshot regression reproduced and fixed).
- [x] Persist graph identity while analysis is loading, so reload restoration has a saved review to resolve (missing identity reproduced and fixed).
- [x] Preserve selection and camera across repeated publication of the same graph (selection reset reproduced and fixed).
- [x] Verify actual installed-window reload restores the graph and its view state (search, selected symbol, filter and 120% zoom all returned automatically).

Third-pass scenarios (23:41 London):

- [x] Short, narrow graph editors keep Details and its diff action inside the visible workspace (600×380 clipping reproduced and fixed).
- [x] All change filters remain visible in a 220px graph editor (clipping reproduced and fixed by wrapping the filter group).
- [x] Long source/agent labels stay readable and contained in a narrow Comparison panel (existing behaviour covered).
- [x] A failed comparison preserves the current snapshot and releases the busy state for retry (existing behaviour covered with a real missing Git ref).
- [x] A failed send preserves drafts and releases the send guard so a valid retry succeeds (existing behaviour covered with an unavailable test session followed by real CLI delivery).

Second-pass scenarios (23:11 London):

- [x] Expanded class cards still obey the Added/Modified/Removed filters (Removed regression reproduced and fixed).
- [x] Filtering a paginated class keeps a non-empty valid page visible.
- [x] Selecting a graph relationship preserves keyboard focus on its label.
- [x] Context includes direct neighbours without accumulating unrelated symbols across toggles (existing behaviour covered).
- [x] Clearing graph search returns to the expected view without leaving stale results or focus (native Escape behaviour covered).
- [x] An empty comparison clears previous graph cards and Details and explains the empty state (existing behaviour covered).

## Second pass delivered: v0.3.3 (23:20 London)

- Reproduced and fixed three real browser regressions, one at a time: an expanded card showing a removed member with Removed unchecked (`1` instead of `0`), filtering a later member page leaving it empty (`0` instead of `8` remaining modified members), and Space-selecting a relationship dropping focus to the page (`null` instead of the relationship's accessible label).
- Expanded lists now obey change filters. Member counts, paging and navigation use the same filtered list; narrowing the list clamps to its last valid page. Relationship selection keeps symbol cards mounted and restores focus to the selected relationship after its connectors redraw.
- Added passing coverage for direct Context neighbours and toggling, Escape clearing a no-match search without losing search focus, and empty comparisons clearing old cards and Details. These behaviours already worked; no production changes were needed for them.
- `npm test`: 49/49 pass. `npm run test:webviews`: all groups pass, including the previous theme/width/10,000-symbol checks and new filtering/focus cases. Screenshots refreshed at `/private/tmp/agent-overnight-webviews`.
- `npm run test:extension`: passed, log `/private/tmp/agent-overnight-033-native.log`. JavaScript syntax checks and `git diff --check` passed.
- `npm run package`: produced 42-file v0.3.3 VSIX. Installed locally, reloaded the intended review window and reopened its saved graph. Installed graph JavaScript matches the tested source; the packaged worker parses a smoke fixture without development dependencies.
- No commits, publishing or external messages. Existing user work remains intact.

## Third pass delivered: v0.3.4

- Reproduced two layout bugs in real Chromium before changing styles: at 600×380 the graph's fixed minimum row heights pushed Details below the footer; at 220px wide the unwrapped filter group clipped Removed and widened the toolbar beyond the editor.
- Fixed both with two focused CSS changes: stacked canvas/Details rows can shrink with the editor, and change filters can wrap. Browser tests verify Details bounds and a real diff-button click at 600×380, an unobscured diff action at 320×320, and visible filter labels at 220px. Before/after layouts were inspected in retained screenshots `graph-narrow-short.png` and `graph-narrow-toolbar.png` under `/private/tmp/agent-overnight-webviews`.
- Long branch refs, long agent names and long unapplied comparison labels fit a 220px Comparison panel. The full branch ref remains available as a tooltip, and the agent action is reachable after wrapping. Existing behaviour needed no production change.
- Added native recovery coverage: a real missing Git ref preserves the active snapshot, creates no partial review, releases busy state, and allows the next selection action; an unavailable agent session leaves both drafts intact with no batch, then a valid retry delivers to the actual local CLI test process. These behaviours already worked; no production changes were needed.
- `npm test`: 49/49 pass. `npm run test:webviews`: all groups pass. `npm run test:extension`: pass with both new recovery scenarios, log `/private/tmp/agent-overnight-034-native.log`. JavaScript syntax and `git diff --check` pass.
- Packaged and installed v0.3.4, reloaded the intended user window and reopened its saved graph. Installed graph CSS/JavaScript match the tested source. No commits, publication, external messages or changes to the user's theme preferences.

## Fourth pass delivered: v0.3.5

- Added VS Code's webview panel serializer and matching activation event. A restored panel is rebuilt from its original saved review, with scripts/resources and graph messages reattached. It does not select another comparison or capture current files in place of its snapshot.
- Native regression was red with an empty restoration stub, then passed with a real webview panel restoring an earlier review and opening the exact original-side symbol. A missing-review restoration rejected with `Review not found` before the graceful-close fix; it now closes the unusable tab, logs the cause and shows a concise recovery instruction.
- Loading-state identity was red (`undefined` instead of the saved review ID), then fixed by publishing/persisting the review ID before analysis completes. Repeated publication was red (selection reset to `null`), then fixed by comparing the incoming graph with the currently loaded review. Browser coverage verifies selection and camera stay intact.
- `npm test`: 49/49 pass, log `/private/tmp/agent-overnight-035-unit.log`. `npm run test:webviews`: all groups pass, log `/private/tmp/agent-overnight-035-webviews.log`. `npm run test:extension`: full suite passed with valid/missing restoration, log `/private/tmp/agent-overnight-035-native.log`. Syntax checks and `git diff --check` pass.
- Packaged/installed v0.3.5 (42 files), then verified the feature end to end in the actual user window: searched `run`, disabled Removed, selected `run` in `test/extension/index.ts`, zoomed to 120%, and ran Developer: Reload Window. The graph tab returned automatically on snapshot 22:36 with search `run`, Removed unchecked, selected `run` and 120% zoom. No manual Open Graph was used for that verification.
- After testing, explicitly closed that temporary test view and reopened the full graph, leaving the user's original 17-file / 62-component snapshot unfiltered at the original 85% initial zoom. Installed graph JavaScript, extension code, graph provider and serializer activation metadata match the verified build.
- No commits, publication, external messages or user preference changes.

## Fifth pass delivered: v0.3.6

- Reproduced and fixed a misleading graph error footer that remained on Preparing comparison. Errors now show a clear failure status and an inline Retry analysis action; loading is exposed with aria-busy, and graph camera controls stay hidden until usable.
- Retry analyses the same captured review in the existing panel, coalesces concurrent requests, and keeps search/filter/selection/camera state. A native panel test with a controlled analysis provider was red at one attempt instead of the expected initial failure plus one retry, then passed. This test proves host coordination; real worker behaviour is covered separately.
- Added a real worker/cache regression: a deliberately invalid path triggers a worker-reported error, then a valid fixture under that review ID succeeds. It already passed without production changes and increases the unit count from 49 to 50. It is not a claim that malformed captured data repairs itself.
- Fixed restored tabs closing on analysis failure even when the saved review exists. The native test forces a real worker error with malformed captured content; the tab now remains available for Retry. Missing reviews still close cleanly as in v0.3.5.
- Reproduced and fixed relationship navigation leaving a selected late-page member below the viewport. Navigation now pans to the actual row and transfers keyboard focus. The browser fixture hides 60 deleted members in a 140-member class, follows method119 to page 61–120, verifies its visible bounds/focus, then opens it with Enter.
- Reproduced and fixed long errors pushing Retry outside a 320×320 graph pane. Error details scroll independently while Retry stays visible; error text can be selected without dragging the graph. Inspected `/private/tmp/agent-overnight-webviews/graph-analysis-error.png`.
- `npm test`: 50/50 pass, log `/private/tmp/agent-overnight-036-unit.log`. `npm run test:webviews`: all groups pass, log `/private/tmp/agent-overnight-036-webviews.log`. `npm run test:extension`: full suite passes, including restored failures and retry coordination, log `/private/tmp/agent-overnight-036-native.log`. Syntax and diff whitespace checks pass.
- Packaged/installed v0.3.6, reloaded the user window and verified its original 17-file / 62-component snapshot returned automatically at 85% zoom. Installed styles, graph script and host code match the verified build. No commits, publication, external messages or user preference changes.

## Sixth pass delivered: v0.3.7 (01:29 London)

- Reproduced a restored stale symbol ID crashing `renderViewport` with an undefined-symbol exception. Incoming graph data now checks saved symbol/file/edge selection IDs and clears only an obsolete selection; valid camera state survives.
- Reproduced Tab navigation creating 427px of native viewport scrolling while saved camera state remained unchanged. Native focus scrolling is now folded into the graph camera and persisted, leaving the viewport scroll origin at zero.
- The full regression caught the new camera behaviour leaving a shorter member page below the viewport. Member paging and expand/collapse now reanchor the updated card and clear queued native focus scrolling. Existing filtered paging remains green; a new check verifies a tall card's heading is visible after collapse.
- Keyboard access to long error details already works in Chromium 151. Added passing coverage for Shift+Tab from Retry to the scrollable details, PageDown, Tab back to Retry, and unchanged graph camera. No production change was needed for that scenario.
- `npm test`: 50/50 pass (`/private/tmp/agent-overnight-037-unit.log`). `npm run test:webviews`: all groups pass (`/private/tmp/agent-overnight-037-webviews.log`), including earlier four-theme, 220–520px sidebar, 10,000-symbol and failure recovery coverage. `npm run test:extension`: passes (`/private/tmp/agent-overnight-037-native.log`). JavaScript syntax and `git diff --check` pass.
- Packaged/installed v0.3.7 (42 files), reloaded the actual user window and inspected its Quiet Light sidebar/graph. Original snapshot 22:36, 17 files / 62 components and 85% zoom returned automatically. Installed graph script/styles and host code match the tested build.
- No commits, publication, external messages or user preference changes.

## Seventh pass delivered: v0.3.8 (01:49 London)

- Reproduced three keyboard focus losses separately: expanding, collapsing and paging member cards each left `document.activeElement` without a symbol ID. Expansion now focuses the first newly revealed member, collapse the card heading, and paging the first member of the new page. Tab continues through the new page. Focus uses the existing pending-focus path, so the focused row stays visible without changing selection or opening a diff.
- Baseline browser suite passed (`/private/tmp/agent-overnight-038-browser-baseline.log`). Expansion red/green logs: `...038-expand-keyboard-red.log` / `...038-expand-green.log`; collapse red/green: `...038-collapse-red.log` / `...038-collapse-green.log`; paging red/green: `...038-page-red.log` / `...038-page-green.log`, all under `/private/tmp/agent-overnight-`. Each green run includes the complete previous browser regression suite.
- `npm test`: 50/50 pass (`/private/tmp/agent-overnight-038-unit.log`). `npm run test:extension`: full native suite passes (`/private/tmp/agent-overnight-038-native.log`). JavaScript syntax and `git diff --check` pass.
- Inspected the actual installed sidebar and graph in Dark Modern and Dark High Contrast. Source controls, Show menu, Refresh, Connect, graph filters, borders and Details adopted their native theme colors; no new clipping or unreadable labels observed at the existing sidebar width. Restored the original Quiet Light theme. Narrow 220–520px layouts remain covered by browser checks; this is not a claim of native inspection at every width/theme combination.
- Packaged/installed v0.3.8 (42 files), reloaded the actual user window and verified original snapshot 22:36, 17 files / 62 components, no selected symbol and 85% zoom returned automatically. Installed graph script/styles and host code match the tested build.
- No commits, publication or external messages. The user's graph work and settings are preserved; theme changes were temporary and restored.

## Eighth pass delivered: v0.3.9 (02:28 London)

- Reproduced two filter visibility bugs separately. Deeply panning a 60-row card then hiding Removed left zero rendered members rather than the eight remaining modified members. Panning horizontally to an unchanged neighbour then disabling Context also left the changed component off-screen. Filter changes now fit the graph only when all remaining cards are outside the viewport. Passing coverage verifies a still-visible camera is preserved. Valid reds: `/private/tmp/agent-overnight-039-filter-red.log` and `...039-context-horizontal-red.log`; each fix passed the full browser suite before the next scenario.
- Reproduced a narrow-sidebar larger-text sizing issue: Show had 20px of content height for 23px-high text at a 20px UI font. The select now uses a minimum height rather than a fixed height, preserving the normal size while allowing larger text. The initial computed-line-height assertion was a setup problem (`normal` became NaN); it was corrected before implementation. The valid red is `...039-text-natural-red.log`. Inspected before `/private/tmp/agent-overnight-039-text-before/comparison-large-text.png` and after `/private/tmp/agent-overnight-webviews/comparison-large-text.png`. Selecting Show and clicking Apply still work at 220px with larger text and long labels.
- Reproduced/fixed four file-navigation focus losses, one at a time. Exploring a file focuses its first symbol. Returning to All files focuses its original file card, a matching component when search prevents the file overview, or search when no results remain. The query is preserved and Escape still clears it. Focus uses symbol IDs or the existing `file:` card IDs, and returns the chosen card to view. Valid red logs: `...039-file-enter-red.log`, `...039-file-back-red.log`, `...039-file-filtered-red.log` and `...039-file-empty-red.log`.
- `npm test`: 50/50 pass (`/private/tmp/agent-overnight-039-unit.log`). `npm run test:webviews`: all groups pass (`/private/tmp/agent-overnight-039-webviews.log`). `npm run test:extension`: full native suite passes (`/private/tmp/agent-overnight-039-native.log`). Syntax and `git diff --check` pass. The 10,000-symbol navigation group takes about 1,013ms including multiple round trips and search debounce waits; this is broader coverage than the earlier single-expansion timing, not a comparable parser benchmark.
- Packaged/installed v0.3.9 (42 files), reloaded the user window and verified snapshot 22:36, 17 files / 62 components and 85% zoom returned automatically. Installed graph/Comparison styles, graph script and host code match the tested build. Original Quiet Light and unfiltered graph view remain in place.
- No commits, publication, external messages or lasting user preference changes. Existing user work remains uncommitted and preserved.

## Ninth pass delivered: v0.3.10 (03:00 London)

- Reproduced opening Other changes leaving focus outside its files, then fixed it to focus the first file. Existing Escape dismissal still returns to the toggle. Red/green logs: `/private/tmp/agent-overnight-040-other-open-red.log` / `...040-other-open-green.log`.
- Reproduced selecting an Other changes file closing the panel and losing focus. Its selection action now focuses Open file diff in Details. A browser test verifies Space selects without opening a diff, then Enter opens the correct untrusted-looking filename safely. Red/green: `...040-other-select-red.log` / `...040-other-select-green.log`.
- Reproduced keyboard Compare losing focus when its button was disabled and re-enabled (`...040-compare-focus-red.log`). The action records whether it had focus and restores it after completion only when enabled, the document is active and focus has not moved to another control. A real DOM characterization confirms another focused control is preserved without further implementation changes.
- Added the inactive-host guard with a controlled `document.hasFocus() === false` fixture; valid red: `...040-inactive-flag-red.log`. Actual background-tab attempts were setup failures/limitations, not behavioural reds: Playwright's owned-context restriction first needed an explicit context, and all tabs still appeared focused because of its emulation, including after a secondary CDP override attempt. Removed that unsupported setup. This guard test proves the application decision for an inactive focus flag; real native background-window switching remains unvalidated.
- `npm test`: 50/50 pass (`/private/tmp/agent-overnight-0310-unit.log`). `npm run test:webviews`: all groups pass (`/private/tmp/agent-overnight-0310-webviews.log`). `npm run test:extension`: full suite passes (`/private/tmp/agent-overnight-0310-native.log`) against installed macOS VS Code **1.142.0**. Syntax and whitespace checks pass.
- Packaged/installed v0.3.10 (42 files), reloaded the actual user window and completed the Other changes keyboard journey: first README file focused on opening, Space selected it and focused Open file diff, Enter opened the captured native README diff. Closed that test diff and explicitly closed/reopened the full graph to remove its test selection. Original snapshot 22:36, 17 files / 62 components, no selected symbol and 85% zoom returned. Installed graph/Comparison scripts/styles and host code match the tested build.
- Native layout remained unchanged. An exploratory command search found a generic Current View size command, not an unambiguous Primary Sidebar resize command; it was not executed. Browser 220–520px width coverage remains the narrow-layout evidence. Original Quiet Light is still in place.
- No commits, publication, external messages or lasting preference changes. User changes remain preserved.

## Tenth pass delivered: v0.3.11 (03:32 London)

- Reproduced/fixed focus dropping to the page when each of three Show more actions removed its own button. File expansion now focuses the first new file; relationship expansion the first new symbol link; usage expansion the first new Open usage in diff action. Each newly focused item is asserted visible in its own scroll pane. No new abstraction or backend behaviour was added.
- Baseline passed (`/private/tmp/agent-overnight-0311-baseline.log`). Separate valid red/green logs are `...0311-files-red.log` / `...0311-files-green.log`, `...0311-relationships-red.log` / `...0311-relationships-green.log`, and `...0311-usages-red.log` / final `...0311-webviews.log`. Each green includes all earlier relevant browser regressions.
- File coverage uses seventy JSON files plus an actual symbol card; a wheel pan precedes opening the popup, and opening/paging preserve the camera. Relationship coverage resolves seventy distinct targets. Usage coverage uses seventy methods calling one target so their distinct edges group into one relationship (repeated calls from one source would be deduplicated by the existing parser contract). It verifies expansion creates no diff message and Enter opens exactly the 61st edge.
- `npm test`: 50/50 pass (`/private/tmp/agent-overnight-0311-unit.log`). `npm run test:webviews`: all groups pass (`/private/tmp/agent-overnight-0311-webviews.log`). `npm run test:extension`: full native suite passes (`/private/tmp/agent-overnight-0311-native.log`) in macOS VS Code 1.142.0. Syntax and whitespace checks pass. New long-list DOM focus behaviour is browser-verified, not manually exercised against a 70-entry native saved review.
- Caught and corrected an error in the previous version bump: global replacement had changed the development dependency `node_modules/@typespec/ts-http-runtime` metadata to 0.3.10 while its URL, installed manifest and HEAD all remained 0.3.9. A registry-lock consistency assertion failed for exactly that entry, then passed for all **207** registry package records after restoring 0.3.9. Version 0.3.11 was set with field-specific metadata updates. A temporary manifest reformat was reverted from the previous VSIX only after semantic equality except version was verified, preserving the user's contribution formatting/content. The corrected lock entry is the only dependency correction; no dependency upgrade was performed.
- Repackaged/installed the corrected v0.3.11 (42 files), reloaded the actual user window and verified snapshot 22:36, 17 files / 62 components, no selection and 85% zoom returned. Installed scripts/styles and host assets match the tested source. Original Quiet Light and sidebar layout remain unchanged.
- No commits, publication, external messages or lasting preference changes. User work remains preserved.

## Eleventh pass delivered: v0.3.12 (03:58 London)

- Reproduced Shift plus a vertical mouse wheel moving the graph vertically instead of horizontally. The browser fixture confirmed a real Shift wheel event; camera x stayed -76 rather than the expected -196. Shift now pans horizontally, preserving y and scale; existing horizontal wheel deltas take precedence. Ctrl/Command zoom retains its existing priority over panning.
- Added passing characterization checks for Ctrl-wheel zoom in and Command-wheel zoom out at separate cursor positions. Both already worked. The checks use the actual computed world transform and assert the same world point stays under the cursor on both axes within 0.01 CSS px. No zoom implementation changes were needed.
- Documented Shift panning in README and the graph footer. Inspected `/private/tmp/agent-overnight-webviews/graph.png`: the expanded desktop hint fits; existing narrow-layout tests still pass and continue hiding the hint at narrow widths.
- Baseline: `/private/tmp/agent-overnight-0312-baseline.log`. Valid Shift red/green: `...0312-shift-red.log` / `...0312-shift-green.log`. Ctrl characterization: `...0312-control-check.log`. Final full browser pass with Command: `...0312-webviews.log`.
- `npm test`: 50/50 pass (`/private/tmp/agent-overnight-0312-unit.log`). `npm run test:webviews`: all groups pass. `npm run test:extension`: full suite passes (`/private/tmp/agent-overnight-0312-native.log`) in macOS VS Code 1.142.0. Syntax/whitespace checks pass. Mouse modifiers are exercised through real Chromium input; the native check does not claim a physical-modifier mouse walkthrough.
- Bumped only the three root app version fields and preserved manifest formatting. All 207 registry package URL/version records are consistent; `@typespec/ts-http-runtime` remains at 0.3.9. Packaged/installed v0.3.12 (42 files), reloaded the actual user window, and verified original snapshot 22:36, 17 files / 62 components, no selection and 85% zoom. The loaded footer includes Shift panning. Installed scripts/styles and host code match the tested build. Original Quiet Light and sidebar layout are preserved.
- No commits, publication, external messages or lasting user preference changes.

## Twelfth pass delivered: v0.3.13 (04:34 London)

- Added passing coverage for actual Node worker exit while a request is pending. The test targets the real worker solely to inject termination, then asserts through `GraphService.build` that the request rejects and a fresh worker rebuilds all 10,000 symbols of the identical review. No production service change/test hook was needed. The unit count is now **51**. This covers an unexpected exit event, not an OS-level/WASM crash at a specific parser instruction.
- Added a passing native panel lifecycle case: close the first panel while controlled analysis remains pending, create a replacement, finish the replacement first and the closed panel last, then open an original-side symbol from the replacement. Real VS Code panel behaviour is exercised; analysis ordering is a controlled collaborator. No production change was needed for this scenario.
- Reproduced an adjacent UX bug: Open Change Graph on an already-open failed review disposed its panel. Native assertion `failedPanelDisposed === false` was red (`true`). `GraphView.show` now reveals the same panel and invokes its existing retry path; repeated requests share the pending promise. The native case verifies panel retention, original captured files and original-side navigation. Existing browser retry coverage supplies the view-state message checks; no full native client-state replay is claimed.
- Unit baseline: `/private/tmp/agent-overnight-lifecycle-baseline.log` (50/50). Focused real-worker check: `/private/tmp/agent-overnight-worker-exit-check.log` (4/4 graph-service tests). Full characterization regression: `...lifecycle-unit-51.log` (51/51). Native baseline: `...lifecycle-native-baseline.log`; closed/replacement check: `...close-reopen-check.log`; valid failed-reopen red: `...0313-reopen-red.log`.
- Final checks: `npm test` 51/51 (`/private/tmp/agent-overnight-0313-unit.log`), full browser pass (`...0313-webviews.log`), full native pass (`...0313-native.log`), syntax/whitespace checks. Unit runtime is **Node 26.3.0**; native runtime is macOS **VS Code 1.142.0**.
- Bumped only root app version metadata, retaining all 207 registry lock URL/version matches and `@typespec/ts-http-runtime` 0.3.9. Packaged/installed v0.3.13 (42 files), reloaded the actual user window and verified snapshot 22:36, 17 files / 62 components, no selection and 85% zoom. Installed graph/provider/service/extension assets match tested source. Original theme/layout remain intact.
- No commits, publication, external messages or lasting preference changes. Existing user work is preserved.

## Thirteenth pass delivered: v0.3.14 (05:10 London)

- Reproduced Other changes being active before analysis supplied graph data. It is now disabled from initial markup and during loading/error, with state-specific help text and native disabled styling; unavailable popups close. It becomes available on recovery. Its hover highlight excludes disabled state. Red/green: `/private/tmp/agent-overnight-0314-availability-red.log` / `...0314-availability-green.log`.
- Reproduced a failed inline keyboard Retry losing focus to the body (`...0314-retry-focus-red.log`). The initiating action records focus and restores it on another failure only if the document remains active and focus is still on the body. Terminal success clears the marker. A real DOM characterization checks focus and text stay in search when the user moves there while retrying. Retry can be invoked again immediately with Space after failure.
- Found the primary action's keyboard outline was invisible against an identical fill: RGB(40,91,128), 1px width, -1px offset. The valid focus-style red is `...0314-focus-ring-red.log`. Retry and Open diff/usage buttons now use a 2px exterior offset, consistent with Comparison. Inspected `/private/tmp/agent-overnight-webviews/graph-analysis-error-focus-before.png` and updated `graph-analysis-error.png`; the external ring is visible at 320×320. The automated criterion checks distinguishability when the colors match, rather than hard-coding the chosen offset.
- One full browser run exposed a fixture race: after switching data, a generic `.edge-label.first()` could still select the previous graph before the next animation frame, producing zero rather than sixty usage entries. The fixture now selects the new graph's exact edge ID. The expected entry count is unchanged. This was test synchronization, not a CSS/product failure.
- Final checks: `npm test` 51/51 (`/private/tmp/agent-overnight-0314-unit.log`), full browser pass (`...0314-webviews.log`), native VS Code 1.142.0 pass (`...0314-native.log`), syntax/whitespace checks. Baseline: `...0314-baseline.log`. The inactive-document focus guard retains the previously documented native window-switching limitation.
- Root version fields only; all 207 registry package URL/version records remain consistent and `@typespec/ts-http-runtime` stays 0.3.9. Packaged/installed v0.3.14 (42 files), reloaded the actual user window and verified snapshot 22:36, 17 files / 62 components, no selection and 85%. Other changes is enabled with the ready-state tooltip in that live graph. Installed scripts/styles/provider/extension assets match tested source. Original theme/layout remain intact.
- No commits, publication, external messages or lasting preference changes. User work remains preserved.

## Fourteenth pass delivered: v0.3.15 (05:20 London)

- Reproduced reverse Tab navigation leaving a tall expanded card's heading focused above the viewport. Keyboard-visible focus now adjusts the camera when its target lies above or left of the canvas; the existing native positive-scroll folding remains in place. Reverse forty Tab steps return to a visible class heading with viewport scroll origin zero.
- Reproduced the analogous left-edge failure with a partially visible caller card. An initial fixture incorrectly assumed the caller preceded the class in DOM order; that setup was corrected before the valid visibility red. No expected outcome was weakened. Valid reds: `/private/tmp/agent-overnight-0315-reverse-red.log` and `...0315-left-valid-red.log`; each fix passed all browser regressions before the next case.
- Reproduced panning changing keyboard focus from a function signature to its same-symbol heading (`...0315-exact-focus-red.log`). Rendering now retains the connected active element; it resolves IDs only when intentional pending focus or remounting requires it. The exact signature button remains focused after a real wheel input.
- Added passing pointer characterization on a card clipped at the left edge using actual mouse coordinates, avoiding locator auto-scrolling. One click selects without opening or panning, and double-click opens exactly the intended symbol once. Keyboard focus adjustment is restricted to `:focus-visible`, preserving pointer placement. Existing forward navigation, paging and relationship navigation remain green.
- Final checks: 51/51 unit tests (`...0315-unit.log`), all browser regressions (`...0315-webviews.log`) with Playwright 1.62.1 / Chromium 151, native VS Code 1.142.0 suite (`...0315-native.log`), syntax and whitespace checks. Inspected the focused heading in `/private/tmp/agent-overnight-webviews/graph-reverse-keyboard.png`. Long-card/clipped-pointer interactions are real-resource browser evidence, not a native long-card walkthrough.
- Root version fields only; all 207 registry URL/version records are consistent and the unrelated runtime dependency remains 0.3.9. Packaged/installed v0.3.15 (42 files), reloaded the user's actual window, and verified snapshot 22:36, 17 files / 62 components, no selection and 85% returned automatically. Six installed scripts/styles/host files match tested source. Quiet Light and existing layout remain intact.
- No commits, publication, external messages or lasting preference changes. User work remains preserved.

## Fifteenth pass delivered: v0.3.16 (05:55 London)

- Downloaded the official minimum-supported VS Code 1.94.0 into a temporary cache and ran the existing native suite in an isolated profile. Both initial and final runs pass on its actual Node 20.16.0 / Electron 30.5.1 / Chromium 124.0.6367.243. The installed VS Code 1.142.0 suite also passes on Node 24.21.0 / Electron 43.7.7 / Chromium 150.0.7871.250. Integration output now identifies the runtime used. The older app emits an auxiliary UtilityProcessWorker shutdown warning after assertions pass and the test host exits cleanly; the runner exits zero.
- Ran all 51 compiled unit tests using that actual Node 20.16.0 runtime (`ELECTRON_RUN_AS_NODE=1`), including real parsers, worker recovery and local bridge/CLI workflows: 51/51 pass. Node 26.3.0 baseline also passed 51/51 at the start of this pass.
- Exercised the real-resource browser suite on official Playwright Chromium 124.0.6367.29 as a separate older-renderer boundary. The old Playwright installer stalled in extraction; its downloaded ZIP passed `unzip -tq`, and the system extractor completed it. Only the three verified stalled installer processes were terminated. No project dependency or installed browser was replaced.
- Diagnosed an older headless/Retina protocol quirk: requesting a 400px wheel event delivered 800px and panned the fixture past its intended neighbour. An independent three-mode fixture showed default and new headless modes both deliver 800 at emulated DPR 1; forcing test display scale 1 delivers the requested 400. The browser runner now fixes that scale and prints its runtime. Behavior assertions were retained. This was test environment setup, not an app pan bug. Diagnostic log: `/private/tmp/agent-overnight-chromium-124-wheel-diagnostic.log`.
- The correctly configured older browser exposed a real error-details accessibility gap: Shift+Tab from Retry focused Context instead of the scrollable notice (`...chromium-124-scaled.log`). Error notices now explicitly enter the tab order; normal loading/ready notices stay out. Their keyboard outline uses the existing VS Code focus color. The unchanged keyboard/PageDown/Retry assertions pass on Chromium 124 and 151. No other production changes were needed.
- Final browser logs: `/private/tmp/agent-overnight-chromium-124-error-green.log` and `...0316-webviews.log`. Final native logs: `...0316-native-194.log` and `...0316-native-current.log`. Node 20 unit log: `...node20-unit.log`. Inspected older-renderer error and larger-text Comparison screenshots in `/private/tmp/agent-overnight-webviews-124`. Native host integration and standalone browser rendering are distinct boundaries; their Chromium patch versions differ.
- Packaged/installed v0.3.16 (42 files), then extracted that exact VSIX outside the repository. Its bundled worker produced 25 expected symbols across TypeScript, JavaScript, Python, C++, Java, C# and TSX with no parser notices on Node 20.16.0, with no node_modules and empty NODE_PATH. Evidence: `/private/tmp/agent-overnight-0316-packaged-node20.log`; fixture retained at `/private/tmp/agent-review-packaged-0316-node20/smoke.cjs`.
- Reloaded the actual user window and verified snapshot 22:36, 17 files / 62 components, no selection and 85% returned automatically. Six installed graph/Comparison/host assets match tested source. All 207 registry lock records remain consistent; only root app version fields changed, and the unrelated runtime dependency stays 0.3.9. Original Quiet Light/layout remain intact. Syntax and whitespace checks pass.
- No commits, publication, external messages or lasting preference changes. Existing user work remains preserved.

## Sixteenth audit finished: stable v0.3.18 (06:30 London)

- Reproduced native Escape cancellation returning focus to the graph rather than Comparison, first with a click and then with a fully keyboard-only walkthrough. The selected main/worktree sources, original snapshot and graph camera were preserved.
- A temporary v0.3.17 candidate restored the Comparison view after the picker action. Controlled callback/view tests were red before restoration and passed afterward; target completion, another real editor tab and disposed-view boundaries were also checked. Current and minimum VS Code suites passed. A TypeScript narrowing issue in the target fixture was corrected before that check ran.
- Actual installed v0.3.17 keyboard checks passed for Base, Compare and a custom-ref input: typed HEAD~1 then Escape, and Tab continued through Comparison. However, a necessary additional pointer check caught the candidate pulling focus back when the user clicked graph search in the already-active graph. The tab guard could not distinguish this from normal Escape restoration. This invalidated the candidate despite its earlier passing checks.
- Removed only this pass's restoration implementation and candidate-only tests; expected outcomes were not weakened to manufacture green. Candidate source snapshots remain at `/private/tmp/agent-overnight-picker-candidate` and red/green logs remain under `/private/tmp/agent-overnight-0317-*` for audit. The supported local VS Code types expose `QuickInput.onDidHide: Event<void>`, with no reason for hiding. Automatic return after Escape is deferred; do not add global Escape bindings or custom branch pickers merely to force this polish item through.
- Packaged/installed v0.3.18 to replace the temporary candidate. Verified all **34** workspace, packaged and installed application/resource assets exactly match the previously verified stable v0.3.16. Only root version metadata, README's installer name and audit documentation differ. The first fifteen passes remain intact.
- Final `npm test`: 51/51 (`/private/tmp/agent-overnight-0318-unit.log`). Full browser suite passes (`...0318-webviews.log`). Current native integration passes (`...0318-native-current.log`). Earlier VS Code 1.94 / Node 20 / Chromium 124 / packaged-worker evidence covers the byte-identical stable assets. All 207 registry URL/version records remain consistent and the unrelated runtime dependency is still 0.3.9. Syntax/whitespace checks pass.
- Native final verification: open Compare, deliberately click graph search, and confirm search remains focused. Main/worktree, Refresh Changes, snapshot 22:36, 17 files / 62 components, no selection and 85% remain intact. The temporary Problems panel opened while exploring a key binding was closed; original Quiet Light/sidebar layout are restored. No Connect action was triggered: the current review has no linked agent, so that action opens/copies connection instructions rather than an agent picker.
- No commits, publication, external messages or loss of user changes. This pass contributes audit evidence and a documented limitation; it does not claim a new retained focus feature.

## Seventeenth audit finished: native narrow sidebar (06:48 London), v0.3.18 unchanged

- Inspected the installed Comparison/sidebar in the actual user window at approximately 240px and 180px content widths. These approximate values come from native 60px layout increments and the 2× screenshots, not a webview DOM width measurement. The original content width was approximately 300px.
- Read the installed VS Code command implementation before choosing controls: generic Decrease Current View Size selects the focused workbench part; explicit Increase/Decrease Editor Width always targets the editor, with a 60px increment. The palette returned focus to the editor, so the generic command initially widened the sidebar. This was reversed using the explicit width controls, then the narrower checks proceeded predictably. No coordinate dragging or ambiguous repeated commands were used.
- At approximately 240px in Quiet Light and 180px in Quiet Light, Dark Modern and Dark High Contrast: Base/Compare labels and dropdowns, Show, Refresh Changes and Connect remain visible and readable. Explanatory text and snapshot status wrap; native tree rows truncate long filenames while retaining full accessible labels/tooltips. The graph retains its controls/Details and adapts to the surrounding theme. No new layout defect was observed in these states.
- Restored Quiet Light and the original sidebar separator position with the inverse explicit width steps. A final native screenshot and accessibility read verify original main/worktree, Refresh Changes, snapshot 22:36, 17 files / 62 components, no selection and 85%. No panel is left open and no comparison was refreshed.
- No application code, tests, package metadata or installed assets changed. Existing automated coverage remains the executed v0.3.18 results; this is manual native visual evidence, not a newly automated test. Updated the scenario/progress notes and checked whitespace.
- No commits, publication, external messages or lasting preference changes. Existing user work remains preserved.

Review real layouts in light, dark and high contrast, keyboard focus, narrow sidebars/editors, empty comparisons, older review navigation, comments/replies and graph filtering. Record specific evidence and limitations here. Avoid adding features merely to fill the night; use remaining time to inspect and test meaningful risks.

Final handoff preparation is now the remaining work. Read the notes and current Git/asset state, check for any changes since the verified v0.3.18 build, and consolidate a concise morning report with actual results and limitations. Do not repeat passing suites without a new change or concern, invent more features to fill the remaining time, or revisit the deferred picker-focus workaround. The native narrow-sidebar/theme requirement now has manual evidence as above; browser checks separately cover exact 220–520px widths and larger text/long labels on Chromium 124/151. Preserve the original saved graph and Quiet Light layout. Minimum VS Code 1.94, Node 20 and the packaged worker are covered. Real native background-window Comparison/Retry focus, Windows/remote development and physical native modifier-wheel input remain unvalidated. Finish and stop by 08:00 Europe/London; disable further overnight wakeups when giving the final morning handoff if needed. Do not publish or message anyone.


## User-approved feature follow-up — configurable axes (24 October, v0.4.0)

Implemented the approved full-card band design in the app, with Folder/File/Changed lines/Change type axes, swapping, saved settings, retained Relationships mode, reserved-gutter directed links, All/Selected card visibility and visible connection-group counts. Settings changes preserve the captured review and selection. Fixed the small-editor, focus, class-link highlight, high-contrast and member-page wrap regressions encountered while testing. See the completed configurable-axes section of TEST-SCENARIOS.md for exact coverage, logs and limitations.

64 unit tests pass on Node 26 and sequentially on the actual Node 20 runtime. Full browser checks pass on Chromium 124/151; native integration passes on VS Code 1.94/1.142. v0.4.0 is packaged and installed, with all 36 app/resource files identical between source/package/install. Its isolated worker smoke passes all six languages plus TSX on Node 20. Manual native mode/swap/connection/diff/theme checks passed with snapshot 22:36 unchanged; Quiet Light was restored. The initial native reload restored the pre-feature selection/camera. At the initial handoff, the additional post-axes full-window reload was not completed; browser reload persistence passed. The native follow-up below closes that verification gap. Native input was stopped at the user's current view rather than forcing test preferences back over it. No automation was resumed and no code was committed or published.


## Native axes reload verification — completed follow-up (24 October)

Two actual Developer: Reload Window runs passed in the installed VS Code 1.142.0 / Agent Diff Review v0.4.0. The graph restored automatically each time with Axes mode, horizontal File, vertical Changed lines, selected function `button` at resources/graph.js:24, 40% zoom, snapshot 22:36 and 17 files / 62 components. The first reload retained All connections (133 eligible groups). A second reload retained the deliberately chosen non-default Selected card setting (9 eligible groups). All connections was then restored and the Layout popup closed, with the same selection, axes, zoom and snapshot. Native menu changes required refreshed accessibility targets, but no app change was necessary. The previously reported native persistence limitation is resolved. Documentation only; no additional unit-suite run was needed.


## Native VS Code presentation follow-up — v0.4.1 (24 October)

Added a shared stylesheet using the current host's corner, spacing and widget tokens with minimum-version fallbacks. Standardized primary/secondary buttons and toolbar hover/focus/expanded/pressed/disabled styles. Refresh and diff navigation now use secondary controls; diff actions are compact and aligned with Details content. Removed decorative card shadows, aligned section/row styling and kept camera controls beside axis labels, including narrow editors. Compared with installed 1.142 and 1.94 native CSS rather than choosing unrelated curves.

64 unit tests, full Chromium 124/151 webview suites and native 1.94/1.142 integration pass. New meaningful presentation regressions were red before their fixes; cosmetic spacing/surfaces were visually reviewed. Packaged/installed v0.4.1 has 45 files, with all 37 app/resource files matching source/package/install and all 207 registry lock records consistent. Manual native reload restored snapshot 22:36, 17 files / 62 components, File × Changed lines, All connections, selected `button` and 40%. Verified the new diff action, Layout popup, Quiet Light/Dark Modern/Dark High Contrast and approximately 180px sidebar width. Restored Quiet Light and the original width. Results, exact logs and limits are in the top TEST-SCENARIOS.md section. No commits, publishing, external messages or automation changes.


## PR reviewer workflow follow-up — v0.5.0 (24 October)

Committed and pushed the existing graph/axes/native-style work first as `4ddd966`, with a clean baseline of 64 unit tests and full browser checks. The follow-up adds a whole-review overview with file status, honest text totals, captured source/mode/date and five largest text changes; an Overview return action preserving graph settings; explicit off-screen recovery; and native previous/next changed-file navigation tied to the open diff's saved snapshot. Preview tabs avoid pinning a new editor for every step. Long overview file paths now truncate without pushing narrow Details panels sideways.

Used Canon TDD one behavior at a time. Final 69 unit tests pass; the five new ordering/boundary cases also pass on Node 20. Full graph/Comparison/axes browser checks pass on Chromium 124/151 and native integration passes on VS Code 1.94/1.142. New overview theme and 220px screenshots were inspected. v0.5.0 is packaged and installed (46 package files), with all 38 app/resource files identical across source/package/install and all 207 lock records consistent. Full evidence and exact log paths are in the top TEST-SCENARIOS.md section.

The actual user window reloaded with the original 22:36 snapshot, File × Changed lines, All connections, selected button and 40%, including the old off-screen camera. Clicking Show selection intentionally recovered it. Verified overview provenance/counts and direct file diff with working native previous/next buttons, then closed walkthrough diff tabs. Inspected Quiet Light/Dark Modern/Dark High Contrast at approximately 180px sidebar width; restored Quiet Light, original sidebar width, selection, axes, connection mode and zoom. The recovered card remains visible. No comparison was refreshed, agent connected, message sent or automation resumed.

No known failing check remains for these changes. Windows/remote/native physical modifier-wheel limits remain; largest text changes do not claim runtime risk or test/CI coverage. Navigation position is not a completion tracker. Follow-up changes are prepared as a separate commit from the initial checkpoint.


## Graph feedback follow-up — v0.5.2 (25 October)

Added native VS Code **Add Comment** actions for graph symbols, usage locations and text files. Following the user's clarification, graph components and individual members now expose a native right-click menu. That route uses the existing-style native feedback prompt without opening another editor. A whole component anchors its full captured range; a member anchors only its own range, including original-side removed code. Both routes use ordinary review notes, native diff threads and the existing Comments/Send Review/agent-reply workflow. Graph menus resolve IDs against their own captured snapshot, independently of the active editor or current comparison. Binary/omitted previews do not offer unusable line-comment actions.

Canon TDD red/green evidence covers symbol/file/usage entry points, available-text metadata, component/member native context targets and whole-component persistence. Native integration verifies shared thread identity, exact removed-member navigation, full component/subfunction ranges, cancellation and rejected targets, plus actual test-agent delivery/replies. Final 70 unit tests, complete Chromium 124/151 graph/Comparison/axes suites, and native VS Code 1.94/1.142 integration pass. See the top TEST-SCENARIOS.md section for exact logs, native renderer input setup, fixture corrections and boundaries.

Installed v0.5.2 (46 package files): all 38 app/resource files and the context menu manifests match source/package/install, with all 207 dependency records unchanged. Actual right-click checks cover GraphSymbol's complete 9–22 range and the nested lookup function's 160–166 range. A temporary graph-created draft opened as the same normal native diff thread; deleted that test draft through Delete Draft and closed the walkthrough views. No real agent message was sent. Preserved the user's latest snapshot 22:36, 17 files / 62 components, File × Changed lines, selected rebuild, 81%, Quiet Light and sidebar width. No automation was resumed. Windows and remote development remain unvalidated.
