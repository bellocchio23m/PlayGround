#!/usr/bin/env bash
# SHADOWLINE: Kestrel — build (when needed) and serve the static dist/ output.
#
# - Source and built output always stay inside the project directory.
# - OPENCODE_WEB_DIR / RUNNER_TEMP are used only for worker metadata
#   (deployment-output.json), never for app code or build artifacts.
# - Serves the built static directory in the FOREGROUND on ${PORT:-3000}.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

PORT="${PORT:-3000}"
RUNNER_TEMP="${RUNNER_TEMP:-/tmp}"
OPENCODE_WEB_DIR="${OPENCODE_WEB_DIR:-$RUNNER_TEMP/omgithub-web}"
DIST_DIR="$PROJECT_DIR/dist"
DEPLOY_JSON="$OPENCODE_WEB_DIR/deployment-output.json"

step() { echo "[start.sh] $*"; }

/usr/bin/time -p mkdir -p "$OPENCODE_WEB_DIR"

# 1. Dependencies (inside the project only).
if [[ ! -d node_modules ]]; then
  step "node_modules missing — installing dependencies"
  /usr/bin/time -p npm install --no-audit --no-fund
else
  step "dependencies present — skipping install"
fi

# 2. Build only when dist/ is missing or any source is newer than it.
needs_build=false
if [[ ! -f "$DIST_DIR/index.html" ]]; then
  needs_build=true
elif [[ -n "$(/usr/bin/time -p find src public index.html package.json vite.config.ts -newer "$DIST_DIR/index.html" -print -quit 2>/dev/null)" ]]; then
  needs_build=true
fi
if [[ "$needs_build" == true ]]; then
  step "sources changed — building (npm run build)"
  /usr/bin/time -p npm run build
else
  step "dist/ is up to date — skipping build"
fi
/usr/bin/time -p test -f "$DIST_DIR/index.html"

# 3. Worker metadata (paths only) — outside the app source tree.
step "writing $DEPLOY_JSON"
/usr/bin/time -p python3 -c \
  'import json,sys; sys.stdout.write(json.dumps({"project": sys.argv[1], "directory": sys.argv[2]}) + "\n")' \
  "$PROJECT_DIR" "$DIST_DIR" > "$DEPLOY_JSON"
/usr/bin/time -p cat "$DEPLOY_JSON"

# 4. Serve the built static directory in the foreground (never returns).
step "serving $DIST_DIR on port $PORT (foreground)"
if [[ -x node_modules/.bin/vite ]]; then
  exec ./node_modules/.bin/vite preview --host 0.0.0.0 --port "$PORT" --strictPort
else
  exec npx -y vite preview --host 0.0.0.0 --port "$PORT" --strictPort
fi
