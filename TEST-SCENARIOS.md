# First-version scenarios

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
