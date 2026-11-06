---
description: Check on a submitted Traverse engagement — where the placement stands, which markets have responded, what quotes have come in, and what tasks are open.
argument-hint: [client name, engagementRequestId, or engagementId]
---

# Traverse engagement status

Read a submitted engagement back. Use the `engagement-status` skill to do the
work, `traverse-auth` for credentials, and `traverse-conventions` for output
formatting.

What to check (optional): **$ARGUMENTS**

1. **Authenticate.** Short `work_description`, then `authenticate`.
2. **Identify the engagement.** Exactly one of `engagementId` or
   `integrationReferenceId`. The `engagementId` parameter accepts either the
   `engagementRequestId` from `submit_engagement` or a real engagement id from
   `get_engagements`. In a Cowork project, read it from `engagement.json` —
   normally only `engagementRequestId` is populated. With no id, list candidates
   with `get_engagements` and let the broker pick.
3. **Read it.** `get_engagement` for the payload and the compact submissions
   list. Add `include: ["submissions"]` when you need `updated_at` to see what
   moved since a previous check.
4. **Tasks.** `get_engagement_tasks` — takes the same one-of pair as step 2, so
   an `integrationReferenceId` can go straight in. Lead with what is open and
   waiting on the broker.
5. **Drill down** only where it matters: `get_submission` for one submission's
   detail and quote rollup, `get_submission_quotes` for the full quotes. Never
   pull quotes for every submission just to summarize.
6. **Report.** Plain language: where the placement stands, who has responded,
   what is outstanding.

If the engagement was just submitted, **both `engagement_not_found` and
`engagement_not_ready`** are expected — it is created asynchronously. Treat them
the same: back off (~5s, 15s, 30s) and retry before reporting a problem.
`engagement_not_ready` is about the engagement, not the broker's credentials —
do not re-authenticate on it.
