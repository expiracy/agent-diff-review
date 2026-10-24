# First-version scenarios

## Native VS Code presentation — follow-up

- [x] Inputs and actions follow VS Code corner-size tokens across both webviews, with compatible older-host fallbacks.
- [x] Toolbar hover, pressed, expanded, disabled and keyboard-focus states use native colors and outlines.
- [x] Compare/Apply/Retry are prominent; routine Refresh and diff navigation use secondary controls.
- [x] Graph cards, popovers, badges and Details rows use native surface and spacing conventions without decorative card shadows.
- [x] Existing interactions, axes persistence and short/narrow layouts remain usable across themes.
- [x] Package/install and inspect the actual native window, preserving its saved review and settings.

Baseline: 64 unit tests and the full Chromium webview suites pass. Native reference: the installed VS Code 1.142 CSS and theme-size provider; minimum-version reference: VS Code 1.94 CSS. Current host forwards registered corner/spacing sizes to webviews. Logs: `/private/tmp/agent-native-style-baseline-{unit,webviews}.log`.

Delivered as v0.4.1. Both webviews load `resources/vscode-ui.css` for shared control/action/widget radii, spacing, button roles and toolbar states. Current-host controls follow the registered corner-size tokens; hosts without them retain the 1.94-era 2px input/button and 5px toolbar-action corners. Graph cards have no decorative shadow; popovers use the host widget shadow. Details uses compact secondary diff buttons, consistent content insets and flat relationship rows. Comparison keeps Compare/Apply primary and makes routine Refresh secondary. Camera controls sit beside axis labels and compact at narrow widths.

Validation: 64/64 unit tests pass. Full real-resource browser suites pass on Chromium 151.0.7922.34 and 124.0.6367.29, including dynamic corner sizes, older-host fallbacks, primary/secondary colors and borders, distinct hover/focus outlines, camera placement, existing axes/settings/selection reload coverage and all prior interactions. The first corner, action-role, hover-outline and camera-placement assertions each failed before implementation. A secondary-action fixture first retained pointer hover; moving the test pointer away exposed the intended base-color failure before implementation. Cosmetic spacing/surface changes were visually reviewed without adding tests that merely repeat CSS declarations. Four theme classes, 220–520px sidebar widths, 220px graph controls and 320×320 graph panes pass; screenshots are retained in `/private/tmp/agent-native-style-webviews` and `/private/tmp/agent-native-style-axes`.

Native extension integration passes on VS Code 1.142.0 (Node 24.21.0 / Electron 43.7.7 / Chromium 150.0.7871.250) and 1.94.0 (Node 20.16.0 / Electron 30.5.1 / Chromium 124.0.6367.243). The older host still emits its auxiliary shutdown warning after assertions pass; the runner exits zero. Packaged/installed v0.4.1 contains 45 files; all 37 app/resource files match tested source, package and installation. All 207 registry URL/version records remain consistent; no dependency changed.

Manual installed checks: the actual window reload restored snapshot 22:36, 17 files / 62 components, File × Changed lines axes, All connections, selected `button` at captured resources/graph.js:24 and 40% zoom. The compact diff action opened its saved native diff and returned to the same graph. Inspected the live Comparison, Details, Layout popup and camera controls in Quiet Light, Dark Modern and Dark High Contrast. At approximately 180px sidebar content width, sources, Show, Refresh and Connect remained contained and usable; native file rows truncated normally. Restored Quiet Light and the original sidebar width with the inverse two native size steps. Native theme rows were explicitly clicked after an initial keyboard selection did not change the actual theme; only the visibly applied themes are counted as native checks. The saved review, selection, axis/connection settings and zoom stayed intact.

Final logs: `/private/tmp/agent-native-style-final-{unit,webviews,chromium124,native,native194}.log`. Syntax and whitespace checks pass. Native walkthroughs are on macOS; Windows/remote development and physical native modifier-wheel input are not newly validated. No commits, publication, external messages or automation changes; pre-existing user work is preserved.

## Configurable graph axes — implementation checklist

Use Canon TDD one scenario at a time. Keep the existing relationship layout and captured reviews intact. Direct tests cover layout/routing; real-resource browser checks cover controls, geometry, state and interactions; native VS Code checks cover installed resources, diffs, persistence and themes. Preserve all pre-existing uncommitted work.

- [x] Folder groups share labelled columns while keeping full-width cards.
- [x] File groups distinguish identical basenames by their full relative path.
- [x] Change-size bands use added + removed lines, with explicit zero and unavailable groups.
- [x] Both axes support folder, file, change size and change type with clear ordering.
- [x] Crowded cells and expanded cards never overlap; metrics do not depend on expansion or filters.
- [x] Directed connections retain their identity and route through gaps around cards.
- [x] Controls switch Relationships/Axes, swap axes and prevent duplicate dimensions.
- [x] All/Selected connections and class-member highlighting include off-screen counts.
- [x] Readable axis labels, selection, keyboard focus and settings survive relayout/reload.
- [x] Existing diff, filtering, retry, overview and large-review workflows remain green.
- [x] Package, install and verify actual VS Code; preserve the user's snapshot and preferences.

Baseline: 51 unit tests, full webview checks and native VS Code integration pass. Logs: `/private/tmp/agent-axes-baseline-{unit,webviews,native}.log`. No new dependency is planned.


Delivered as v0.4.0. The default remains Relationships for existing views; Axes initially uses horizontal Changed lines and vertical Change type. Controls save with the graph, reject duplicate dimensions and retain the selected item when relaying out. Axes reserve gaps for directional paths and place connection labels clear of cards. All/Selected card counts refer to cross-card connection groups; individual captured usages remain in Details. Fixed screen-sized guides remain readable while zooming. Expanded cards, 12-card lanes, zero/unavailable totals and inclusive boundaries have direct and browser coverage.

Validation:
- `npm test`: 64/64 pass, including 13 new layout/routing tests. The sparse 5,000-file layout initially took 18.8 seconds; sparse cell placement reduced the measured direct check to about 24 ms.
- `npm run test:webviews`: all existing workflows and the new axes harness pass on Chromium 151.0.7922.34. Both scripts also pass on Chromium 124.0.6367.29. The new suite uses actual graph HTML/CSS/scripts and a VS Code messaging adapter; ordinary/crowded fixtures use the real parser. Its controlled 5,000-file overview checks the renderer boundary separately and completes with search in roughly 0.7–0.8 seconds. Screenshots cover four theme classes; controls fit 220px-wide and 320×320 editors.
- Native integration passes on VS Code 1.142.0 (Node 24.21.0 / Electron 43.7.7 / Chromium 150.0.7871.250) and VS Code 1.94.0 (Node 20.16.0 / Electron 30.5.1 / Chromium 124.0.6367.243), including the permitted layout resource and saved symbol/usage navigation. The older host emits its known auxiliary shutdown warning after assertions pass and exits zero.
- All 64 unit tests pass on actual Node 20.16.0 with `--test-concurrency=1`. An earlier concurrent run stalled in the parser test process; only its two identified processes were stopped before the sequential rerun. This does not establish a concurrency fix for the older test runner.
- Packaged and installed v0.4.0 (44 files). All 36 app/resource files match tested source, VSIX and installation. The extracted package's worker passes the six-language plus TSX smoke test on Node 20, producing 25 expected symbols without development dependencies. All 207 registry lock URL/version records remain consistent.
- Manual checks in the user's installed VS Code: the original graph automatically restored with snapshot 22:36, 17 files / 62 components, ReviewExtension selected and 93% zoom. Axes, swapping, File grouping, duplicate-axis prevention, All/Selected connections, dependency Details and both symbol/usage native diff actions work. Fit showed all 133 connection groups; selected-class mode showed 1 of 2 external groups in view after swapping. Inspected Quiet Light, Dark Modern and Dark High Contrast, including an orange selected connection, then restored Quiet Light. The snapshot remained unchanged. New axes/connection settings survive browser reload. The follow-up native full-window reload check is now complete: two Developer: Reload Window runs in the installed VS Code 1.142.0 restored Axes mode, horizontal File, vertical Changed lines, the selected `button` function at resources/graph.js:24, 40% zoom, snapshot 22:36 and 17 files / 62 components automatically. The first run retained All connections (133 eligible groups); the second retained the non-default Selected card preference (9 eligible groups), proving it did not reset to All. The original All preference was restored and the Layout popup closed afterward. No application fix was required.

Regressions found and fixed: short-editor Details/Retry space, 220px toolbar/popup clipping, off-screen connection counts, class-member highlighting, axis guides obscuring reverse keyboard focus, partial member pages wrapping to an overlapping page, and high-contrast selection color. Test setup corrections (native option disabled-property assertions and an isolated 60-member keyboard fixture) retained the intended behavior assertions. Valid reds and final logs are under `/private/tmp/agent-axes-*`; final logs include `final-unit`, `final-webviews`, `final-chromium124`, `final-native`, `final-native194`, `final-node20-sequential` and `packaged-worker`.

Limits: Windows/remote development and physical native modifier-wheel input remain unvalidated. Very large reviews still need pan/zoom or search; Fit is an overview. No parser-resolution scope was expanded. No commits, publication or external messages; pre-existing user changes remain intact.


## Native narrow-sidebar visual audit (0.3.18)

- [x] Inspect installed Comparison at approximately 240px and 180px sidebar content widths.
- [x] Inspect the near-minimum layout in Quiet Light, Dark Modern and Dark High Contrast.
- [x] Restore the original width, Quiet Light theme and saved review.

Validation: native source confirms editor-width commands adjust the layout in 60px steps. The generic Current View command targeted the editor after palette focus; explicit Increase/Decrease Editor Width controls made the changes reversible. At the narrower layouts, source controls, Show, Refresh and Connect stayed visible; explanatory/status text wrapped, and native file rows truncated with full accessible text. Light, dark and high-contrast colors/borders remained readable. The original separator position and Quiet Light appearance were restored, with snapshot 22:36, 17 files / 62 components, no selection and 85% unchanged. Widths are approximate from the 60px steps and native screenshots, rather than a DOM measurement. This was a manual visual audit; no application change or new automated-test claim is made.


## Native picker audit and stable correction (0.3.18)

- [x] Cancelling Base, Compare and an edited custom ref preserves the selected sources and captured snapshot.
- [x] Clicking graph search while a picker is open retains the user's chosen graph focus.
- [ ] Deferred: automatic keyboard focus return to Comparison after Escape.

Validation: a temporary v0.3.17 focus-return candidate passed controlled callback tests and real Escape/Tab walkthroughs, but an additional native outside-click check exposed focus being pulled away from the already-active graph. The candidate and its candidate-only assertions were removed, rather than weakening those assertions. The supported QuickInput hide event exposes no cancellation reason; a broader input redesign or global Escape binding is outside this polish scope. Version 0.3.18 restores the verified behavior: all 34 delivered/installed application and resource files match stable v0.3.16 exactly. The native outside-click journey now leaves graph search focused, with main/worktree, snapshot 22:36, 17 files / 62 components and 85% intact. Final 51 unit tests, full browser regressions and current native suite pass. Earlier minimum-runtime, older-browser and packaged-worker evidence applies to those identical assets. No user changes were reverted.


## Minimum-version compatibility and error access (0.3.16)

- [x] Native workflows pass in VS Code 1.94.0 (Node 20.16.0, Electron 30.5.1, Chromium 124.0.6367.243) and installed VS Code 1.142.0 (Node 24.21.0, Electron 43.7.7, Chromium 150.0.7871.250), each in an isolated profile.
- [x] All 51 compiled unit tests pass using the minimum build's actual Node 20 runtime, including parser WASMs, worker interruption/recovery and local bridge/CLI workflows.
- [x] Real-resource browser regressions pass on Chromium 124.0.6367.29 and 151.0.7922.34, including themes, narrow layouts, graph interactions and recovery.
- [x] Long error details are keyboard reachable and scrollable on the older renderer, with VS Code focus styling.
- [x] The delivered VSIX's worker parses six languages and TSX on Node 20 outside the repository, without development dependencies: 25 expected symbols and no parser notices.

Validation: Chromium 124 exposed error details being skipped by Shift+Tab from Retry. Explicitly making only error details focusable fixes the unchanged behavioral check on both browser versions. The native minimum-version suite exercises host integration; standalone Chromium 124 is a separate renderer boundary, with a different patch version. Older headless Chromium doubled protocol wheel deltas on Retina (400 requested, 800 delivered); a standalone fixture confirmed fixing the test display scale yields 400, and all behavior assertions remain unchanged. Both runners now print runtime versions. The old Playwright extractor stalled; the official downloaded ZIP passed integrity validation and was extracted with the system tool. VS Code 1.94 emits an auxiliary process warning during shutdown after integration assertions pass and its test host exits cleanly; the runner exits zero. Windows/remote development, native background-window focus and physical native modifier-wheel input remain unvalidated.


## Reverse navigation and exact focus (0.3.15)

- [x] Shift+Tab back through a tall card keeps its heading visible with native viewport scroll at zero.
- [x] Keyboard focus reveals a card clipped at the left edge.
- [x] Panning retains the exact focused signature button when its heading shares the same symbol ID.
- [x] A real mouse click on a clipped card selects without panning or opening; a double-click opens its intended diff once.

Validation: each of the first three cases exposed a separate failure before its fix. The left-edge fixture initially assumed the wrong tab order; that setup was corrected before the valid visibility failure. Full browser regressions pass after each change, including the pointer characterization and existing forward/paging navigation. Inspected the reverse-navigation screenshot with the focused heading visible. All 51 unit tests and the native VS Code 1.142.0 suite pass. Long-card focus and clipped-pointer cases use real Chromium resources/input with a VS Code messaging adapter; they do not claim a native long-card walkthrough. Existing platform, minimum-version, background-window focus and physical modifier-wheel limitations remain.


## Failure controls and primary focus styling (0.3.14)

- [x] Other changes stays disabled during loading/error, explains why, and becomes available after graph recovery.
- [x] A failed keyboard retry returns focus to Retry, ready for another attempt.
- [x] Retry failure leaves focus and text alone when the user has moved to search.
- [x] Primary graph actions retain a distinguishable focus ring when fill and focus colors match.

Validation: premature Other changes availability and lost Retry focus each failed before their fixes. A keyboard-focus check also exposed an inset outline matching the blue fill; the ring now sits outside Retry/Open diff buttons. Before/after error screenshots were inspected at 320×320. The moved-search-focus case already passed with the guard. A full run exposed a test-fixture race selecting a previous graph's generic edge label; the usage case now waits for its own exact edge ID, retaining the sixty-entry assertion. All 51 unit tests, browser regressions and native VS Code integration pass. Packaged/installed v0.3.14; matching assets and actual reload restoration of snapshot 22:36, 17 files / 62 components, no selection and 85% verified. Other changes is available with its explanatory tooltip in the live ready graph. Registry lock records remain consistent. Existing platform, minimum-version, native background-focus and physical modifier-wheel limitations remain.


## Analysis interruption and reopening (0.3.13)

- [x] A real worker exit rejects pending analysis and a fresh worker rebuilds the same captured review.
- [x] A late analysis result from a closed native panel leaves its replacement usable.
- [x] Open Change Graph retries an already-open failed comparison in the same panel and coalesces duplicate requests.

Validation: worker termination and pending-tab replacement already passed and remain characterization coverage. The Node test terminates an active test worker with a 10,000-symbol request pending, then checks complete recovery of the identical review; it increases the unit suite to 51. The native pending-tab case uses controlled analysis ordering and real VS Code panels. Reopening a failed review disposed its original panel before the fix (`true` instead of `false`); the provider now reveals that panel and starts its existing retry path. All 51 unit tests, browser regressions and native integration pass. Packaged/installed v0.3.13; matching assets and actual reload restoration of snapshot 22:36, 17 files / 62 components, no selection and 85% verified. Units ran on Node 26.3.0; native tests ran on VS Code 1.142.0. No fatal OS/WASM crash claim is made; worker exit is programmatically injected. Existing platform, minimum-version, native background-focus and physical modifier-wheel limits remain.


## Mouse navigation gestures (0.3.12)

- [x] Shift plus a vertical mouse wheel pans sideways while preserving vertical position and scale.
- [x] Ctrl-wheel zoom in keeps the rendered world point beneath the cursor steady.
- [x] Command-wheel zoom out keeps the rendered world point beneath a different cursor position steady.

Validation: Shift-wheel first failed with x unchanged at -76 instead of the expected -196; the fixture confirmed the Shift modifier reached the real wheel event. The handler now routes that gesture horizontally. Ctrl and Command anchoring already worked and needed no production change; computed CSS transform assertions keep both coordinates within 0.01 CSS px. All 50 unit tests, the complete browser suite and native VS Code integration pass. The updated footer fits the browser layout and is loaded in the installed window. Packaged/installed v0.3.12; matching assets and actual reload restoration of snapshot 22:36, 17 files / 62 components, no selection and 85% verified. All 207 registry lock records remain consistent; the development dependency restored in v0.3.11 stays at 0.3.9. Gesture input is browser-verified; physical mouse modifiers in native VS Code, native background-window focus, minimum-version VS Code and Windows/remote development remain unvalidated.


## Long-list keyboard expansion (0.3.11)

- [x] Show more files focuses the first newly revealed file, scrolls it into the popup and preserves a panned graph camera.
- [x] Show more relationships focuses the first newly revealed related symbol and keeps it visible in Details.
- [x] Show more usages focuses the first new diff action; revealing entries does not open a diff, and Enter opens the correct newly revealed usage.

Validation: each focus omission failed before its implementation change, then passed with the complete previous browser suite. Fixtures cover seventy unsupported files with a real panned graph, seventy resolved target relationships, and seventy member-to-function links grouped into one relationship. All 50 unit tests, browser checks and native VS Code integration pass. Packaged/installed v0.3.11 and verified original snapshot 22:36, 17 files / 62 components, no selection and 85% after an actual reload; installed assets match. Also corrected a development lock entry accidentally changed by the previous global version replacement: `@typespec/ts-http-runtime` is restored to 0.3.9, matching its URL, installed manifest and HEAD. All 207 registry lock records match their package URLs. The version bump now targets only the app's root version metadata. Long-list focus is browser-verified; native background-window focus, minimum-version VS Code and Windows/remote development remain unvalidated.


## Other changes and Comparison focus (0.3.10)

- [x] Opening Other changes focuses its first file; Escape returns to its toggle.
- [x] Choosing a file focuses Open file diff, ready for Enter, without automatically opening it.
- [x] A keyboard comparison restores its action focus after the update when the view remains active.
- [x] Completion respects an inactive-host focus flag and focus already on another control.

Validation: opening Other changes, choosing a file and completing a keyboard comparison each failed a real DOM focus assertion before their fixes. A controlled inactive `document.hasFocus()` value exposed the missing guard; a separate real DOM check already preserved focus on another control. Attempts to reproduce actual tab blur remained affected by Playwright's focus emulation, even with a secondary CDP session; real native background-window focus is not newly verified. All 50 unit tests, the full browser suite and native VS Code integration pass. Packaged/installed v0.3.10; assets match the tested build. In actual macOS VS Code 1.142.0, opened Other changes, verified README received focus, pressed Space to focus Open file diff, then Enter opened the captured native README diff. Closed the test diff and reopened the full original graph: snapshot 22:36, 17 files / 62 components, 85%, no selection. No theme/layout changes remain. Minimum-version VS Code and Windows/remote development remain unvalidated.


## Filter visibility, larger text and file navigation (0.3.9)

- [x] Narrowing change filters after deep panning brings remaining content back into view when all cards are off-screen; keep the camera when content is still visible.
- [x] Turning off Context while viewing an unchanged neighbour keeps changed components visible.
- [x] The Show dropdown grows to fit larger text, stays within a 220px sidebar and remains usable alongside Apply Comparison.
- [x] Exploring a file focuses its first symbol; All files focuses the original file card or matching component, or search when results are empty.

Validation: both filter visibility cases failed before their fixes. The native select's content area measured 20px for a 23px text line at 20px UI text; changing fixed height to minimum height passes the measured layout check. An initial line-height-based test was corrected because native selects return `normal`; only the subsequent natural-text measurement is the valid behavioural red. The four file-navigation focus cases each failed before their implementation changes. All 50 unit tests, the full browser suite and native VS Code integration pass. Browser checks retain four themes, 220–520px widths and bounded rendering of 10,000 symbols, and cover larger-text interaction and empty-search recovery. Packaged/installed v0.3.9; installed assets match the tested build, and the actual window restored snapshot 22:36, 17 files / 62 components and 85% zoom. Larger-text screenshots were inspected before and after. Minimum-version VS Code and Windows/remote development remain unvalidated.


## Member keyboard focus (0.3.8)

- [x] Expanding a card focuses the first newly revealed member.
- [x] Collapsing a card focuses its heading and keeps it visible.
- [x] Paging members focuses the first row of the next page, with Tab continuing through that page.
- [x] Inspect the installed sidebar and graph in Dark Modern and Dark High Contrast, then restore Quiet Light.

Validation: each of the three focus regressions failed with focus dropping to the page before its implementation change. The full browser suite passes after each fix; keyboard fixtures use a filtered 140-member class and verify the expected symbol IDs and subsequent Tab navigation. All 50 unit tests and the native VS Code integration suite pass. JavaScript syntax and whitespace checks pass. Packaged/installed v0.3.8; its graph and host assets match the tested build, and the actual window restored snapshot 22:36 with 17 files / 62 components at 85%. Native dark/high-contrast inspection confirmed theme colors, borders, labels and controls adapt together. Quiet Light was restored. Browser checks cover widths 220–520px; minimum-version VS Code and Windows/remote development remain unvalidated.


## Restored selections and keyboard camera (0.3.7)

- [x] Clear an obsolete saved symbol selection without crashing the graph or discarding valid camera state.
- [x] Retain the visible camera position when Tab reveals an off-screen graph item.
- [x] Keep a newly opened member page or collapsed card in view, including queued browser focus scrolling.
- [x] Reach and scroll long error details with the keyboard, then reach Retry without panning the graph (existing Chromium behaviour covered).

Validation: stale selection produced an undefined-symbol exception before its fix. Settled keyboard navigation produced 427px of hidden viewport scroll before the camera fix. The full browser regression caught member paging leaving an empty viewport; reanchoring the card and clearing queued native scroll restored the previous filtering checks. All 50 unit tests, the browser suite, and the native VS Code integration suite pass. JavaScript syntax and whitespace checks pass. Packaged and installed v0.3.7; the actual Quiet Light window restored its original 17-file / 62-component snapshot at 85% zoom. Installed graph and host assets match the tested build. Browser keyboard coverage uses Playwright 1.62.1 / Chromium 151; minimum-version VS Code and Windows/remote development remain unvalidated.


## Analysis recovery and linked members (0.3.6)

- [x] Graph failures show a truthful status and a Retry analysis action that stays visible with long errors in a small pane.
- [x] Retry keeps the saved review and existing panel, coalesces duplicate requests, and retains view state after recovery.
- [x] A real worker-reported failure does not cache a rejected review result.
- [x] Restored analysis failures retain Retry, while missing saved reviews close cleanly.
- [x] Following a relationship to a filtered, paged member brings its row into view, transfers focus and supports Enter to open its diff.

Validation: 50 unit tests plus browser/native VS Code suites pass. The error status, missing retry, off-screen member, restored-panel disposal and long-error clipping regressions each failed before their fixes. Native retry coordination uses a controlled analysis provider; real worker tests separately force malformed-fixture errors and verify cache recovery/tab handling. Browser tests cover retained view state, a filtered 140-member class and a 320×320 error pane. v0.3.6 packaged, installed and reloaded successfully; installed code/styles match the tested build. Windows/remote development remain unvalidated.

## Saved graph tabs (0.3.5)

- [x] Restore a native graph panel from its original saved review without changing the current comparison.
- [x] Close an unavailable saved graph cleanly with recovery guidance.
- [x] Save review identity while analysis is loading and retain selection/camera on repeated graph delivery.
- [x] Restore the actual installed graph tab across a VS Code window reload with search, filter, selection and zoom intact.

Validation on macOS: 49 unit tests and the full browser/native integration suites pass; new missing-restoration, missing-snapshot, loading-identity and repeated-delivery regressions each failed before their implementation changes. Installed v0.3.5 survived a real Developer: Reload Window with search `run`, Removed unchecked, selected `run`, the original snapshot and 120% zoom restored automatically. Test state was then cleared by explicitly closing/reopening the full graph. Installed code and activation metadata match the verified build. Native tests exercise panel restoration; the actual full-window reload was verified manually. Windows/remote development remain unvalidated.

## Small editors and recovery (0.3.4)

- [x] Short stacked graph panes keep Details above the footer and its diff action reachable (600×380 and 320×320).
- [x] Graph change filters wrap instead of clipping in a 220px editor.
- [x] Long branch/agent labels stay contained and actionable in a 220px Comparison panel.
- [x] A failed comparison preserves the active snapshot and releases busy state; a failed send leaves drafts intact and allows a successful retry.

Validation on macOS: 49 unit tests and the expanded Chromium webview/native VS Code suites pass. Both layout failures were reproduced before their CSS fixes and inspected in screenshots. Long-label handling and failure recovery passed as coverage of existing behaviour; recovery tests use a real missing Git ref and actual local CLI delivery after an unavailable-session error. v0.3.4 packaged, installed and reloaded; installed styles/scripts match tested source. Windows/remote development remain unvalidated.

## Graph filtering and keyboard follow-up (0.3.3)

- [x] Expanded member lists obey change filters and keep counts/navigation consistent.
- [x] Filtering a later member page keeps the remaining members visible.
- [x] Selecting a relationship with Space preserves keyboard focus on its label.
- [x] Context shows direct unchanged neighbours and toggles them consistently.
- [x] Escape clears a no-match search without losing focus; empty comparisons clear previous cards and Details.

Validation on macOS: 49 unit tests, the expanded Chromium webview suite, native VS Code integration, JavaScript syntax checks and `git diff --check` pass. Each of the first three regressions was observed before its implementation change. The remaining scenarios passed as coverage of existing behaviour. v0.3.3 packaged and installed; installed graph assets match tested sources, and the packaged worker parsed a smoke fixture without development dependencies. Windows/remote development remain unvalidated.

## Sidebar and interaction polish (0.3.2)

- [x] Single-click graph symbols to inspect Details without losing their button or focus; double-click a member or file overview to request its saved diff.
- [x] Press Enter on a focused graph item to open its diff, and Escape to dismiss Other changes and restore focus.
- [x] Use VS Code dropdown colors, bundled icons, font-relative labels and consistent focus/borders in Comparison; keep Swap beside source controls.
- [x] Show the working-tree folder without repeating Working tree, preserve clear unapplied/busy states, and fit sidebar widths from 220 to 520px.
- [x] Keep the file/comment trees free of repeated comparison summaries and irrelevant action buttons while preserving empty-comparison guidance and the selected agent in Comparison.

Validation on macOS: all 49 unit tests passed; native VS Code integration passed; `npm run test:webviews` passed against Chromium 151.0.7922.34 with Playwright 1.62.1; JavaScript syntax checks and `git diff --check` passed; v0.3.2 packaged and installed. Browser checks run the actual HTML/CSS/JavaScript with a VS Code messaging adapter and cover graph navigation, restored state, untrusted filenames, 10,000-symbol rendering/search, Comparison dirty/busy states, keyboard actions, four theme classes and widths 220/280/360/520px. The installed Quiet Light sidebar was inspected, and double-clicking a graph function opened its captured native diff. Native tests cover the host side of graph requests and original/modified navigation. Windows and remote development remain unvalidated.

## Change graph

- [x] Extract classes, functions, methods and fields from captured TS/JS, Python, C++, Java and C#.
- [x] Classify additions, removals and modifications with exact, non-duplicated line counts.
- [x] Resolve usage links conservatively on both snapshots, including removed usages.
- [x] Retain unsupported, omitted and non-symbol edits as accessible other changes.
- [x] Build in a worker with bounded caches and responsive graph navigation.
- [x] Open a dedicated graph editor with selection context, usage links and stable file/name placement.
- [x] Navigate to exact saved before/after symbol and usage lines in native diffs.
- [x] Verify large comparisons, native editor integration and packaged parser assets.

Version 0.3.0 validation: `npm test` (49 passing tests); native VS Code integration covering the graph editor, exact original-side member navigation, modified-side usage navigation from an earlier graph snapshot, and invalid symbol IDs; `node --check resources/graph.js`; and `git diff --check`. Browser checks use the real graph HTML/CSS/JavaScript and cover member/class counts, forward and reverse usage links, diff messages, HTML-like filenames, search, camera/selection restoration, cyclic links, and bounded rendering/search across 10,000 entities. The worker's 10,000-function fixture completed in about 310 ms cold and 60–80 ms on a refreshed snapshot on this machine. `npm run package` produces v0.3.0; the extracted VSIX includes all eight WASM assets and its worker successfully parses all six languages without development dependencies. Usage resolution is scoped to captured files; runtime dispatch and ambiguous targets remain unresolved. Windows and remote development are not newly validated.

Version 0.3.1 styling checks: all 49 unit tests and native VS Code integration assertions pass. Browser checks against the actual graph resources verify the editor-font fallback, transparent signature styling, bundled Codicons, selection, line counts, usage and diff messages, search, camera restoration, cyclic links, and bounded rendering across 10,000 entities. Light, dark and high-contrast layouts were inspected. A dense-link browser scenario reproduced visible unselected labels, then passed after quieting those labels and keeping card text above connectors. Installed v0.3.1 and verified the graph in the current Quiet Light window.

## Existing review behavior

- [x] Pin branch comparisons to commits and preserve reviewed contents after edits.
- [x] Discover local/remote branches and linked worktrees.
- [x] Compare dirty worktrees, including untracked files and deletions.
- [x] Distinguish exact comparisons from changes since the common ancestor.
- [x] Save comments on either diff side with one-based line ranges and code context.
- [x] Persist feedback until the intended connection acknowledges receipt.
- [x] Reject feedback routed to a different worktree.
- [x] Authenticate bridge calls and isolate repositories/connections.
- [x] Deliver feedback to the actual CLI process waiting in an existing session.
- [x] Recover queued feedback after reloading the persisted review store.
- [x] Keep draft comments intact after a disk write failure.
- [x] Avoid reporting an uninitialized submodule as deleted.
- [x] Compare the dirty contents of two worktrees.
- [x] Open a native diff and create original/modified-side comment threads in VS Code.
- [x] Ignore VS Code toolbar context arguments when selecting comparison options or an agent session.
- [x] Validate the skill and package an installable VSIX.
- [x] Install v0.1.1 and complete a real VS Code → separate Codex chat → native comment reply round trip.
- [x] Group changed files into a nested, naturally sorted file tree with folders first.
- [x] Use file-theme icons and review-specific A/M/D decorations, including deleted files.
- [x] Keep file and folder identities stable across comment updates and comparison refreshes.
- [x] Preserve native diffs, comment counts, previous reviews, and empty-comparison states in the refined sidebar.
- [x] Keep left/right comparison sources visible with explicit apply, swap, and refresh controls.
- [x] Keep comments from every snapshot together, grouped by draft, waiting, ready to review, needs changes, and resolved status.
- [x] Read agent replies directly in the comments queue and navigate to the exact original or modified lines.
- [x] Persist manual needs-changes flags and support resolving, reopening, and clearing the flag.
- [x] Check real saved fixes against the latest comparison without silently resolving the original feedback.
- [x] Send follow-up drafts from an earlier snapshot with their own captured comparison.
- [x] Count open feedback in the activity badge without mixing in changed files.
- [x] Open the native branch picker from Comparison and show the active comparison while a changed selection is unapplied.
- [x] Check panel sizing in a new workspace and jump from the queue to an earlier snapshot's exact line.

Executed validation: `npm test` (16 passing tests), `npm run test:extension` (native VS Code integration assertions passed), the skill-creator validator (valid), and `npm run package` (VSIX produced and installed). Live Codex test batch `cbf54556-e99f-4e8f-a2dc-95203fb64526` delivered the comment on `labels.js`, line 2, after side; acknowledgement and the agent's reply appeared in the native thread. The demo files were not changed by the receiver. Claude/other harness sessions, Windows, and remote development environments remain untested.

Version 0.1.2 UI validation: `npm test` (19 passing tests), `npm run test:extension` (expanded native integration assertions passed), and `npm run package` (VSIX produced). Installed v0.1.2 and reloaded the existing review window. Visually verified the file tree, theme icons, change badges, nested folder expansion, and opening `src/index/indexManager.ts` in a native diff with commenting ranges. Bridge tests require localhost access in the restricted shell.

Version 0.2.0 validation: `npm test` (27 passing tests), `npm run test:extension` (comparison selection state, both diff sides, comments across refreshes, status actions, inline agent replies, real saved-file fixes, and earlier-snapshot follow-up delivery), `node --check resources/comparison.js`, and `git diff --check`. The VSIX was produced and installed. After unlocking macOS, the existing window was reloaded: the comparison controls rendered and a draft from an earlier snapshot appeared in Comments. Visual inspection exposed an undersized Comparison panel and an activity badge combining file and comment counts.

Version 0.2.1 sets initial panel proportions and gives the activity badge to open comments. The badge regression was reproduced as 5 instead of 2, then passed with the fix; the full native integration run exited successfully. The 27 unit tests also pass. Installed and reloaded v0.2.1 in the existing window: the activity badge correctly showed one open comment, the native branch picker opened from the Base control, and swapping sides showed an Apply Comparison button with the still-active comparison labelled. Resizing the existing saved layout exposed all controls. Final visual checks passed in a new workspace with all comparison controls visible. Selecting an earlier-snapshot draft opened its saved right-side line 13, selected the line, and expanded the native thread. Automated native tests also cover navigation on both diff sides and across snapshots; the final integration rerun exited successfully.
