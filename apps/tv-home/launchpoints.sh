#!/bin/sh
# Prints the home screen's launch points (LG's own order, incl. named HDMI
# bookmarks) as JSON, with icons/art copied into this app (see cache.js).
# listLaunchPoints is a private method, so the app runs this as root through
# the Homebrew Channel exec service. The first call after idle sometimes gets
# no reply, hence the retries.
DIR=$(dirname "$0")
OUT=/tmp/atvhome-lp.json
APPS=/tmp/atvhome-apps.json
# Installed apps too, so apps LG never put on its home can be added.
for i in 1 2 3; do
  luna-send -w 15000 -n 1 luna://com.webos.applicationManager/listApps '{}' < /dev/null > "$APPS" 2>/dev/null
  [ -s "$APPS" ] && break
done
for i in 1 2 3 4; do
  luna-send -w 15000 -n 1 luna://com.webos.applicationManager/listLaunchPoints '{}' < /dev/null > "$OUT" 2>/dev/null
  if [ -s "$OUT" ]; then node "$DIR/cache.js" "$OUT" "$APPS"; rc=$?; rm -f "$OUT" "$APPS"; exit $rc; fi
done
rm -f "$OUT" "$APPS"
echo "listLaunchPoints gave no reply" >&2
exit 1
