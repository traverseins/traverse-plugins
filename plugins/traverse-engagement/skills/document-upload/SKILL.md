---
description: Upload a supporting document to Traverse. Stage the source (a local file, or a small connector file relayed as base64) with the local file mover, then get_upload_target → upload the bytes (single PUT or multipart parts) → upload_complete. Use when uploading client documents or a coverage benchmark for a Traverse engagement, or when handling stage_file / get_upload_target / upload_file / upload_complete. Also defines the broker's approval of the upload list that `create-engagement` and `prep-for-portals` run before a batch, and how a file is added later: one the broker left out, or any file for an engagement that is already submitted.
---

# Traverse document upload

Uploads each supporting document with the **local `traverse-engagement-files`**
MCP server (a bytes-mover that never sees your Traverse credentials) plus the
remote `traverse-engagements` tools. The remote server decides single vs.
multipart from the file size; the local `upload_file` tool handles either. Two
tools live locally (`stage_file`, `upload_file`); the rest are remote.

Requires an authenticated session (see `traverse-auth`).

## Approving the upload list (batch flows)

`create-engagement` and `prep-for-portals` upload a whole set of files rather than
one the broker just named. Each runs this **once per batch, at its own review or
confirmation step, before the first `stage_file`**, and not again when the
per-document flow below begins. `engagement` does not run it.

1. **Start from everything available.** The candidate list is every file the flow
   has gathered. Don't pre-trim it by what you think the markets need.
2. **Show the whole list and get explicit approval.** Number the files, each with
   its name and where it came from, and say that approving uploads them to
   Traverse. Ask one question that a plain "yes" answers, such as *"Upload these
   N files? Say yes, or name any to leave out."* The approval is **mandatory**:
   until the broker has answered it, nothing is staged or uploaded. An answer to a
   different question, such as a coverage sign-off, doesn't count.
3. **Show the list again after any change.** If the broker leaves files out, puts
   a left-out file back, or adds one, apply it, show the whole updated list, and
   ask again. Only a yes to the list as last shown ends this step. If a name could
   mean two files ("the financials"), ask which.
4. **Upload the approved list and nothing else.** It is the only list the
   per-document flow below works from. Don't rebuild it from the folder or the
   conversation, and don't put a left-out file back yourself: it returns only when
   the broker asks (see *Adding a left-out file later*).
5. **Say what was left out, and that it can still be added.** Name each left-out
   file in the final report instead of dropping it silently, for example *"3 of 4
   documents uploaded; financials.xlsx left out at your request. Say the word and
   I'll add it."*
6. **Nothing to upload.** If the list is empty, or the broker leaves everything
   out, say so and ask whether to carry on without documents before anything is
   submitted.

## Adding a left-out file later

The broker can ask for a left-out file by name at any point. That request names the
file, so it needs no second pass over the whole list. It still needs the
confirmation for the step it triggers. What to do depends on how far the run has
got:

- **Before any upload has started.** The file goes back on the list (step 3 above).
- **Uploaded, not yet submitted** (the submit gate in `create-engagement`). Run the
  per-document flow below for the file, add its `documentId` to the ones being
  submitted, and show the submit summary again, with the new count, for a fresh
  "yes".
- **Already submitted.** No tool attaches a document to an existing engagement.
  A new request for the same agency and insured may be folded into a recent
  engagement instead of creating another, so a late file goes in as a follow-up
  request. The same route serves any file a broker wants to add to a submitted
  engagement, in any flow.
  1. **Confirm it in one line**, such as *"Add financials.xlsx to Acme's
     engagement? This uploads it and sends Traverse a follow-up request. Say yes."*
     Wait for the yes.
  2. **Upload the file** with the per-document flow below.
  3. **Call `submit_engagement` again.** Send the first request unchanged
     (`broker`, with `agencyOrgId` on a service key, `client`, `coverages`,
     `respondBy`, `targetEffective`, the insured identifier and `brokerNotes`), so
     Traverse reads it as the same agency and insured, with three differences:
     `documentIds` holds **only the files being added**; `idempotencyKey` is
     **new**, the first submit's key followed by `-add-` and the first new
     `documentId`; and `integrationReferenceId` is **left out**. The first key
     would be read as a retry of the first request, and the file would be attached
     to nothing. A second engagement sharing the first one's
     `integrationReferenceId` would make lookups ambiguous. The first request's
     values are in `engagement.json` or in the session. If they are no longer in
     front of you, ask the broker and don't rebuild them.
  4. **Check where it landed.** Read the engagement back with `get_engagement` on
     the **first** submit's `engagementRequestId` and look for the file in its
     `documents`. The follow-up is processed asynchronously, so if the file isn't
     listed yet, back off and retry a few times (`engagement_not_found` and
     `engagement_not_ready` just after a submit are normal). Listed: say it is on
     the engagement. Still missing: say the follow-up was submitted, give its
     `engagementRequestId`, and say it isn't confirmed on the engagement, since
     Traverse may have filed it separately, for example when the first request is
     no longer recent. Don't submit again.

## Per-document flow

Do these in order for each file, and collect every `documentId` so the
engagement skill can pass them to `submit_engagement`.

### 1. Stage the source → know its size first

`get_upload_target` needs the byte size to pick the upload mode, so resolve the
source to a local file before calling it. Call the local **`stage_file`** tool
with exactly one source:

- **Local file** — `stage_file { path: "/abs/path/loss-run.pdf" }`. Referenced
  in place (no copy). You may skip staging if you already know the exact
  `sizeBytes` and `contentType` of a local path. **This is the preferred path.**
- **A file from a connected share (Google Drive, OneDrive, …)** — see the two
  cases below.

`stage_file` returns `{ stagedPath, sizeBytes, sha256, contentType, filename }`.
`filename` is always a bare file name: `stage_file` drops any folder path from
it.

There is no URL source. `stage_file` doesn't download anything, so a share or
download link has to be saved to disk first and staged by `path`.

> **Connector files: pull to disk first (Cowork), base64 only as a last resort.**
> If you have a local working directory (e.g. a Cowork session, or the project dir
> created by the `create-engagement` skill), **download the connector file onto
> disk** and then `stage_file { path }`. Disk-staged files stream straight to S3
> by reference, so there is **no size limit** — this is how large connector
> documents (SOVs, loss runs) should be handled. Only when there is no local
> project to write to, fall back to relaying small files inline:
> `stage_file { base64: "<...>", filename: "policy.pdf" }` (chunk large content
> with `appendTo` — but base64 travels through the model context, so it is for a
> few MiB at most). A large connector file with no disk to stage into has no good
> path: ask the broker to save a local copy.

> **Confirmation gate (download from a connected share):** before pulling a file
> out of a broker's Drive/OneDrive, confirm with them which file(s) to take. Do
> not enumerate or download share contents unprompted.

### 2. Get an upload target

Call `get_upload_target` with the `filename`, the MIME `contentType`, and
**always** `sizeBytes` (from step 1). It returns an opaque `documentId` plus one
of:

- **Single** — `uploadKind: "single"`, a short-lived `uploadUrl`, and `expiresAt`.
- **Multipart** — `uploadKind: "multipart"`, `parts: [{ partNumber, url }]`,
  `partCount`, `minPartSizeBytes`, `suggestedPartSizeBytes`, and `expiresAt`.

### 3. Upload the bytes with `upload_file`

Call the local **`upload_file`** tool with the staged `path`, the same
`contentType` you passed to `get_upload_target`, and the target from step 2:

- **Single** — pass `uploadUrl`. Returns `{ ok: true, mode: "single", etag, sizeBytes }`.
- **Multipart** — pass `parts` (the `[{ partNumber, url }]` array verbatim).
  Returns `{ ok: true, mode: "multipart", sizeBytes, partSizeBytes, parts: [{ partNumber, etag }] }`.

`upload_file` streams from disk (it never buffers the whole file), splits
multipart byte ranges correctly, and captures each ETag. It never prints the
presigned URLs.

### 4. Signal completion

- **Single** — `upload_complete { documentId }`.
- **Multipart** — `upload_complete { documentId, parts }`, passing the
  `[{ partNumber, etag }]` array from `upload_file` **verbatim** (ETags keep their
  quotes). Completion is idempotent.

Collect the `documentId` for `submit_engagement`.

## Failure handling

**Two failure shapes appear in this flow — check the right one.** The local
tools (`stage_file`, `upload_file`) return `{ ok: false, … }`. The remote tools
(`get_upload_target`, `upload_complete`, `submit_engagement`) return the standard
envelope `{ status: "error", error_code, message }`. Branch on `ok` for the
first two and on `error_code` for the rest; never read `error_code` off a local
result.

Remote `error_code`s on this path:

| `error_code` | What to do |
| --- | --- |
| `upload_target_expired` | Presigned URLs expire ~30 minutes after minting. Re-run `get_upload_target` for that file — it issues a **new `documentId`** and fresh URLs — then re-upload and use the new `documentId` everywhere afterward. |
| `document_not_ready` | The bytes never landed, or `upload_complete` has not succeeded. Re-upload before referencing the document. |
| `document_not_found`, `document_not_owned` | The `documentId` is stale or was minted in another session. Re-mint with `get_upload_target` and re-upload. |
| `size_rejected`, `content_type_rejected` | The file itself is refused. Do not retry — tell the broker which file and why. |
| `validation_failed` | The message names the offending argument (e.g. a malformed `parts` entry). Fix and retry. |
| `rate_limited` | Back off, then retry. |
| `downstream_failure` | Transient — retry once, then report it. **Except from `get_upload_target`**, which already retried a documents-service 5xx up to 3 times with backoff before answering. That one is an exhausted call, not a blip: report it rather than immediately re-calling. |
| `unauthenticated` | Re-run `authenticate`; if it persists, follow `traverse-auth`. |

- **Per-file retry policy.** If a file fails to upload, re-request its target and
  retry once. If it still fails, ask the broker whether to proceed **without**
  that file rather than silently dropping or blocking it.
- **`get_upload_target` self-heals a server-side blip.** It retries a
  documents-service 5xx internally (3 attempts, exponential backoff) and only
  then returns `downstream_failure`, so a wobbling service is usually invisible
  to you. A 4xx is never retried — a rejected content type or payload fails the
  same way every time. `upload_complete` and `submit_engagement` do **not**
  self-retry, so "retry once" still applies to them.
- Verify `upload_file` returned `ok: true` before calling `upload_complete`.

## Guidance

- Never print presigned `uploadUrl`s, part URLs, or the API token to chat or a
  file — they are short-lived secrets. `upload_file` already keeps them local.
- **Fallback (single-PUT only):** if the local server can't start, a small file
  can still be uploaded with a plain streamed `curl -X PUT --upload-file <file>
  -H "Content-Type: <contentType>" "<uploadUrl>"`. There is no shell fallback for
  multipart — use `upload_file`.
