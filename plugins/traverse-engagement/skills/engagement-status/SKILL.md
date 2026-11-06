---
description: Read a submitted Traverse engagement back — its status, the carrier submissions, quotes, and open tasks. Use when a broker asks what is happening with an engagement or placement, whether the carriers or markets have responded, whether any quotes have come in, what is outstanding or waiting on them, or runs /traverse-engagement:status. Also use to check on an engagement just submitted, or to look one up by engagementId, engagementRequestId, or integrationReferenceId.
# Entry point is /traverse-engagement:status; this skill is model-invoked only.
user-invocable: false
---

# Traverse engagement status

Reads an existing engagement back from the `traverse-engagements` MCP server:
where the placement stands, which markets have been submitted to, what they have
quoted, and what tasks are open. This is the read half of the workflow the
`engagement` and `create-engagement` skills write.

Requires an authenticated session — call `authenticate` first (see
`traverse-auth`). All tools here are on the remote `traverse-engagements` server.

## 1. Identify the engagement

Pass **exactly one** of these to `get_engagement` or `get_engagement_tasks` —
both take the same pair. Both keys, or neither, is a `validation_failed` error.

- **`engagementId`** — accepts either the `engagementRequestId` that
  `submit_engagement` returned, or a real engagement id (from `get_engagements`,
  or the `engagement_id` on a previous read). Both resolve to the same
  engagement. Normally only the request id has been stored, because
  `submit_engagement` does not return an engagement id at all.
- **`integrationReferenceId`** — the broker's or an integrating party's own
  identifier, when one was supplied at creation. Use it only as a value someone
  gives you or that you read back from a stored record; **never construct one to
  search with.** A guessed reference either misses or, worse, hits somebody
  else's engagement.

In a Cowork project, read these out of the project's `engagement.json` rather
than asking the broker for them — expect `engagementRequestId` to be the one
that is populated.

If you have no id, list first: `get_engagements` returns
`{ engagements: [...] }`, each row `{ engagementId, agencyName, insuredName }`,
plus `integrationReferenceId` when the engagement has one. It is automatically
scoped to the agencies the broker is a contact of. Present the candidates and
let the broker pick.

> **A row's `engagementId` can be `null`** — that engagement has not been
> assigned an id yet, so it cannot be read by id. Do not pass the null on to
> `get_engagement`. Such a row is still worth showing (the insured name may be
> the one the broker wants), but say it is still being created and re-list
> shortly rather than trying to open it.

> An `integrationReferenceId` that matches more than one engagement returns
> `validation_failed` rather than picking one — the value is caller-supplied, so
> nothing guarantees it is unique. Fall back to `get_engagements` with that same
> reference as a filter and let the broker choose.

## 2. The window right after submit

**A just-submitted engagement is not readable yet.** The submission is processed
asynchronously, so the first reads fail by design, with **either** of two codes:

- `engagement_not_found` — nothing has been created for the request yet.
- `engagement_not_ready` — the engagement exists but has no agency resolved yet,
  so access cannot be checked. This one says nothing about your credentials:
  **do not re-authenticate and do not report an auth problem.**

Treat both identically. Retry with backoff — roughly 5s, then 15s, then 30s —
before telling the broker anything is wrong. Say what is happening ("still
processing") rather than reporting a failure.

If it is still missing well past that, stop polling and report it as a real
failure. `submit_engagement` returning `received` only guarantees the request was
accepted for processing, not that an engagement was created, so a permanent
not-found is a Traverse-side problem rather than a wrong id. Give the broker the
`engagementRequestId` to escalate with — it is the only handle support can
correlate on.

## 3. Read the engagement

`get_engagement { engagementId }` returns the email-builder payload —
`engagement_id`, `session_id`, `email`, a namespace-keyed `data` object,
`documents`, and `integration_reference_id` when one was supplied — plus a
compact `submissions` list, one entry per submission as
`{ submissionId, marketName, linesOfBusiness, status }`.

That compact list is the right default. Summarize it for the broker: which
markets, which lines, and where each stands.

### Optional joins

`include` selects richer joins. Supported tokens — anything else is
`validation_failed`:

| Token | Returns |
| --- | --- |
| `submissions` | The **full** submission records, each with `created_at` / `updated_at`, *instead of* the compact list |
| `tasks` | The engagement's tasks inline |
| `submission_quote_summary` | A per-submission quote rollup |
| `submission_quotes` | Every quote in full — **unbounded**, see below |

## 4. Tasks

`get_engagement_tasks { engagementId | integrationReferenceId, status? }`
returns `{ engagementId, tasks }`, each task as
`{ taskId, title, details, status, assignedTo: {name, email}, createdAt,
updatedAt, origin, sourceType, sourceId }`.

- `status` filters on `OPEN`, `IN_PROGRESS`, `AWAITING_RESPONSE`, `RESOLVED`,
  `CANCELLED`.
- `updatedAt` is the change-detection field, and it is **null until the task is
  first modified** — a null means "untouched since creation", not "no data".
  `createdAt` never moves. So a task's last activity is `updatedAt` when set and
  `createdAt` otherwise; use that when ordering or reporting "most recent".
- `origin` is a one-sentence statement of what email or actor initiated the task
  (null on older tasks).
- `sourceType` / `sourceId` name the domain object the task came from — e.g.
  `QUOTE` plus the quote id for subjectivity tasks.

> **The `engagementId` it returns is the *resolved* one.** Pass an
> `engagementRequestId` and you get the **real** engagement id back — they will
> not match, and that is not an error. This is the cheapest way to learn the real
> id after a submit, so in a Cowork project write it into `engagement.json`'s
> `engagementId` the first time a read returns it.

Identify the engagement exactly as for `get_engagement`: **exactly one** of
`engagementId` or `integrationReferenceId` (§1). So an integration reference can
go straight here — no need to resolve it to an engagement id first.

Open tasks are usually what the broker actually wants: what is waiting on them.

## 5. Drill into a submission

- `get_submission { submissionId }` — the full submission record (orgs,
  coverage/LOBs, status, materials, timestamps) plus a `quote_summary` rollup
  `{ quote_count, latest_quote_id, latest_status, premium,
  latest_quote_updated_at }`.
  - `premium` is the carrier's premium **as stated — a plain string**, not a
    `{ amount, currency }` object. Report it verbatim; do not parse it into
    parts or reformat it.
  - `latest_status` is one of `RECEIVED`, `INDICATED`, `NEGOTIATING`, `QUOTED`,
    `BIND_REQUESTED`, `BOUND`, `WITHDRAWN`, `EXPIRED`.
  - `latest_quote_updated_at` is the rollup's change-detection field.
- `get_submission_quotes { submissionId }` — the full quotes, with identifying
  context. A submission with nothing extracted yet returns an empty `quotes`
  array.

`submissionId` is the composite `<engagementId>:<sqid>` exactly as it appears in
the submissions list — do not construct it by hand.

## 6. Checking back over time

To detect what moved since a previous read:

1. `get_engagement` with `include: ["submissions"]` and compare each
   submission's `updated_at` against the last read.
2. `get_engagement_tasks` and compare each task's `updatedAt` against the last
   read — a task is new if its `taskId` was absent before, and changed if
   `updatedAt` differs, **including a null that has become a timestamp**. That
   transition is a task's first modification, so treating null as "nothing to
   compare" silently misses it.
3. Only for a submission whose timestamp changed, call `get_submission_quotes`.

Compare against the *previous read*, not against wall-clock time. Both fields
are server-set, and nothing guarantees a read happens on any schedule.

**Never poll with `include: ["submission_quotes"]`.** It is unbounded and there
is no pagination, so the payload grows with every quote on the engagement.

Engagements themselves carry **no** `updated_at` — only submissions and tasks do.
There is nothing on the engagement to diff, which is why change detection goes
through those two.

## Field casing differs by tool

This will bite otherwise:

- `get_engagement` returns the **snake_case** email-builder projection —
  `engagement_id`, `session_id`, `integration_reference_id`, `documents`, and
  `created_at` / `updated_at` on included submissions.
- `get_engagements` rows and `get_engagement_tasks` are **camelCase** —
  `engagementId`, `integrationReferenceId`, `createdAt`, `updatedAt`.

Read the shape the tool actually returned; do not normalize one into the other
and then read the wrong key back.

## Errors

Failures use the standard envelope — see the **Errors** table in the
`engagement` skill. The ones that matter most here:

- `engagement_not_found` — expected right after submit (§2); otherwise the id is
  wrong.
- `engagement_not_ready` — **also expected right after submit** (§2). The
  engagement has no agency resolved yet, so access cannot be checked. It is
  about the engagement, not the broker's credentials — back off and retry, do
  not re-authenticate, and do not tell the broker their access is wrong.
- `submission_not_found` — the `submissionId` is wrong. Copy it verbatim from
  the submissions list (§5); a hand-built one will not resolve.
- `not_authorized` — the broker is not a contact of that engagement's agency.
  Do not retry; say so.
- `rate_limited` — reads are rate limited. Back off; this is the usual
  consequence of polling too eagerly.

## Guidance

- Summarize in plain language: where the placement stands, who has responded,
  what is outstanding. Do not dump the raw payload unless asked.
- Quote figures, limits, and premiums are financial data — report them as the
  tool returned them, and do not compute or infer values it did not provide.
- In a Cowork project, write the snapshot into `notes/` so successive checks can
  be compared.
