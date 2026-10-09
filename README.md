# opencode-incognito

Experimental temporary full-size TUI sessions for **OpenCode V2 2.0.26**.
Works with the regular shared server: no `--standalone` or `OPENCODE_DB` needed.

## Installation

Install globally using OpenCode's plugin manager:

```sh
opencode plugin add github:My5z0n/opencode-incognito
```

Restart the OpenCode TUI after installation, then run `opencode` from any project.

## Usage

Press **`Ctrl+Alt+I`** or run **`/incognito`** to create a fresh incognito session
immediately, without a dialog. Every use opens a separate temporary conversation,
including when already in incognito.
It never converts an existing normal conversation into a temporary one.
Switch between it and ordinary sessions using the normal session picker/tabs.
The footer identifies temporary sessions created by this TUI.
An empty incognito session starts with a centered **Temporary chat** heading and
the original OpenCode input field. On the first message, the composer returns to
its regular position at the bottom. Model/agent selection, paste, and attachments
remain handled by OpenCode's native composer.
The landing screen says "History will be deleted when you close this tab." The
**INCOGNITO** footer is hidden there and returns once the conversation starts.

OpenCode generates conversation titles normally; the plugin adds **`[Incognito]`**
in front, for example `[Incognito] Fix login form`. It does not use a permanent
"Temporary session" title.
Click **X on an incognito tab** to immediately request deletion of that session
and its child sessions. Ordinary tab closure still preserves ordinary history.

Global registration is recommended so the server plugin is available when
opening existing sessions in other directories. A project-only installation
does not make the plugin's server RPC available outside that project.

## Local development installation

Clone the repository and install its dependencies:

```sh
git clone https://github.com/My5z0n/opencode-incognito.git
cd opencode-incognito
npm ci
```

Merge this entry into the existing `plugins` array of your global
`~/.config/opencode/opencode.jsonc` or a project's `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-incognito"]
}
```

Do not replace existing configuration or other plugin entries. The directory
can also be specified with a file URL, such as
`file:///C:/code/opencode-incognito` on Windows. The directory
contains both `index.ts` (server) and `tui.ts` (terminal) entrypoints. Both are
required; do not install only the terminal entrypoint in `cli.json`.

## Lifecycle

- `/incognito` and `Ctrl+Alt+I` always create a separate fresh temporary session
  without copying conversation history. There is no toggle or second shortcut.
- Copies the selected model/variant and current session's agent, when available.
- Tracks only explicitly created temporary roots, using random per-TUI ownership.
- Normal TUI exit awaits plugin cleanup, which asks the server to delete those roots.
- Closing an incognito tab (X or the normal close-tab shortcut) immediately deletes
  that individual temporary root. Merely switching tabs does not delete anything.
- If the tab-close request fails, the client retries every two seconds. Once the
  server has recorded closing intent, heartbeats cannot postpone its cleanup.
- OpenCode recursively removes their child sessions and stops active execution.
- The TUI sends a heartbeat every 15 seconds. After 3 minutes without one, the
  server's 30-second sweeper removes abandoned temporary sessions.
- The server persists **IDs, owner tokens and expiry timestamps**, not a second
  transcript. After a server restart, expired leases are retried when that
  location's plugin runtime starts. If the server is offline, cleanup is deferred.
- Deletion failures stay registered for retry. Ordinary sessions, other owners,
  and sessions whose metadata no longer matches ownership are not deleted.

## Important limitations

**Not a zero-trace privacy mode.** Conversations are written to the normal database
while in use. Deletion is not secure erasure of SQLite pages, WAL files, backups,
provider records, logs or other plugins' copies. Files changed by tools remain.

- Closing/killing the terminal may bypass normal cleanup; the lease is the fallback.
- A disconnected or suspended client can lose temporary history after ~3 minutes.
- Removing the plugin disables its fallback sweeper. Deactivating/reloading the
  TUI plugin invokes cleanup and ends temporary sessions.
- Closing a tracked incognito tab or leaving its creating TUI deletes the session,
  even if another client has opened that same session. Only temporary sessions
  created by this plugin instance are monitored for tab-close cleanup.
- Manually forked sessions and independently created sessions are NOT tracked.
  Do not fork a temporary conversation if you want its history removed.
- Only full-screen TUI is supported, not desktop/web, `run`, or CLI `mini`.
- The centered landing uses a reversible native-composer layout adapter tested
  against OpenCode 2.0.26. Future host layout changes may require an update.
- Other plugins, instructions and project tools remain active as normal.

## Development and validation

```powershell
npm install
npm run check
npm test
```

Rendering regression test (requires Bun; uses a real headless OpenTUI renderer):

```powershell
npm run test:render
```

Integration test with a real private OpenCode server and an isolated database:

```powershell
$env:OPENCODE_TEST_BINARY = Join-Path (Split-Path (Get-Command opencode).Source) 'node_modules\@opencode\cli\bin\opencode.exe'
$env:OPENCODE_TEST_TEMP = "$env:LOCALAPPDATA\Temp\opencode"
node --experimental-strip-types test/integration.ts
```

Automatic title generation is tested with a local HTTP mock provider; no external
AI provider receives requests. The test does not connect to the shared service or
delete anything in the normal database. Test artifacts are
retained in the temporary directory for inspection.

Validated: TypeScript check, unit/mocked-TUI tests, real-server plugin loading,
parent/child deletion, ordinary/other-client preservation, repeated cleanup, and
cleanup after manual deletion. A real headless OpenTUI regression test also checks
that the incognito footer mounts inside a box without orphan text, hides when
switching back to an ordinary session, and reacts to closed tabs with a deletion
request. Landing tests verify centering, restoration after the first message,
preservation of the same input control, and small-terminal layout. The real-server
integration test also covers individual tab-close cleanup, owner/sibling isolation,
and native automatic title generation with the incognito prefix. **Interactive TUI shutdown still needs a manual
end-to-end check**; it uses OpenCode's documented async plugin cleanup and the
host's before-exit disposal path.
