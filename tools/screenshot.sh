#!/usr/bin/env bash
# Saves a screenshot of the TV screen: TV=<ssh host> tools/screenshot.sh [out.png]
cd "$(dirname "$0")/.."
. lib/common.sh
[ -n "$TV" ] || die "set TV=<ssh host of the TV>"
out=${1:-tv-screenshot.png}
tv "rm -f /tmp/cap.png; luna-send -n 1 -w 10000 luna://com.webos.service.capture/executeOneShot \
    '{\"path\":\"/tmp/cap.png\",\"method\":\"DISPLAY\",\"format\":\"PNG\",\"width\":1920,\"height\":1080}' >/dev/null"
scp -q -o BatchMode=yes "$TV:/tmp/cap.png" "$out" 2>/dev/null && say "saved $out"
