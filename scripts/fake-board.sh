#!/usr/bin/env bash
#
# fake-board.sh — the Phase B stand-in for the panel (plan B4).
#
# It is NOT firmware and shares nothing with it: it is a `curl` loop that speaks
# exactly the `/device/poll` wire contract (spec/api/device-protocols.md §1) so the
# service can be driven end-to-end without a Pico W.
#
# What it does, faithfully:
#   * emits the full query string (token, boot, fw, applied_gen, state, routine,
#     remaining_s, rssi, uptime_s);
#   * reads `next_poll_ms` from the JSON response and sleeps that long — so it
#     exercises the SERVER-owned cadence;
#   * APPLIES the desired state: on `action:"start"` it moves ambient → prompt →
#     countdown and bumps `applied_gen` to the returned `gen`; on `action:"cancel"`
#     it returns to ambient; on `none` it advances/idles.
#
# Usage:
#   bash scripts/fake-board.sh [options]
#
# Options:
#   --url URL            base URL (default http://localhost:3000)
#   --token TOKEN        device token (default $DEVICE_TOKEN or test-device-token)
#   --boot ID            boot id, ≤16 chars (default: generated)
#   --applied-gen N      starting applied_gen (default 0)
#   --fw VERSION         firmware version (default 0.2.0)
#   --dead-window N      stop polling for N seconds once (reproduces TTL expiry)
#   --polls N            stop after N polls (default: run forever)
#   -h | --help          this text
#
# Example (with the dev server up):
#   npm run dev &
#   bash scripts/fake-board.sh
#   curl -XPOST localhost:3000/api/start -H 'content-type: application/json' -d '{"routine":"bathtime"}'

set -euo pipefail

URL="http://localhost:3000"
TOKEN="${DEVICE_TOKEN:-test-device-token}"
BOOT=""
APPLIED_GEN=0
FW="0.2.0"
DEAD_WINDOW=0
MAX_POLLS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --boot) BOOT="$2"; shift 2 ;;
    --applied-gen) APPLIED_GEN="$2"; shift 2 ;;
    --fw) FW="$2"; shift 2 ;;
    --dead-window) DEAD_WINDOW="$2"; shift 2 ;;
    --polls) MAX_POLLS="$2"; shift 2 ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$BOOT" ]; then
  # ≤16 chars, new-ish each run (a change makes the server clear pending desired).
  BOOT="$(date +%s | tail -c 9)"
fi

# The board's own reported state (starts ambient, as after a boot).
STATE="ambient"
ROUTINE=""
REMAINING=""
RSSI="-41"
UPTIME=0
POLLS=0

poll_url="${URL%/}/device/poll"

log() { printf '[fake-board] %s\n' "$*"; }

# Minimal JSON parsing — no jq dependency (the real board parses a few hundred
# bytes by hand too; keeping the stand-in dependency-free mirrors that).
json_int() { printf '%s' "$1" | sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\(-\{0,1\}[0-9]\{1,\}\).*/\1/p" | head -n1; }
json_str() { printf '%s' "$1" | sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n1; }

log "polling ${poll_url} as boot=${BOOT} (dead-window=${DEAD_WINDOW}s, polls=${MAX_POLLS:-∞})"

while :; do
  POLLS=$((POLLS + 1))

  # --dead-window: reproduce a network window by simply not polling for N seconds.
  if [ "$DEAD_WINDOW" -gt 0 ] && [ "$POLLS" -eq 2 ]; then
    log "entering a dead window for ${DEAD_WINDOW}s (TTL should drop any pending desired)"
    sleep "$DEAD_WINDOW"
  fi

  args=(-sS -G "$poll_url"
    --data-urlencode "token=$TOKEN"
    --data-urlencode "boot=$BOOT"
    --data-urlencode "fw=$FW"
    --data-urlencode "applied_gen=$APPLIED_GEN"
    --data-urlencode "state=$STATE"
    --data-urlencode "rssi=$RSSI"
    --data-urlencode "uptime_s=$UPTIME")
  [ -n "$ROUTINE" ] && args+=(--data-urlencode "routine=$ROUTINE")
  [ -n "$REMAINING" ] && args+=(--data-urlencode "remaining_s=$REMAINING")

  if ! RESP="$(curl "${args[@]}")"; then
    log "poll failed (server down?) — retrying in 5s"
    sleep 5
    continue
  fi

  GEN="$(json_int "$RESP" gen)"
  ACTION="$(json_str "$RESP" action)"
  TARGET="$(json_str "$RESP" routine)"
  NEXT_MS="$(json_int "$RESP" next_poll_ms)"
  [ -z "$GEN" ] && GEN="?"
  [ -z "$ACTION" ] && ACTION="none"
  [ -z "$NEXT_MS" ] && NEXT_MS=5000

  log "poll=$POLLS reported(state=$STATE routine=${ROUTINE:-none} applied_gen=$APPLIED_GEN) <- gen=$GEN action=$ACTION ${TARGET:+routine=$TARGET} next_poll_ms=$NEXT_MS"

  # --- apply the desired state, exactly as the board would ---------------------
  if [ "$ACTION" = "start" ] && [ -n "$TARGET" ]; then
    APPLIED_GEN="$GEN"
    ROUTINE="$TARGET"
    if [ "$STATE" = "ambient" ]; then
      STATE="prompt"
      REMAINING=300
    else
      STATE="countdown"
      REMAINING=300
    fi
  elif [ "$ACTION" = "cancel" ]; then
    APPLIED_GEN="$GEN"
    STATE="ambient"
    ROUTINE=""
    REMAINING=""
  else
    # idle: advance the board's own countdown (ticks_ms-based, never the server's).
    case "$STATE" in
      prompt) STATE="countdown" ;;
      countdown)
        if [ -n "$REMAINING" ] && [ "$REMAINING" -gt 0 ] 2>/dev/null; then
          REMAINING=$((REMAINING - 2))
          [ "$REMAINING" -le 0 ] && { STATE="handoff"; REMAINING=0; }
        else
          STATE="handoff"; REMAINING=0
        fi
        ;;
      handoff) STATE="ambient"; ROUTINE=""; REMAINING="" ;;
    esac
  fi
  UPTIME=$((UPTIME + 5))

  if [ "$MAX_POLLS" -gt 0 ] && [ "$POLLS" -ge "$MAX_POLLS" ]; then
    log "reached --polls $MAX_POLLS — stopping"
    break
  fi

  # Obey the server-owned cadence.
  sleep "$(awk "BEGIN { printf \"%.3f\", $NEXT_MS / 1000 }")"
done
