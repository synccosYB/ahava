#!/usr/bin/env bash
# Runs every *.test.ts suite with tsx (the repo has no external test runner —
# each test file is a standalone node:test script). Requires DATABASE_URL and
# BIOMETRIC_ENCRYPTION_KEY, and a migrated + seeded database. Exits non-zero if
# any suite fails. Used by CI and available locally via `npm test`.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

mapfile -t FILES < <(find . -path ./node_modules -prune -o -name '*.test.ts' -print | sort)

pass=0
fail=0
failed_files=()

echo "Running ${#FILES[@]} test suites..."
for f in "${FILES[@]}"; do
  if npx tsx "$f"; then
    pass=$((pass + 1))
    echo "PASS  $f"
  else
    fail=$((fail + 1))
    failed_files+=("$f")
    echo "FAIL  $f"
  fi
done

echo "----------------------------------------"
echo "Suites: ${#FILES[@]}  Passed: $pass  Failed: $fail"
if [ "$fail" -ne 0 ]; then
  printf 'Failed suites:\n'
  printf '  %s\n' "${failed_files[@]}"
  exit 1
fi
