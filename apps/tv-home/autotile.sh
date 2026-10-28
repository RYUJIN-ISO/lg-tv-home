#!/bin/sh
# Saves a logo the page cut out of an app's splash screen (see cache.js).
# Called via hbchannel exec:
#   autotile.sh part <name> <base64>   append one part (an exec argument must stay < 128 KiB)
#   autotile.sh save <app> <name>      decode the parts to autotiles/<name>, drop older ones of <app>
#   autotile.sh none <app> <name>      no logo in this splash: an empty marker, not tried again
DIR=/var/lib/webosbrew/atvhome/autotiles
TMP=/tmp/autotile-$2
ok_name() { case "$1" in ''|*[!A-Za-z0-9._-]*) echo "bad name: $1" >&2; exit 2 ;; esac; }
ok_name "$2"
mkdir -p "$DIR"
case "$1" in
part) echo "$3" >> "$TMP.b64" ;;
save)
    ok_name "$3"
    TMP=/tmp/autotile-$3
    # Only a real picture replaces the old one (a PNG starts with \211PNG).
    if base64 -d "$TMP.b64" > "$TMP.png" 2>/dev/null && [ "$(head -c 4 "$TMP.png" | tail -c 3)" = PNG ]; then
        rm -f "$DIR/$2".[0-9]*
        mv "$TMP.png" "$DIR/$3" && echo saved
    else
        echo "not a picture" >&2
    fi
    rm -f "$TMP.b64" "$TMP.png"
    ;;
none) ok_name "$3"; rm -f "$DIR/$2".[0-9]*; : > "$DIR/$3" ;;
*) echo "usage: $0 part|save|none ..." >&2; exit 2 ;;
esac
