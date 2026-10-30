#!/usr/bin/env bash
# Single quality gate used by CI and by build-lab before every push:
# format check, typecheck, lint, unit tests, production build.
# End-to-end tests (Playwright) run separately: `npm run e2e`.
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then npm ci; fi
npx prettier --check .
npx tsc --noEmit
npx eslint .
npx vitest run
npx vite build
