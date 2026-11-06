---
description: Output and response-handling conventions for the Traverse engagement workflows — how to present tool results and report state changes to a broker. Use when formatting output from any traverse-engagements or traverse-engagement-files tool.
# Referenced by the other skills in this plugin; not a user entry point.
user-invocable: false
---

# Traverse conventions

Conventions that every skill in this plugin follows. They live in one place so
that the engagement, status, upload, and coverage flows present results the
same way.

## Presenting results

- Summarize tool results in plain language; do not dump raw JSON unless asked.
- When an operation mutates state (create/update/remove), state clearly what
  changed and the resulting identifier.
