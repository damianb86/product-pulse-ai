#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

REMOTE_USER=${REMOTE_USER:-ubuntu}
REMOTE_HOST=${REMOTE_HOST:-3.135.94.213}
REMOTE_APP_DIR=${REMOTE_APP_DIR:-/opt/apps/product-pulse-ai}
REMOTE_ENV_FILE=${REMOTE_ENV_FILE:-.env}
PEM_FILE=${PEM_FILE:-ssh.pem}
LOCAL_ENV_FILE=${LOCAL_ENV_FILE:-}
BUILD_COMMAND=${BUILD_COMMAND:-"npm run build:production"}
REMOTE_GIT_REF=${REMOTE_GIT_REF:-origin/main}
REMOTE_GIT_SYNC_COMMAND=${REMOTE_GIT_SYNC_COMMAND:-"git fetch --prune origin && git reset --hard $REMOTE_GIT_REF"}
REMOTE_DEPLOY_COMMAND=${REMOTE_DEPLOY_COMMAND:-"APP_ENV_FILE=.env BUILD_APP_BUNDLE=0 ./deploy.sh"}
SSH_CONNECT_TIMEOUT_SECONDS=${SSH_CONNECT_TIMEOUT_SECONDS:-15}

SSH_TARGET="$REMOTE_USER@$REMOTE_HOST"
SSH_OPTS="-i $PEM_FILE -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=$SSH_CONNECT_TIMEOUT_SECONDS -o ServerAliveInterval=15 -o ServerAliveCountMax=2 -o StrictHostKeyChecking=accept-new"
RSYNC_SSH="ssh $SSH_OPTS"

start_step() {
  STEP_NAME=$1
  STEP_STARTED_AT=$(date +%s)
  printf '\n%s...\n' "$STEP_NAME"
}

finish_step() {
  STEP_FINISHED_AT=$(date +%s)
  printf '%s completed in %ss\n' "$STEP_NAME" "$((STEP_FINISHED_AT - STEP_STARTED_AT))"
}

require_file() {
  FILE=$1
  MESSAGE=$2
  if [ ! -f "$FILE" ]; then
    printf '%s\n' "$MESSAGE" >&2
    exit 1
  fi
}

require_command() {
  COMMAND=$1
  if ! command -v "$COMMAND" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$COMMAND" >&2
    exit 1
  fi
}

shell_quote() {
  printf "'%s'" "$(printf "%s" "$1" | sed "s/'/'\\\\''/g")"
}

cd "$APP_DIR"

if [ -z "$LOCAL_ENV_FILE" ]; then
  if [ -f "$APP_DIR/.env.production" ]; then
    LOCAL_ENV_FILE="$APP_DIR/.env.production"
  elif [ -f "$APP_DIR/.production" ]; then
    LOCAL_ENV_FILE="$APP_DIR/.production"
  else
    LOCAL_ENV_FILE="$APP_DIR/.env"
  fi
fi

require_command npm
require_command rsync
require_command ssh
require_file "$PEM_FILE" "Missing PEM file: $PEM_FILE. Run with PEM_FILE=/path/to/ssh.pem ./deploy-production.local.sh if it lives elsewhere."
require_file "$LOCAL_ENV_FILE" "Missing production env file: $LOCAL_ENV_FILE"

chmod 400 "$PEM_FILE" 2>/dev/null || true

printf 'Deploying ProductPulse AI production build\n'
printf '  local app:   %s\n' "$APP_DIR"
printf '  build env:   %s\n' "$LOCAL_ENV_FILE"
printf '  server:      %s\n' "$SSH_TARGET"
printf '  remote app:  %s\n' "$REMOTE_APP_DIR"
if [ -n "$REMOTE_ENV_FILE" ]; then
  printf '  runtime env: %s\n' "$REMOTE_ENV_FILE"
else
  printf '  runtime env: auto (.env)\n'
fi
printf '  pem:         %s\n' "$PEM_FILE"
if [ -n "$REMOTE_GIT_SYNC_COMMAND" ]; then
  printf '  remote git:  %s\n' "$REMOTE_GIT_SYNC_COMMAND"
else
  printf '  remote git:  disabled\n'
fi

start_step "Building production bundle locally"
APP_ENV_FILE="$LOCAL_ENV_FILE" sh -c "$BUILD_COMMAND"
finish_step

require_file "$APP_DIR/build/server/index.js" "Missing build/server/index.js after build."
require_file "$APP_DIR/build/product-pulse-worker.mjs" "Missing build/product-pulse-worker.mjs after build."

start_step "Checking remote app directory"
REMOTE_CHECK_COMMAND="REMOTE_APP_DIR=$(shell_quote "$REMOTE_APP_DIR") REMOTE_ENV_FILE=$(shell_quote "$REMOTE_ENV_FILE") sh -s"
ssh $SSH_OPTS "$SSH_TARGET" "$REMOTE_CHECK_COMMAND" <<'REMOTE_CHECK'
set -eu

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

if [ ! -d "$REMOTE_APP_DIR" ]; then
  fail "Missing remote app directory: $REMOTE_APP_DIR"
fi

if [ ! -f "$REMOTE_APP_DIR/deploy.sh" ]; then
  fail "Missing remote deploy script: $REMOTE_APP_DIR/deploy.sh"
fi

if [ ! -x "$REMOTE_APP_DIR/deploy.sh" ]; then
  fail "Remote deploy script is not executable. Run: chmod +x $REMOTE_APP_DIR/deploy.sh"
fi

if [ -n "$REMOTE_ENV_FILE" ]; then
  case "$REMOTE_ENV_FILE" in
    /*) REMOTE_ENV_PATH=$REMOTE_ENV_FILE ;;
    *) REMOTE_ENV_PATH="$REMOTE_APP_DIR/$REMOTE_ENV_FILE" ;;
  esac

  if [ ! -f "$REMOTE_ENV_PATH" ]; then
    fail "Missing remote app env file: $REMOTE_ENV_PATH"
  fi

  printf 'Remote app env: %s\n' "$REMOTE_ENV_PATH"
elif [ -f "$REMOTE_APP_DIR/.env" ]; then
  printf 'Remote app env: %s\n' "$REMOTE_APP_DIR/.env"
else
  fail "Missing remote app env file. Expected $REMOTE_APP_DIR/.env"
fi
REMOTE_CHECK
finish_step

if [ -n "$REMOTE_GIT_SYNC_COMMAND" ]; then
  start_step "Updating remote code from Git"
  REMOTE_APP_DIR_QUOTED=$(shell_quote "$REMOTE_APP_DIR")
  ssh $SSH_OPTS "$SSH_TARGET" "cd $REMOTE_APP_DIR_QUOTED && $REMOTE_GIT_SYNC_COMMAND"
  finish_step
fi

start_step "Uploading build directory to production server"
rsync -az --delete -e "$RSYNC_SSH" "$APP_DIR/build/" "$SSH_TARGET:$REMOTE_APP_DIR/build/"
finish_step

start_step "Running remote deploy"
REMOTE_APP_DIR_QUOTED=$(shell_quote "$REMOTE_APP_DIR")
ssh $SSH_OPTS "$SSH_TARGET" "cd $REMOTE_APP_DIR_QUOTED && $REMOTE_DEPLOY_COMMAND"
finish_step

printf '\nProduction deploy complete.\n'
