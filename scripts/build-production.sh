#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE=${APP_ENV_FILE:-"$APP_DIR/.env.production"}

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing production env file: $ENV_FILE" >&2
  echo "Create .env.production or pass APP_ENV_FILE=/path/to/env." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

cd "$APP_DIR"

if [ "${BUILD_SENTRY_SOURCEMAPS:-0}" != "1" ]; then
  SENTRY_AUTH_TOKEN=
  SENTRY_ORG=
  SENTRY_PROJECT=
  export SENTRY_AUTH_TOKEN SENTRY_ORG SENTRY_PROJECT
fi

NODE_OPTIONS=${BUILD_NODE_OPTIONS:-"--max-old-space-size=4096"}
export NODE_OPTIONS
npm run build
