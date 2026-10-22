# Agent Diff Review

Review local branches, remote-tracking branches, commits, and linked worktrees inside VS Code. Open a native diff, leave comments on either side, and send a batch of feedback to the coding agent session you are already using.

The first version uses a local bridge and a dependency-free Node.js script. The agent runs the script through its existing shell tool; feedback returns as that tool's output. A bundled skill explains how to connect, wait, acknowledge feedback, and reply. The extension does not need an agent API key.

**Try it**

1. In VS Code, run **Extensions: Install from VSIX…** and select `agent-diff-review-0.2.0.vsix` from this project.
2. Open a trusted Git repository and click the **Agent Diff Review** activity-bar icon. The **Comparison** panel keeps the left and right sources visible above the changed files.
3. Click **Base · left side** or **Compare · right side** to choose a branch, worktree, or revision. Choose **Exact differences** to compare the selected states directly, or **Branch changes** to see changes introduced on the right since the common ancestor. Use **⇄** to swap sides, then **Compare** or **Apply Comparison** to update the diff. An unapplied selection leaves the shown comparison clearly labelled. Remote branches reflect the last fetch; **Fetch Remote Branches** updates them explicitly.
4. Expand folders in **Changes** and open a changed file. The tree uses your VS Code file icon theme, with A/M/D badges for added, modified, and deleted files. Hover in the comment gutter or select lines and use **Agent Diff Review: Comment on Selected Lines** from the editor context menu. **Add Comment** saves a draft. Removed lines can be commented on in the left pane.
5. Click **Connect an agent…** in Comparison, or run **Agent Diff Review: Connect Agent**. It opens the bundled skill and copies a message to paste into your existing agent session. Ask that agent to follow the skill. Use **… → Select Agent Session** to choose among connected sessions. The selected session appears in Comparison.
6. Use **Send Review** in **Comments** and optionally add an overall instruction. The agent's waiting command receives the comments and captured code. Comments from older snapshots can be sent from their context menu; when several snapshots have drafts, Send Review lets you choose which one to send.

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
npm run package
```

`npm test` compiles TypeScript and exercises real temporary Git repositories, persisted reviews, local HTTP authentication, worktree/session isolation, and a separate CLI process. `npm run test:extension` opens an isolated VS Code profile and exercises native diffs, original/modified-side comments, script delivery, agent replies, and thread resolution. It uses the installed macOS VS Code when available; set `VSCODE_EXECUTABLE` to another installation, or let the test runner download VS Code. Tests do not install into your normal VS Code profile.

To develop interactively, run **Run Agent Diff Review** with F5, then open a Git repository in the Extension Development Host. Native editor integration follows Microsoft's [diff command](https://code.visualstudio.com/api/references/commands), [virtual document API](https://code.visualstudio.com/api/extension-guides/virtual-documents), and [comment sample](https://github.com/microsoft/vscode-extension-samples/tree/main/comment-sample).
