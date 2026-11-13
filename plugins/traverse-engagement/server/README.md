# traverse-engagement-files (local MCP server)

A small **stdio MCP server**, bundled with the `traverse-engagement` plugin, that
moves document bytes. It is a **bytes-mover only** — it holds no Traverse
credentials and never calls the Traverse API. Claude still orchestrates the
remote flow (`get_upload_target` → `upload_complete` → `submit_engagement`); this
server just stages a source and streams its bytes to the presigned S3 target.

## Why it exists

- **Large files.** The remote `get_upload_target` returns presigned **multipart**
  part URLs for files over the server's threshold. Splitting the file into the
  right byte ranges, PUTting each part, and capturing every ETag is fiddly and
  error-prone in shell; this server does it correctly (`node:https` with an
  explicit `Content-Length` — S3 presigned PUTs reject chunked encoding).
- **Bytes off the model path.** Document content is streamed from disk straight
  to S3. It never rides through the model context (except a small base64 relay
  for connector-sourced files — see below).
- **Secrets stay local.** Presigned URLs and ETags are handled here and are
  never printed to chat or logs (URLs are redacted to a basename).

## Tools

- **`stage_file`** — resolve a source to a real file on disk and report
  `{stagedPath, sizeBytes, sha256, contentType, filename}`. Exactly one of:
  - `path` — an existing local file (referenced in place, no copy).
  - `base64` — inline bytes (small files only; chunk with `appendTo`).

  There is no URL source: the server makes no outbound GET requests. `filename`
  is reduced to a bare file name (any `/` or `\` folder path is dropped), and
  `appendTo` must resolve, through any symlink, to a file inside the staging
  root.
- **`upload_file`** — stream a staged file to the presigned target. Exactly one
  of `uploadUrl` (single) or `parts:[{partNumber,url}]` (multipart). Returns the
  ETag(s) to hand to `upload_complete`. Targets must be https URLs on Traverse's
  S3 document buckets (`src/upload-hosts.ts`), presigned with
  `x-amz-expected-bucket-owner` naming Traverse's staging or production AWS
  account, so S3 itself refuses a lookalike bucket owned by anyone else.
  Anything else is refused before a byte is sent, and redirects are never
  followed.

## Build & test

```bash
cd server
npm install
npm test          # node:test, local http mock — no network
npm run check     # tsc --noEmit
npm run build     # esbuild → dist/index.js (committed)
```

`dist/index.js` is **committed on purpose** — it is what the plugin runs
(`node ${CLAUDE_PLUGIN_ROOT}/server/dist/index.js`, wired in `.mcp.json`).
After editing anything under `src/`, run `npm run build` and commit the updated
bundle. Requires Node 22.23.4, 24.22.1 or 26.12.1 (or newer on the same line) — the 2026-10-21 security releases; the server logs a
warning to stderr on anything older. The patched floors live in
`src/node-version.ts` (and `scripts/setup-traverse.mjs`): update both with each Node
security release.
