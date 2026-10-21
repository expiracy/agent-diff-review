---
name: agent-diff-review
description: Connect this coding session to the Agent Diff Review VS Code extension, receive the user's inline diff comments, and respond to their feedback. Use when the user asks to link a session or collect feedback through this extension.
---

# Agent Diff Review

Use the bundled script to receive feedback in the current session. Requires Node.js 20+, Git, shell tool access, and Agent Diff Review in a trusted VS Code workspace on the same host. It does not launch another agent or inject prompts into an idle session.

## Connect and receive feedback

1. Resolve `scripts/agent-review.mjs` relative to this skill's directory. Run it with Node from the worktree the agent is editing:

   ```sh
   node <skill-directory>/scripts/agent-review.mjs connect --cwd <target-worktree> --label "Short session label"
   ```

   Keep the returned `connection` value in this session. It identifies this mailbox, not a Claude-specific or other harness-specific conversation ID. If several VS Code windows match, run `discover --cwd <target-worktree>` and connect using the intended `--bridge` ID. Do not guess which window the user is reviewing. A restricted harness may block localhost networking: if VS Code shows its bridge is ready but discovery finds none, use the harness's normal permission flow for loopback access before retrying. Do not keep retrying the same restricted command. Use the same access mode for `wait`, `ack`, and `reply`.

2. Run `wait --connection <connection> --timeout 25` using the same script. The user links the session, reviews the diff, and clicks **Send Review** in VS Code. Use the harness's process-wait tools when available. A `pending` result is a normal timeout: call `wait` again while the user is still reviewing. If the harness must end its turn, explain that receiving feedback needs another `wait` call; do not promise an automatic wake-up.

3. A `feedback` result contains a `batchId`, one-based comment ranges, a `side` (`before` or `after`), pinned comparison metadata, and the immutable before/after contents of the commented files. Retain this feedback in the session, then run:

   ```sh
   node <skill-directory>/scripts/agent-review.mjs ack --connection <connection> --batch <batchId>
   ```

   Feedback is delivered at least once. Without acknowledgement it is returned again, including after a VS Code reload. Do not apply the same batch twice. Retry a failed wait with the saved connection after the workspace reopens; reconnect only if the connection was closed or its storage is gone.

## Act on feedback

Follow the user's requested scope: a question may need an explanation, while a requested fix may need edits and checks. A comment's line numbers refer to its captured snapshot, including removed lines on the `before` side. Read the current file before editing. `afterHash` is the SHA-256 of the captured file bytes; if the current file differs, reconcile the comment with the current code rather than overwriting from the snapshot. Acknowledgement means receipt, not resolution.

Post a concise response for an individual comment when useful:

```sh
node <skill-directory>/scripts/agent-review.mjs reply --connection <connection> --comment <comment-id> --message "What changed or the answer, with actual check results"
```

The reviewer decides when to resolve comments. Continue waiting when another review round is requested or already part of the task. Run `disconnect --connection <connection>` when the review is finished. An extension reload or a tool timeout must not be treated as permission to start an unrelated session.

The script uses a local authenticated bridge and has no package dependencies. `help` lists commands. If VS Code and the agent run in SSH, WSL, or a container, both the workspace extension and the script must run on that same host. Browser-only VS Code and arbitrary remote agent services are outside this first version.
