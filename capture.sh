#!/usr/bin/env bash
# Capture desktop + mobile screenshots of the deployed app.
#
# Env:
#   CAPTURE_URL — exact URL to open in the browser (required).
#   CAPTURE_DIR — directory receiving final-desktop.png / final-mobile.png (required).
#
# - Capture output stays outside the app source (caller-owned CAPTURE_DIR).
# - The app server is left running; only this script's browser is closed.
# - Uses a dedicated browser session so open/close never disturb
#   other tooling sharing the default browser session.
# - Exit 75: temporary navigation / browser infrastructure failures.
# - Exit 1:  script usage errors or rendering defects (page loads but blank/broken).
set -euo pipefail

CAPTURE_URL="${CAPTURE_URL:?CAPTURE_URL environment variable is required}"
CAPTURE_DIR="${CAPTURE_DIR:?CAPTURE_DIR environment variable is required}"
PC="playwright-cli -s=capture"

step() { echo "[capture.sh] $*"; }
fail_infra() { echo "[capture.sh] INFRA FAILURE: $*" >&2; exit 75; }
fail_render() { echo "[capture.sh] RENDER DEFECT: $*" >&2; exit 1; }

command -v playwright-cli >/dev/null 2>&1 || fail_infra "playwright-cli not found on PATH"
/usr/bin/time -p mkdir -p "$CAPTURE_DIR"

# 1. Open the exact URL (navigation failure => infrastructure).
step "opening $CAPTURE_URL"
/usr/bin/time -p $PC open "$CAPTURE_URL" >/dev/null 2>&1 \
  || fail_infra "browser failed to open $CAPTURE_URL"

# 2a. Wait for document readiness (never settles => infrastructure).
step "waiting for document readiness"
deadline=$((SECONDS + 45))
ready=false
while [ "$SECONDS" -lt "$deadline" ]; do
  if /usr/bin/time -p $PC eval "() => document.readyState" 2>/dev/null | grep -q "complete"; then
    ready=true
    break
  fi
  /usr/bin/time -p sleep 3
done
[ "$ready" == true ] || fail_infra "document never reached readyState=complete at $CAPTURE_URL"

# 2b. Wait for rendered app content: a sized canvas + booted game (missing => defect).
step "waiting for rendered content (canvas + game boot)"
deadline=$((SECONDS + 60))
rendered=false
while [ "$SECONDS" -lt "$deadline" ]; do
  if /usr/bin/time -p $PC eval \
    "() => { const c = document.querySelector('canvas'); return (c ? c.width + 'x' + c.height : 'no-canvas') + '|' + (!!window.__game); }" \
    2>/dev/null | grep -Eq "[1-9][0-9]+x[1-9][0-9]+\|true"; then
    rendered=true
    break
  fi
  /usr/bin/time -p sleep 3
done
if [ "$rendered" != true ]; then
  # Classify: browser/page dead => infra; page alive but blank => render defect.
  if /usr/bin/time -p $PC eval "() => document.title" >/dev/null 2>&1; then
    fail_render "page loaded but no sized canvas / game boot detected at $CAPTURE_URL"
  else
    fail_infra "browser stopped responding while waiting for content at $CAPTURE_URL"
  fi
fi
step "rendered content confirmed"

# 3. Let WebGL paint a few frames, then capture desktop 1280x800.
step "capturing desktop view"
/usr/bin/time -p $PC resize 1280 800 >/dev/null 2>&1 \
  || fail_infra "browser resize (desktop) failed"
/usr/bin/time -p sleep 3
/usr/bin/time -p $PC screenshot --filename="$CAPTURE_DIR/final-desktop.png" >/dev/null 2>&1 \
  || fail_infra "desktop screenshot failed"
[ -s "$CAPTURE_DIR/final-desktop.png" ] || fail_render "final-desktop.png missing or empty"

# 4. Mobile viewport 390x844, then capture.
step "capturing mobile view"
/usr/bin/time -p $PC resize 390 844 >/dev/null 2>&1 \
  || fail_infra "browser resize (mobile) failed"
/usr/bin/time -p sleep 3
/usr/bin/time -p $PC screenshot --filename="$CAPTURE_DIR/final-mobile.png" >/dev/null 2>&1 \
  || fail_infra "mobile screenshot failed"
[ -s "$CAPTURE_DIR/final-mobile.png" ] || fail_render "final-mobile.png missing or empty"

# 5. Close this script's browser; leave the app server running.
/usr/bin/time -p $PC close >/dev/null 2>&1 \
  || echo "[capture.sh] warning: browser close failed (app server left running)" >&2

step "done: $CAPTURE_DIR/final-desktop.png + $CAPTURE_DIR/final-mobile.png"
