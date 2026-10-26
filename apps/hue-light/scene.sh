#!/bin/sh
# Toggles a Philips Hue "movie" scene. Called as root via
# org.webosbrew.hbchannel.service/exec by the TV Home "Light" button and by the
# "Movie" app.
#   1st press: save the current lights into the RESTORE scene, recall SCENE  -> prints "movie"
#   2nd press: recall the RESTORE scene (lights exactly as before)          -> prints "restored"
# Config lives outside the app so a reinstall keeps it: /var/lib/webosbrew/hue-scene.conf
#   BRIDGE=<bridge IP>  KEY=<hue api key>  GROUP=<room/zone id>  SCENE=<movie scene id>
#   RESTORE=<id of a GroupScene used as the "before" snapshot>
# tools/hue-setup.sh creates all of this interactively.

CONF=/var/lib/webosbrew/hue-scene.conf
MODE=/var/lib/webosbrew/hue-scene.mode
[ -f "$CONF" ] || { echo "no config at $CONF" >&2; exit 1; }
. "$CONF"
API="https://$BRIDGE/api/$KEY"

hue() {  # hue <path> <json>: PUT, fail unless the bridge reports success
    out=$(curl -sk -m 5 -X PUT "$API$1" -d "$2") || { echo "bridge not reachable" >&2; exit 1; }
    case "$out" in
        *error*|"") echo "$out" >&2; exit 1 ;;
    esac
}

if [ "$(cat "$MODE" 2>/dev/null)" = movie ]; then
    hue "/groups/$GROUP/action" "{\"scene\":\"$RESTORE\"}"
    echo normal > "$MODE"
    echo restored
else
    hue "/scenes/$RESTORE" '{"storelightstate":true}'
    hue "/groups/$GROUP/action" "{\"scene\":\"$SCENE\"}"
    echo movie > "$MODE"
    echo movie
fi
