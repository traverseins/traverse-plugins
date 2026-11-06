---
description: Create a Traverse insurance placements engagement end-to-end — gather client details, recommend coverages from documents, upload supporting files, and submit.
argument-hint: [client name or short objective]
---

# Create a Traverse engagement

Run the full engagement workflow for the broker. Use the `engagement` skill to
orchestrate, the `coverage-analysis` skill for recommendations, and the
`document-upload` skill for file uploads. Follow `traverse-auth` for
credentials and `traverse-conventions` for formatting.

Starting context (optional): **$ARGUMENTS**

Work through these steps, pausing for input where needed:

1. **Authenticate.** Ask for a short `work_description`, then call
   `authenticate`. Required before any other tool. Keep the `role` it returns:
   on a `TRAVERSE_SERVICE` key, follow `traverse-auth` for the broker and
   agency.
2. **Gather inputs.** On a `TRAVERSE_SERVICE` key, first the broker's
   `name` + `email` and the agency's `agencyOrgId`, typed by the user and never
   inferred. Then client `name` (+ optional `amsAccountId`), one insured
   identifier — the **website URL** (`insuredWebsite`), or
   `businessRegistrationNumber` + `businessRegistrationNumberSource` when there
   is no website or the site is shared with another insured (take it from a
   document or from the broker; never infer a domain or guess a kind), placement
   objectives (free text), coverage lines of interest, `targetEffective` and
   `respondBy` dates (ISO `YYYY-MM-DD`), and the document set — client
   documents plus the agency benchmark (defaults to
   `$TRAVERSE_COVERAGE_BENCHMARK`, overridable).
3. **Analyze coverage.** Produce recommended `coverages` (`{ line, limit }`),
   retentions/deductibles, T&C flags, and a `brokerNotes` block.
4. **Review gate.** Present the recommendations and notes (plus broker and
   `agencyOrgId` on a service key); get explicit broker approval or edits. Do
   not proceed without sign-off.
5. **Upload documents.** For each file: `stage_file` (local path, share URL, or
   a small connector file relayed as base64) → `get_upload_target` (always pass
   `sizeBytes`) → `upload_file` (single `uploadUrl` or multipart `parts`) →
   `upload_complete` (with `parts` for multipart). Collect each `documentId`.
6. **Submit.** Call `submit_engagement` with `broker` (with `agencyOrgId` on
   a service key only), `client`, approved
   `coverages`, `respondBy`, `targetEffective`, `documentIds`, the insured
   identifier gathered in step 2 (`insuredWebsite`, **or**
   `businessRegistrationNumber` + `businessRegistrationNumberSource` — neither,
   or a number with no kind, fails with `insured_unidentified`), and
   `brokerNotes`. Pass a stable
   `idempotencyKey` (e.g. client + targetEffective).
   Include `integrationReferenceId` only if the broker gave you one — **never
   invent it.** Never pass `options` — unrecognized tokens are rejected.
7. **Report.** On a service key, first verify the engagement is listed under
   the agency (`traverse-auth`). Keep the `engagementRequestId` the response
   returns — it is the
   durable handle, and the response deliberately carries no `engagementId`
   because the engagement it resolves to is not known yet. Summarize what was
   submitted, note the engagement is created asynchronously and is not readable
   for a short while, and offer `/traverse-engagement:status` or
   `finalize_session`.
