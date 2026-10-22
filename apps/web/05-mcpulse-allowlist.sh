#!/bin/sh
# Expands the administrator address list into individual nginx "allow"
# directives. nginx accepts exactly one address per directive, so a list such
# as "10.0.0.0/8 1.2.3.4" has to be rendered as one "allow" line per address.
#
# Runs before the nginx entrypoint renders the template with envsubst, so it
# rewrites the template itself.
set -eu

TEMPLATE="${TEMPLATE:-/etc/nginx/templates/default.conf.template}"

[ -f "$TEMPLATE" ] || exit 0

ALLOWLIST="${MCPULSE_ADMIN_IP:-127.0.0.1}"

TMP="$(mktemp)"
FOUND=0

while IFS= read -r line; do
    case "$line" in
        *__MCPULSE_ALLOWLIST__*)
            FOUND=1
            for address in $(printf '%s' "$ALLOWLIST" | tr ',;' '  '); do
                [ -n "$address" ] || continue
                printf '            allow %s;\n' "$address"
            done
            ;;
        *)
            printf '%s\n' "$line"
            ;;
    esac
done < "$TEMPLATE" > "$TMP"

if [ "$FOUND" = "1" ]; then
    mv "$TMP" "$TEMPLATE"
else
    rm -f "$TMP"
fi
