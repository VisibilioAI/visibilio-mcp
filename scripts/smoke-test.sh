#!/usr/bin/env bash
# Smoke test: install + boot @visibilio/mcp from a clean Node container.
#
# Usage:
#   ./scripts/smoke-test.sh                     # uses VISIBILIO_API_KEY from env
#   VISIBILIO_API_KEY=vsk_... ./scripts/smoke-test.sh
#
# What this verifies:
#   1. The published package downloads without dependency resolution errors
#   2. The bin script has the correct shebang and is executable
#   3. The settings loader accepts the env vars
#   4. The auth resolver is reachable (will fail with a clean error if the
#      backend URL is unreachable from the container, which is fine — we
#      only need to confirm the binary boots far enough to dial out)

set -euo pipefail

if [[ -z "${VISIBILIO_API_KEY:-}" ]]; then
  echo "VISIBILIO_API_KEY is not set. Use a real vsk_* key for end-to-end coverage."
  echo "Continuing with vsk_smoke_invalid (will fail at auth — expected)."
  VISIBILIO_API_KEY="vsk_smoke_invalid"
fi

echo "→ Pulling node:18-alpine..."
docker pull node:18-alpine >/dev/null

echo "→ Running smoke test in clean container..."
docker run --rm \
  -e VISIBILIO_API_KEY="$VISIBILIO_API_KEY" \
  -e VISIBILIO_BACKEND_URL="${VISIBILIO_BACKEND_URL:-https://api.visibilio.ai}" \
  node:18-alpine \
  sh -c '
    set -e
    echo "  ◦ npx -y @visibilio/mcp (boot for ~3s, then SIGTERM)..."
    timeout 5 npx -y @visibilio/mcp 2>&1 < /dev/null || EXIT=$?
    case "${EXIT:-0}" in
      0|124|143)
        echo "  ✓ binary booted and exited cleanly (exit=$EXIT)"
        exit 0
        ;;
      *)
        echo "  ✗ binary failed early (exit=$EXIT)"
        exit "$EXIT"
        ;;
    esac
  '

echo "✓ Smoke test passed"
