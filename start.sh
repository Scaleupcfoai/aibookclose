#!/bin/sh
BACKEND_HOST=$(echo "$BACKEND_URL" | sed 's|https\?://||' | sed 's|/.*||' | sed 's|:.*||')

sed -e "s|__PORT__|${PORT:-80}|g" \
    -e "s|__BACKEND_URL__|${BACKEND_URL:-http://localhost:8000}|g" \
    -e "s|__BACKEND_HOST__|${BACKEND_HOST:-localhost}|g" \
    /etc/nginx/nginx.conf.template > /etc/nginx/conf.d/default.conf

nginx -g 'daemon off;'
