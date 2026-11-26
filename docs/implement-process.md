# From report to shipped fix (admin page)

Works only on the server's own device at `localhost:8000`. Each report with a run shows which step it is on.

| Step | What happens | You do | Move on when |
|---|---|---|---|
| 1 Implement | Claude edits the working tree. The log is live. It doesn't commit, restart or resolve. | Press **🤖 Implement**. One run at a time; stops after 60 minutes. | The run ends. |
| 2 Restart & try it | A banner appears if Python files changed since the server started. Changes under `static/` only need a page reload. | Press **🔁 Restart dev server**, then play the change. | It does what the report asked. |
| 3 Review, commit & push | **✅ Resolve…** shows the files, the diff, the commit message and any older commits the push would send. | Untick files that aren't part of the fix, edit the message, press **⬆️ Commit, push & resolve**. | The push succeeds. |
| 4 Resolved | The report is marked done. | Nothing. | |

## If it isn't right yet

- **Small fix:** press **📋 Copy resume command** and carry on in a terminal after the run has ended. Then restart if asked, and review again. New edits to the run's files are included. Files the run never touched are not: commit those by hand.
- **Another attempt:** add a note on the report and press **🤖 Implement again**. The earlier run's uncommitted changes stay part of the commit.
- **Give up:** revert the files by hand. Nothing on the page undoes a run.

## What Resolve does

1. Commits only what changed since the run started, applied on top of `HEAD`. Uncommitted work that was there before stays
   uncommitted, even in the same file.
2. Pushes the current branch to its upstream. A push sends every unpushed commit, so the review lists them first.
3. Marks the report done, only after the push succeeds. If the push fails, the commit is kept: fix the cause and press
   **✅ Resolve…** again to push.

It refuses when:

- a run is still going;
- files or commits changed after the review (review again);
- the run's changes build on uncommitted work, so they can't be committed alone (commit that work first);
- the branch has no upstream.

## Limits

- A file's changes made by someone else **while the run was going**, or later in a file the run touched, can't be told apart
  from the run's. Check the file list and the diff; you can untick whole files, not single lines.
- If the commit leaves out files or earlier uncommitted work, that exact commit has never been run on its own.
- Nothing here runs tests or checks that `CACHE` in `static/sw.js` was bumped.
- Pushing doesn't deploy to the Droplet, and resolving here doesn't change that server's inbox.
- **✅ Resolve only** and the bulk **Resolve** button mark reports done without committing anything.
- The restart button works only for a server started with `bash start.sh`. It checks that the new code imports before it
  stops the old server, and it is disabled while a run is going.
