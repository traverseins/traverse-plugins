---
description: Start a NEW Traverse engagement in a Cowork project — create a working directory, pull the client's materials in from connected sources and local files, analyze coverage, upload, and submit.
argument-hint: [client name or short objective]
---

# New Traverse engagement (Cowork project)

Run the `create-engagement` skill to stand up a project working directory for the
engagement, gather the client's materials into it, then analyze coverage, upload
the documents, and submit. Use `coverage-analysis` for recommendations and
`document-upload` for the uploads. Follow `traverse-auth` for credentials and
`traverse-conventions` for formatting.

Starting context (optional): **$ARGUMENTS**

Work through the `create-engagement` phases, pausing for input where needed:

1. **Authenticate** — short `work_description`, then `authenticate`. Keep the
   `role`: on a `TRAVERSE_SERVICE` key, collect the broker's `name` + `email`
   and the agency's `agencyOrgId` from the user (never inferred; see
   `traverse-auth`).
2. **Create the project** — `engagements/<client-slug>-<targetEffective>/`
   (`documents/`, `benchmark/`, `artifacts/`, `notes/`) + an `engagement.json`
   manifest.
3. **Acquire materials** into the project — local drag-drop, Google Drive,
   OneDrive/SharePoint, Gmail/Outlook attachments, Salesforce (`sf`), and the
   agency benchmark. Confirm before downloading from any share/mailbox.
4. **Analyze coverage** — recommended `coverages`, retentions, T&C, `brokerNotes`.
5. **Review gate** — explicit broker sign-off on coverage (showing broker and
   `agencyOrgId` on a service key); never submit without it. Also show the full
   list of documents to upload and get the broker's approval of it, which is
   mandatory, before anything is uploaded.
6. **Upload** the approved documents (`stage_file` → `get_upload_target` →
   `upload_file` → `upload_complete`); collect `documentId`s.
7. **Submit** — `submit_engagement` with `broker` (plus `agencyOrgId` on a
   service key only), one insured identifier from
   `engagement.json` or the documents: `insuredWebsite`, **or**
   `businessRegistrationNumber` + `businessRegistrationNumberSource` (both, or
   it is rejected). Ask the broker rather than inferring a domain or guessing a
   kind. Plus a stable `idempotencyKey`, and never `options`. Pass
   `integrationReferenceId` only if the broker supplied one; **never invent it.**
   Record the returned `engagementRequestId` in `engagement.json` — that is the
   durable handle every read tool accepts. The
   response carries **no** `engagementId`; leave that field null rather than
   guessing one.
8. **Confirm** — on a service key, first verify the engagement is listed
   under the agency (`traverse-auth`). The engagement is created asynchronously,
   so it is not readable right away. Summarize what was submitted, including any
   documents the broker left out (which can still be added), and offer
   `/traverse-engagement:status` to check on it.
