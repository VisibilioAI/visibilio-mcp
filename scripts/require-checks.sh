#!/usr/bin/env bash
# Require CI check runs to have passed on one commit before a release or a deploy.
#
# Usage:
#   ./scripts/require-checks.sh <commit-sha> <check-name> [<check-name> ...]
#
# For each check name, the script waits until the latest check run of that name
# on the commit has completed. It exits 1 if a check run did not succeed, or if
# a check run did not complete before the timeout. A missing check run counts as
# "not complete", so a commit that CI never checked fails at the timeout.
#
# Environment:
#   GITHUB_REPOSITORY        owner/repo (default VisibilioAI/visibilio-mcp)
#   CHECK_TIMEOUT_SECONDS    total wait (default 1200)
#   CHECK_INTERVAL_SECONDS   wait between polls (default 20)
#   GH_TOKEN                 a token that can read check runs (checks: read)

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <commit-sha> <check-name> [<check-name> ...]" >&2
  exit 2
fi

SHA="$1"
shift
REPO="${GITHUB_REPOSITORY:-VisibilioAI/visibilio-mcp}"
TIMEOUT="${CHECK_TIMEOUT_SECONDS:-1200}"
INTERVAL="${CHECK_INTERVAL_SECONDS:-20}"
DEADLINE=$(($(date +%s) + TIMEOUT))

state_of() {
  gh api -X GET "repos/${REPO}/commits/${SHA}/check-runs" -f check_name="$1" \
    --jq '[.check_runs[]] | sort_by(.started_at) | last
          | if . == null then "missing"
            elif .status != "completed" then "pending"
            else .conclusion end'
}

for NAME in "$@"; do
  while true; do
    STATE="$(state_of "$NAME")"
    case "$STATE" in
      success)
        echo "✓ ${NAME}"
        break
        ;;
      missing | pending)
        if (($(date +%s) >= DEADLINE)); then
          echo "✗ ${NAME}: still ${STATE} on ${SHA} after ${TIMEOUT}s" >&2
          exit 1
        fi
        sleep "$INTERVAL"
        ;;
      *)
        echo "✗ ${NAME}: ${STATE} on ${SHA}" >&2
        exit 1
        ;;
    esac
  done
done
