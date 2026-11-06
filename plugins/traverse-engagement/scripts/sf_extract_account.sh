#!/usr/bin/env bash
# Extract a Salesforce Account record and write it to the engagement project.
#
# Usage:
#   sf_extract_account.sh --account-id <AMS_ID> --name "<Client Name>" --out <path>
#
# Resolution order: AMS Account ID (external/custom field) preferred, else name.
# Exits non-zero with a clear message if the CLI is missing/unauthed, the account
# is not found, or the match is ambiguous (so the caller can ask the user).
set -euo pipefail

SF_CLI="${SF_CLI:-sf}"
ORG_ALIAS="${SF_ORG_ALIAS:-}"
ACCOUNT_ID_FIELD="${SF_ACCOUNT_ID_FIELD:-AMS_Account_Id__c}"
ACCOUNT_ID=""
CLIENT_NAME=""
OUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --account-id) ACCOUNT_ID="${2:-}"; shift 2 ;;
    --name)       CLIENT_NAME="${2:-}"; shift 2 ;;
    --out)        OUT="${2:-}"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

[[ -z "$OUT" ]] && { echo "ERROR: --out is required" >&2; exit 2; }

# --- Availability checks ------------------------------------------------------
if ! command -v "$SF_CLI" >/dev/null 2>&1; then
  echo "SF_CLI_MISSING: '$SF_CLI' not found on PATH" >&2
  exit 3
fi

ORG_FLAG=()
[[ -n "$ORG_ALIAS" ]] && ORG_FLAG=(--target-org "$ORG_ALIAS")

# Confirm we have an authenticated org.
if ! "$SF_CLI" org display "${ORG_FLAG[@]}" >/dev/null 2>&1; then
  echo "SF_NOT_AUTHENTICATED: no authenticated org (alias='${ORG_ALIAS:-default}')" >&2
  exit 4
fi

# --- Build SOQL ---------------------------------------------------------------
# Pull a broad-but-safe set of standard fields plus the AMS id field.
FIELDS="Id, Name, ${ACCOUNT_ID_FIELD}, BillingStreet, BillingCity, BillingState, BillingPostalCode, Phone, Website, Industry, OwnerId"

esc() { printf "%s" "$1" | sed "s/'/\\\\'/g"; }

if [[ -n "$ACCOUNT_ID" ]]; then
  WHERE="${ACCOUNT_ID_FIELD} = '$(esc "$ACCOUNT_ID")'"
elif [[ -n "$CLIENT_NAME" ]]; then
  WHERE="Name LIKE '%$(esc "$CLIENT_NAME")%'"
else
  echo "ERROR: provide --account-id or --name" >&2
  exit 2
fi

QUERY="SELECT ${FIELDS} FROM Account WHERE ${WHERE} LIMIT 25"

RESULT="$("$SF_CLI" data query --query "$QUERY" --json "${ORG_FLAG[@]}")" || {
  echo "SF_QUERY_FAILED" >&2; exit 5;
}

COUNT="$(printf '%s' "$RESULT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["totalSize"])')"

if [[ "$COUNT" -eq 0 ]]; then
  echo "SF_ACCOUNT_NOT_FOUND" >&2
  exit 6
elif [[ "$COUNT" -gt 1 ]]; then
  # Emit the candidate list (Id + Name) so the caller can disambiguate.
  echo "SF_AMBIGUOUS: ${COUNT} matches" >&2
  printf '%s' "$RESULT" | python3 -c '
import sys,json
for r in json.load(sys.stdin)["result"]["records"]:
    print(f"  {r.get(\"Id\")}  {r.get(\"Name\")}", file=sys.stderr)'
  exit 7
fi

# Exactly one match — write the single record to the output file.
printf '%s' "$RESULT" | python3 -c '
import sys,json
rec = json.load(sys.stdin)["result"]["records"][0]
rec.pop("attributes", None)
json.dump(rec, open(sys.argv[1], "w"), indent=2)
' "$OUT"

echo "OK: wrote $OUT"
