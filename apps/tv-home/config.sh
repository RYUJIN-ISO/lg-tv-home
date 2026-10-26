#!/bin/sh
# Saves the launcher config outside the app (survives reinstalls).
# Usage: config.sh save <base64 JSON>   (called via hbchannel exec)
DATA=/var/lib/webosbrew/atvhome
mkdir -p "$DATA/wallpapers"
case "$1" in
save)
    echo "$2" | base64 -d > "$DATA/config.json.tmp" &&
        mv "$DATA/config.json.tmp" "$DATA/config.json" && echo saved
    ;;
*)
    echo "usage: $0 save <base64>" >&2; exit 2 ;;
esac
