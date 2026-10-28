#!/bin/sh
# Saves a logo the page cut out of an app's splash screen (see cache.js).
# Called via hbchannel exec:
#   autotile.sh part <name> <base64>   append one part (an exec argument must stay < 128 KiB)
#   autotile.sh save <app> <name>      decode the parts to autotiles/<name>, drop older ones of <app>
#   autotile.sh none <app> <name>      no logo in this splash: an empty marker, not tried again
DIR=/var/lib/webosbrew/atvhome/autotiles
for a in "$2" "$3"; do case "$a" in *[!A-Za-z0-9._-]*) echo "bad name" >&2; exit 2 ;; esac; done
mkdir -p "$DIR"
case "$1" in
part) echo "$3" >> "/tmp/autotile-$2.b64" ;;
save)
    rm -f "$DIR/$2".[0-9]*
    base64 -d "/tmp/autotile-$3.b64" > "$DIR/$3" && echo saved
    rm -f "/tmp/autotile-$3.b64"
    ;;
none) rm -f "$DIR/$2".[0-9]*; : > "$DIR/$3" ;;
*) echo "usage: $0 part|save|none ..." >&2; exit 2 ;;
esac
