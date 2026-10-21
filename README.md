# Agent Diff Review

Review local branches, remote-tracking branches, commits, and linked worktrees inside VS Code. Open a native diff, leave comments on either side, and send a batch of feedback to the coding agent session you are already using.

The first version uses a local bridge and a dependency-free Node.js script. The agent runs the script through its existing shell tool; feedback returns as that tool's output. A bundled skill explains how to connect, wait, acknowledge feedback, and reply. The extension does not need an agent API key.

**Try it**

1. In VS Code, run **Extensions: Install from VSIX…** and select `agent-diff-review-0.1.2.vsix` from this project.
2. Open a trusted Git repository. Click the **Agent Diff Review** activity-bar icon, then **Start Comparison**.
3. Choose the left and right sources. Pick **Exact differences**, or **Changes since common ancestor** when the left source is a branch/commit. Remote branches reflect the last fetch; **Fetch Remote Branches** updates them explicitly.
4. Expand folders in **Changes** and open a changed file. The tree uses your VS Code file icon theme, with A/M/D badges for added, modified, and deleted files. Hover in the comment gutter or select lines and use **Agent Diff Review: Comment on Selected Lines** from the editor context menu. **Add Comment** saves a draft. Removed lines can be commented on in the left pane.
5. Run **Agent Diff Review: Connect Agent**. It opens the bundled skill and copies a message to paste into your existing agent session. Ask that agent to follow the skill. When its script connects, use **… → Select Agent Session** in the sidebar if more than one is available. The selected session appears above the file tree.
6. Click **Send Review** and optionally add an overall instruction. The agent's waiting command receives the comments and captured code. Its replies appear in the comment threads. You control resolution.

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
- Reviews are immutable. Refresh creates a new review; earlier comments remain with their original code under **Previous reviews**. Comments do not move automatically between versions.
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
