---
description: Analyze a commercial insurance client's documents against an agency-specific coverage benchmark to recommend limits, retentions/deductibles, and terms & conditions the broker should be mindful of. Use when preparing coverage recommendations for a Traverse engagement, or when comparing client exposures to an agency benchmark.
---

# Traverse coverage analysis

Reviews a commercial client's documents alongside the agency's coverage
benchmark and produces structured recommendations that feed
`submit_engagement`. Follow `traverse-conventions` for output formatting.

## Inputs

- **Client documents:** loss runs, current policies / dec pages, statement of
  values (SOV), applications, and financials — whatever the broker provides.
- **Agency benchmark:** the agency-specific coverage benchmark document. It
  defaults to the path in `$TRAVERSE_COVERAGE_BENCHMARK`; the broker may pass a
  different path for a given run. If neither is available, ask for it before
  recommending — do not invent benchmark figures.

## What to produce

For each coverage line, recommend:

- **Limit** — the recommended per-occurrence / aggregate limit.
- **Retention / deductible** — recommended SIR or deductible.
- **T&C flags** — specific terms, conditions, endorsements, or exclusions the
  broker should be mindful of (e.g. sublimits, coinsurance, claims-made vs.
  occurrence, wind/hail or flood deductibles).

Give each recommendation a one-line **rationale** tying it to a specific
benchmark row and the client's exposures (e.g. SOV total insured value, payroll,
revenue, loss history).

Shape the result into the fields the engagement needs:

- `coverages`: a list of `{ line, limit }` for `submit_engagement`.
- `brokerNotes`: a narrative block capturing retentions, T&C flags, rationale,
  and any caveats — combined with the broker's stated placement objectives.
- **The insured's identifier, if the documents carry one.** `submit_engagement`
  needs either a website or a registration number, so surfacing it here saves
  asking the broker after the review gate. Report whichever the documents
  actually contain, exactly as written, and say which document it came from:
  - `insuredWebsite` — the public website URL. Dec pages and applications
    usually carry it.
  - `businessRegistrationNumber` **and** `businessRegistrationNumberSource` —
    the number and the KIND of identifier it is. W-9s, applications and
    financials routinely carry an EIN/FEIN. Report both or neither; the number
    on its own is rejected at submit.

  Report only what the documents contain — do not infer a domain from the
  insured's name, do not search for one, and do not guess a number's kind. If
  the documents have neither, say so and let the calling skill ask the broker.

## Guidance

- Cite which document and which benchmark row drove each number.
- Surface gaps explicitly: missing documents, exposures with no benchmark
  guidance, or stale data — flag rather than guess.
- These are **recommendations** requiring broker sign-off. Hand them to the
  review gate in the `engagement` flow; never submit them unapproved.
