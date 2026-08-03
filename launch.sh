#!/usr/bin/env bash
# launch.sh — interactive launcher and on-site recovery console for homelab-reader.
#
# Two audiences, one script:
#
#   * The person installing it: first run asks where the books live and which
#     network to serve (the home network / this machine only), saves the
#     answers to .env (gitignored), and starts the app.
#
#   * Anyone standing at the box later, when the reader is down and the person
#     who set it up is not around: every run after setup shows a short
#     plain-language menu — start/restart, "is it running?", recent app
#     messages, update. Every action is safe to run repeatedly; none can
#     delete data (the database and covers live in a Docker volume no menu
#     action touches, and the books folder is mounted read-only).
#
# The saved facts are ordinary compose variables (BOOKS_HOST_PATH,
# HOMELAB_HOST_BIND, HOMELAB_PORT), so plain `docker compose up -d --build`
# keeps working identically — this script is a convenience in front of the
# same file, not a new mechanism. The compose header documents the manual
# equivalents. The bind is REQUIRED by compose: nothing starts until the
# network question below has been answered once.
#
# App-specific half above the marker; the machinery below it is the shared
# fleet launcher core, synced from dev-tools (devtools launcher-sync).
set -euo pipefail
cd "$(dirname "$0")"

# ── app config (read by the launcher core below) ──
ENV_FILE=.env
APP_NAME=homelab-reader
APP_THING="the reader"
CONTAINER=homelab-reader
BIND_VAR=HOMELAB_HOST_BIND
PORT_VAR=HOMELAB_PORT
PORT_DEFAULT=5456
MODE_KEY=HOMELAB_LAUNCH   # lan | local — remembered menu choice
CONFIG_SUMMARY="books folder, network"

# First-run setup: where the books live (read-only to the app), then the
# network question.
configure() {
  echo "homelab-reader — first-time setup"
  echo
  echo "This launcher asks two questions, saves the answers to a small settings"
  echo "file (.env), and starts the reader. The answers can be changed at any"
  echo "time by running ./launch.sh again and pressing r — nothing here is"
  echo "permanent, and nothing here can delete the library or the notes."
  echo
  echo "Question 1 is where the book files live (the reader only ever READS"
  echo "that folder). Question 2 is who should be able to open the reader:"
  echo "just this machine, or other devices on the home network."
  echo
  # The one question that has no sane default: where the books live.
  local books current
  current=$(get_env BOOKS_HOST_PATH)
  if [ -n "$current" ]; then
    read -rp "Books folder [$current]: " books
    books=${books:-$current}
  else
    read -rp "Books folder (the host directory with the .epub/.pdf files): " books
  fi
  [ -n "$books" ] || die "a books folder is required"
  [ -d "$books" ] || echo "note: '$books' does not exist yet — create it before the first scan."
  set_env BOOKS_HOST_PATH "$books"
  echo
  ask_network
  set_env "$BIND_VAR" "$ASKED_BIND"
  set_env "$MODE_KEY" "$ASKED_MODE"
  confirm_saved
}

# >>> launcher-core (synced from dev-tools/templates/launch-core.sh — edit there, then: devtools launcher-sync) >>>
#
# Shared machinery for every fleet launcher. The app-specific half lives
# ABOVE the marker: a config block (APP_NAME, APP_THING, CONTAINER,
# BIND_VAR, PORT_VAR, PORT_DEFAULT, MODE_KEY, CONFIG_SUMMARY), a
# configure() that asks the app's first-run questions, and optional
# overrides of compose()/status()/update() (define them above and the
# defaults below step aside; set LAUNCH_BUILD= empty to start without
# --build). Everything between the markers is the synced canonical copy —
# edit the template, not this section, or the next sync clobbers the edit.

die() { echo "error: $*" >&2; exit 1; }

# Read a saved KEY=VALUE from .env (empty if absent).
get_env() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }

# Save KEY=VALUE into .env, replacing any prior line for KEY.
set_env() {
  local key=$1 value=$2
  touch "$ENV_FILE"
  grep -vE "^$key=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
}

# The box's IPv4 addresses — real interfaces only (loopback and
# container-runtime bridges like docker0/br-*/veth* are not addresses
# another device can be served on).
lan_addresses() {
  if command -v ip >/dev/null; then
    ip -4 -o addr show scope global 2>/dev/null \
      | awk '$2 !~ /^(docker|br-|veth|virbr)/ {split($4,a,"/"); print a[1]" ("$2")"}'
  elif command -v hostname >/dev/null; then
    hostname -I 2>/dev/null | tr ' ' '\n' | sed '/^$/d'
  fi
}

# The one question every launcher asks: which interface should the app
# answer on. Sets ASKED_BIND and ASKED_MODE (lan|local); the caller saves
# them with set_env. The bind is REQUIRED by compose (${VAR:?…}), so this
# answer is what first setup exists to record.
ask_network() {
  echo "Which network should $APP_THING answer on?"
  echo
  echo "A box can be connected to more than one network at once (wired, wifi…)"
  echo "and each connection has its own address. Devices reach $APP_THING on"
  echo "the address chosen here. With a single connection, the specific address"
  echo "and 'all interfaces' behave identically — the specific one is simply"
  echo "tidier. 'This machine only' keeps everything private to the box."
  echo
  local i=1; local -a addrs=()
  local line
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    addrs+=("${line%% *}")
    echo "  $i) $line   — serve the home network on this address"
    i=$((i+1))
  done < <(lan_addresses)
  echo "  $i) all interfaces (0.0.0.0)"
  echo "  $((i+1))) this machine only (127.0.0.1 — e.g. behind a reverse proxy)"
  echo
  local pick
  read -rp "Choose [1-$((i+1)), or type an address]: " pick
  ASKED_MODE=lan
  if [[ "$pick" =~ ^[0-9]+$ ]] && [ "$pick" -ge 1 ] && [ "$pick" -lt "$i" ]; then
    ASKED_BIND="${addrs[$((pick-1))]}"
  elif [ "$pick" = "$i" ]; then
    ASKED_BIND=0.0.0.0
  elif [ "$pick" = "$((i+1))" ]; then
    ASKED_BIND=127.0.0.1; ASKED_MODE=local
  elif [[ "$pick" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
    ASKED_BIND="$pick"   # a typed address
  else
    die "'$pick' is not a menu number or an address — run ./launch.sh -r and try again"
  fi
}

# Closing line of every first-run: where the answers went and how to change them.
confirm_saved() {
  echo
  echo "Saved to $ENV_FILE — these choices persist across restarts and updates."
  echo "Change them any time:  ./launch.sh  then press r."
  echo
}

# The host port as currently configured (PORT_VAR may be empty when the
# compose file publishes a fixed port).
current_port() {
  local p=""
  [ -n "${PORT_VAR:-}" ] && p=$(get_env "$PORT_VAR")
  echo "${p:-$PORT_DEFAULT}"
}

# Where to open the app, phrased for whoever is standing at the box.
open_hint() {
  local bind
  bind=$(get_env "$BIND_VAR")
  if [ "$bind" = "127.0.0.1" ]; then
    echo "  Open on this machine:  http://localhost:$(current_port)"
  else
    echo "  Open from a device:    http://<the box's address>:$(current_port)"
  fi
}

# Compose invocation — override above the marker when the app switches
# compose files by saved mode.
declare -f compose >/dev/null || compose() { docker compose "$@"; }

# Plain-language answer to "is it running?", readable over the phone.
# Health-based default; an app whose compose defines no healthcheck
# overrides this above the marker.
declare -f status >/dev/null || status() {
  local state
  # tail -1 + the emptiness check absorb both failure shapes: no such
  # container (error, empty output — the || true keeps set -e/pipefail
  # from killing the script) and a present container with no health
  # record yet (empty template result).
  state=$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null | tail -1 || true)
  [ -n "$state" ] || state=absent
  case "$state" in
    healthy)
      echo "✔ ${APP_THING^} is running and answering."
      open_hint ;;
    starting)
      echo "… ${APP_THING^} is starting up — give it half a minute, then run this again." ;;
    unhealthy)
      echo "✘ ${APP_THING^} is running but NOT answering."
      echo "  Press Enter on the menu to restart it, then check again."
      echo "  If it stays broken, press l and read the last messages to support." ;;
    absent)
      echo "✘ ${APP_THING^} is not running at all."
      echo "  Press Enter on the menu to start it." ;;
    *)
      echo "? ${APP_THING^} is in state: $state — try a restart (Enter on the menu)." ;;
  esac
}

# Recent app messages — for reading an error to support over the phone.
logs() {
  compose logs --tail 40 "$CONTAINER"
  echo
  echo "(These are the newest messages, oldest first. The lines near the bottom"
  echo "are usually the ones that explain a problem.)"
}

# Update to the newest version. Data is untouched — it lives in a volume
# the update never rewrites. Apps that update by pulling a released image
# override this above the marker.
declare -f update >/dev/null || update() {
  echo "→ fetching the newest code…"
  git pull --ff-only || {
    echo "Could not fetch the update (no network, or the checkout has local"
    echo "changes). ${APP_THING^} keeps running as-is; tell support what it printed."
    return 1
  }
  echo "→ restarting on the new version…"
  compose up -d --build
  echo "Done. Check it:  ./launch.sh  then press s."
}

# Start, or turn-it-off-and-on-again. Recreating the container is safe:
# the data lives in a volume that restarts never touch.
launch() {
  local bind
  bind=$(get_env "$BIND_VAR")
  [ -n "$(get_env "$MODE_KEY")" ] || die "no saved setup — run ./launch.sh and answer the questions"
  echo "→ starting $APP_THING (bind ${bind:-unset}, port $(current_port))…"
  local build=()
  [ -n "${LAUNCH_BUILD-1}" ] && build=(--build)
  compose up -d "${build[@]}" --force-recreate
  echo
  echo "Started. It takes ~half a minute to come up; check with: ./launch.sh then s"
  open_hint
}

menu() {
  local mode bind
  mode=$(get_env "$MODE_KEY"); bind=$(get_env "$BIND_VAR")
  echo "$APP_NAME — saved setup: $mode (bind ${bind:-unset})"
  echo
  echo "  [Enter]  Start / restart $APP_THING   (safe — never touches the data)"
  echo "  s        Is it running?"
  echo "  l        Show the recent app messages"
  echo "  u        Update to the newest version"
  echo "  r        Change the setup ($CONFIG_SUMMARY)"
  echo "  q        Quit"
  echo
  local answer
  read -rp "Choose: " answer
  case "$answer" in
    "")   launch ;;
    s|S)  status ;;
    l|L)  logs ;;
    u|U)  update ;;
    r|R)  configure; launch ;;
    q|Q)  exit 0 ;;
    *)    die "unrecognised choice: $answer" ;;
  esac
}

case "${1:-}" in
  --reconfigure|-r) configure; launch ;;
  --status|-s)      status ;;
  --logs|-l)        logs ;;
  --update|-u)      update ;;
  --help|-h)
    awk 'NR>1 && !/^#/{exit} NR>1{sub(/^# ?/,""); print}' "$0"
    exit 0
    ;;
  "")
    if [ -z "$(get_env "$MODE_KEY")" ]; then
      [ -t 0 ] || die "no saved setup and no terminal to ask on — run ./launch.sh interactively first"
      configure
      launch
    elif [ -t 0 ]; then
      menu
    else
      launch   # non-interactive with a saved setup: just make sure it is up
    fi
    ;;
  *) die "unknown option: $1 (try --help)" ;;
esac
# <<< launcher-core <<<
