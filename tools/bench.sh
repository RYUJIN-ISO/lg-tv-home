#!/usr/bin/env bash
# Measures launcher smoothness on the TV: runs the launcher's scripted
# navigation (moves focus for ~8 s ON SCREEN) 3x and prints frame stats.
#   TV=<ssh host> tools/bench.sh
# Reference (LG OLED 2024, webOS 25, v0.9.0): fps 59.7-60.0, 0-2 frames >25 ms.
cd "$(dirname "$0")/.."
. lib/common.sh
[ -n "$TV" ] || die "set TV=<ssh host of the TV>"
tv "L=luna://com.webos.applicationManager/launch; rm -f /tmp/atvhome-bench.txt
    luna-send -n 1 -w 8000 \$L '{\"id\":\"$HOME_APP\"}' >/dev/null; sleep 6
    for n in 1 2 3; do luna-send -n 1 -w 8000 \$L '{\"id\":\"$HOME_APP\",\"params\":{\"bench\":true}}' >/dev/null; sleep 9; done
    cat /tmp/atvhome-bench.txt"
