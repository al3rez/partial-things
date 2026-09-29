#!/bin/sh
cd "$(dirname "$0")" || exit 1
PHP="${PHP:-$HOME/.local/opt/php/php}"
PORT="${PORT:-8787}"
if [ ! -x "$PHP" ]; then
  echo "PHP binary not found at $PHP" >&2
  exit 1
fi
exec "$PHP" -S 127.0.0.1:"$PORT" -t public public/router.php
