# traverse-engagement

Guides a broker through creating a Traverse insurance placements engagement:
gather client details and placement objectives, analyze documents against an
agency coverage benchmark to recommend limits/retentions/terms, upload the
supporting files, and submit the engagement. Traverse then generates tailored
submission emails to carriers, and the plugin can read the engagement back to
track submissions, quotes, and open tasks.

The plugin is self-contained: it declares no plugin dependencies, so it loads
the same way in the CLI, the Code tab, and Cowork (which does not install
dependencies).

## Install

**In the CLI or the Desktop app's Code tab:**

```
/plugin marketplace add traverseins/traverse-plugins
/plugin install traverse-engagement@traverse-plugins
```

**In Cowork** — the recommended surface, because the `new-engagement` flow uses
your workspace connectors. A CLI install does not reach Cowork. Open the **Cowork**
tab → **Customize** → **Plugins**, then either install it from your
organization's plugin catalog, or add the marketplace yourself with **+** →
**Add marketplace** in the Personal plugins section, entering
`traverseins/traverse-plugins`.

**For a whole organization** — Claude does not accept a public repository as an
organization marketplace, so an admin uploads the plugin's zip instead, from the
[releases page](https://github.com/traverseins/traverse-plugins/releases), under
**Organization settings** → **Plugins & skills**.

## Credentials

The plugin needs your Traverse API key. Claude reads it only when it starts, and
if you open the Desktop app or Cowork from the app icon you never see a shell to
`export` it in. The setup script saves it for you.

### Set it up with the script (recommended)

Open a terminal window (Terminal on macOS, PowerShell on Windows) and run:

```bash
node "<plugin root>/scripts/setup-traverse.mjs"
```

It asks for your API key (what you type is hidden), then for a few optional
settings (press Enter to skip any of them), shows a summary with the key masked,
and saves once you confirm. It needs Node 22.23.4, 24.22.1 or 26.12.1 (or newer on the same line), as the plugin itself does,
and nothing else; on an older Node it warns but still saves.

**Finding `<plugin root>`.** It is the `traverse-engagement` folder that holds
`scripts/`, `skills/` and `.mcp.json`. Where it sits depends on how the plugin
reached your computer. Typically:

| Installed through | Plugin root |
| --- | --- |
| Cowork, or your organization's plugin catalog (synced from claude.ai) | `~/.claude/plugins/synced/<id>_<id>/traverse-engagement` |
| `/plugin install` in the CLI or the Desktop app's Code tab | `~/.claude/plugins/cache/traverse-plugins/traverse-engagement/<version>` |

`~` is your home folder (`C:\Users\<you>` on Windows). Folders whose names start
with a dot are hidden in Finder and File Explorer, so the easiest way to get the
exact path is to let the terminal find the script:

```bash
# macOS / Linux
find ~/.claude/plugins -name setup-traverse.mjs
```

```powershell
# Windows PowerShell
Get-ChildItem "$env:USERPROFILE\.claude\plugins" -Recurse -Filter setup-traverse.mjs | Select-Object -ExpandProperty FullName
```

Then run `node "<the path it printed>"`. If it prints several, any of them works;
prefer the one with the highest version number. Keep the quotes if the path
contains spaces. The script is one file with no dependencies, so a copy saved
anywhere works too.

When it finishes, **fully quit the Claude desktop app and open it again** (choose
Quit; closing the window isn't enough), because the key is read only when the
plugin's servers start. Then, in Cowork, ask Claude to "authenticate to Traverse"
to check that the key works.

What it does to `~/.claude/settings.json` (`%USERPROFILE%\.claude\settings.json`
on Windows): it sets only the Traverse entries in the `env` block, and leaves
every other setting alone. It saves a timestamped backup first
(`settings.json.bak-YYYYMMDDHHMMSS`), keeps only the three newest backups because
they contain your key, and writes the file atomically. If the file isn't valid
JSON it stops and changes nothing. Running it again is safe. Add `--help` to see
every option.

### Set it up by hand (fallback)

Set these before launching Claude Code — they are read at MCP-server startup
(see the `traverse-auth` skill):

```bash
export TRAVERSE_API_KEY="<key from the Traverse console>"
```

If you open the Desktop app or Cowork from the app icon and never see a shell,
put it in `~/.claude/settings.json` instead:

```json
{
  "env": { "TRAVERSE_API_KEY": "<key from the Traverse console>" }
}
```

Add the `env` entry next to whatever the file already holds; don't replace the
file. It has to be the user-level file: a project-level `.claude/settings.json`
did not reach the plugin in testing.

That is the only required setting — the plugin defaults to the production
engagements service. To work against staging instead, also set the full
endpoint URL, path included (the plugin appends nothing to it):

```bash
export TRAVERSE_BASE_URL="https://mcp-engagements.staging.trytraverse.com/mcp"
```

If you set `TRAVERSE_BASE_URL` before 1.13.0 it held an origin only. Add the
path (or unset it to use production), otherwise the server will not connect.

Optionally point the coverage analysis at your agency benchmark document, and
(for Salesforce account extraction) set your org alias / AMS-id field:

```bash
export TRAVERSE_COVERAGE_BENCHMARK="/path/to/agency-coverage-benchmark.pdf"
export SF_ORG_ALIAS="my-sf-org"              # optional; defaults to the default sf org
export SF_ACCOUNT_ID_FIELD="AMS_Account_Id__c"  # optional; the SF field holding the AMS id
```

### IT / MDM rollout

`--non-interactive` never prompts. The key comes from a file or from standard
input. It can't be passed as a command-line argument, because it would end up in
shell history and in process listings.

```bash
# macOS / Linux: the key was delivered to a file; production is the default
node setup-traverse.mjs --non-interactive --key-file /path/to/traverse-key.txt

# the key piped in from a secrets tool, pointed at staging
<your secrets tool> | node setup-traverse.mjs --non-interactive --staging
```

```powershell
# Windows PowerShell
node .\setup-traverse.mjs --non-interactive --key-file C:\ProgramData\Traverse\key.txt
```

- Run it **as the signed-in user**, not as root or SYSTEM. The settings live in
  that user's home folder, and another account would write to the wrong one.
- Try `--dry-run` first. It prints what would be saved, with the key masked, and
  writes nothing.
- Other options: `--staging`, `--production` (removes any saved service address),
  `--base-url <full endpoint URL>`, `--benchmark <file>`, `--sf-org-alias <alias>`,
  `--sf-account-id-field <field>`, and `--remove` (deletes everything the script
  manages).
- Exit code `0` means done, including "nothing to change". Anything else means
  nothing was saved: `2` an option or value was rejected, `3` the existing
  settings file can't be used (for example it isn't valid JSON), `4` it could not
  be written, `5` the run was cancelled.
- With no `--key-file`, the script reads the key from standard input. A launcher
  that leaves standard input open but sends nothing makes it wait (after two
  seconds it says so), so give it `--key-file` in that case.
- Delete the key file once it has been applied, and keep it readable by that user
  only.
- The user still has to quit and reopen the Claude desktop app before the key
  takes effect.

## Use

**In a Cowork session (recommended)** — start a new engagement as a project. The
skill creates a working directory, pulls the client's materials in from connected
sources (Google Drive, OneDrive/SharePoint, Gmail/Outlook attachments, Salesforce)
and local files, analyzes coverage, **pauses for your approval** of the coverage
and of the list of documents to upload, uploads the approved documents, and
submits:

```
/traverse-engagement:new-engagement Acme Mfg GL/Property renewal
```

**Anywhere else** — run the flow directly against documents you already have:

```
/traverse-engagement:engagement Acme Mfg GL/Property renewal
```

Both authenticate, gather client info and objectives, recommend coverages from
your documents and benchmark, pause for approval, upload the documents, and submit
the engagement.

**Hand a drafted submission email to Traverse** — after you have reviewed the
client, assessed their needs, and had Claude write the market-submission email in
a Cowork session, run:

```
/traverse-engagement:prep-for-portals
```

It creates the engagement from the final email (sent as `brokerNotes`) and the
client information already in the session, **confirms once** before anything
leaves (the summary lists every document you added to the session, and you
approve that list or take files off it), uploads the documents you approved, and
reports `<Client> engagement created on Traverse. Ready for portal assistant
use.` It asks only for what the session is missing (typically the insured's
website or registration number, or a respond-by date) and never invents them.

**Check on an engagement** — where the placement stands, which markets have
responded, what quotes have come in, and what is still open:

```
/traverse-engagement:status Acme Mfg
```

## Reading an engagement back

`submit_engagement` returns `{ engagementRequestId, status, receivedAt }`, plus
`integrationReferenceId` when one was supplied. **The `engagementRequestId` is
the handle to keep** — every read tool accepts it wherever an `engagementId` is
asked for. In a Cowork project it is written to `engagement.json`.

There is deliberately **no** `engagementId` in that response. Which engagement
the request resolves to is not knowable at submit time: the request is processed
asynchronously and Traverse may extend a recent engagement for the same agency
and insured rather than create a new one, so any id returned at submit would be
a guess that breaks on exactly those paths. The real id arrives with the first
successful read — `engagement_id` on a `get_engagement` payload, or a row from
`get_engagements`.

Two consequences worth knowing:

- **A just-submitted engagement is not readable immediately.** Reads return
  `engagement_not_found` — or `engagement_not_ready`, once it exists but has no
  agency resolved yet — until asynchronous processing creates it. Both are
  normal; neither means your credentials are wrong. The status skill backs off
  and retries rather than reporting a failure.
- **Change detection lives on submissions and tasks, not the engagement.** Poll
  with `include: ["submissions"]` and `get_engagement_tasks`, and compare
  `updated_at` / `updatedAt` against the previous read. A task's `updatedAt` is
  null until it is first modified, so a null becoming a timestamp is itself a
  change.

An engagement can also carry an `integrationReferenceId` — your own id for it in
your own system — which then works as a lookup key on `get_engagement`,
`get_engagement_tasks`, and as a filter on `get_engagements`. Supply it
at submit time if you want one; the plugin passes through exactly what you type
and **never invents a value**, because a fabricated reference is permanent on the
engagement and resolves to nothing on your side. Use something unique to the
placement rather than to the client: an account-level id gets reused across
future engagements and makes the lookup ambiguous.

## Prerequisites

- **Node 22.23.4, 24.22.1 or 26.12.1 (or newer on the same line)** — the bundled local file-mover MCP server runs on `node`, and so
  does the credential setup script. These are the
  [2026-10-21 Node.js security releases](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases);
  on anything older both of them print a warning.

## Contents

- `.mcp.json` — two MCP servers: the remote `traverse-engagements` (HTTP,
  `X-Traverse-API-Key` auth) and the local `traverse-engagement-files` (stdio
  bytes-mover).
- `commands/new-engagement.md` — the `/traverse-engagement:new-engagement`
  Cowork-project orchestrator.
- `commands/engagement.md` — the `/traverse-engagement:engagement` orchestrator.
- `commands/status.md` — the `/traverse-engagement:status` read/track command.
The three skills each command fronts are `user-invocable: false` — they are
model-invoked only, so the command is the single entry point and the `/` menu
lists one name per flow rather than two:

- `skills/create-engagement` — Cowork-first: create a project working directory,
  acquire materials from connected sources + local files, then run the flow.
  Reached via `/traverse-engagement:new-engagement`.
- `skills/engagement` — the end-to-end flow (no project setup). Also carries the
  shared `error_code` table every other skill refers to. Reached via
  `/traverse-engagement:engagement`.
- `skills/engagement-status` — read a submitted engagement back: submissions,
  quotes, and tasks. Reached via `/traverse-engagement:status`.

`skills/traverse-conventions` holds the output rules the other skills follow. It
is also `user-invocable: false`, since only those skills use it.

These four have no fronting command and stay directly invocable, because each is
useful on its own:

- `skills/prep-for-portals` — create an engagement from the market-submission
  email drafted in the session, upload the session's documents, and report it
  ready for the portal assistant. Invoke it as
  `/traverse-engagement:prep-for-portals`.

- `skills/coverage-analysis` — recommend limits/retentions/terms from documents.
- `skills/document-upload` — stage → get target → upload (single/multipart) →
  complete. Also the upload-list approval that `create-engagement` and
  `prep-for-portals` run first, and how a left-out file is added later, even
  after submit.
- `skills/traverse-auth` — credentials, environment selection, and auth-error
  troubleshooting.
- `scripts/sf_extract_account.sh` — extract a Salesforce Account to the project.
- `scripts/setup-traverse.mjs` — save your credentials into the `env` block of
  `~/.claude/settings.json` (see **Credentials**). Its tests are
  `scripts/setup-traverse.test.mjs`: `node --test scripts/setup-traverse.test.mjs`.
- `server/` — the local `traverse-engagement-files` MCP server (Node/TypeScript;
  committed `dist/index.js`). See `server/README.md` to build and test it.

## Notes

- The broker must explicitly approve coverage recommendations before the
  engagement is submitted. In the Cowork flows (`new-engagement`,
  `prep-for-portals`) the broker also approves the full list of documents before
  anything is uploaded, and only the approved list is uploaded. A file left out
  can be added at any point, including after submit, as a follow-up request that
  Traverse may fold into the recent engagement.
- **With a `TRAVERSE_SERVICE` key**, every flow asks for the broker's name and
  email and the agency's org id before submitting, and never fills them in from
  the session. A service key belongs to no agency, so without them the
  engagement would be filed with no agency and no real broker. After submitting,
  the flow checks the engagement is listed under that agency before reporting
  success. An agency key needs none of this: its agency and broker come from the
  session. The rules live in the `traverse-auth` skill.
- Documents upload via the local `upload_file` tool, which streams bytes from
  disk to the presigned S3 target. Large files use presigned **multipart** part
  URLs automatically (chosen by the remote server from the file size); smaller
  files use a single presigned PUT. Presigned URLs are handled locally and never
  printed to chat.
- In a Cowork session, connector documents are pulled onto local disk in the
  engagement project and uploaded from disk — so large connector files have no
  size ceiling. The base64 relay (bytes through the model context) is only a
  small-file fallback for contexts with no local project to stage into.
