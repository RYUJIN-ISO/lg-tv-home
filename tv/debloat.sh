#!/bin/sh
# Stops LG's tracking / profiling / unused background services.
# Deployed to /var/lib/webosbrew/debloat.sh; run at boot by init.d/80-debloat,
# lifted / re-applied by the App-Updates app (store-mode.sh) so the LG Store
# and updates work while it's open.
#   apply   stop + block the selected groups (default state)
#   lift    undo until the next apply or reboot
#   status  print "applied" or "lifted"
# Which groups are blocked comes from /var/lib/webosbrew/debloat.conf (written
# by install.sh). Everything is runtime-only (/run masks, bind mounts): delete
# the init.d hook and reboot to get the stock TV back.
#
# Tested on webOS 25 (LG OLED 2024). Units/binaries missing on other models
# are skipped.

CONF=/var/lib/webosbrew/debloat.conf
# Defaults if the conf is missing: block tracking only.
BLOCK_TRACKING=1
BLOCK_PRELOAD=0
BLOCK_VOICE=0
BLOCK_SMARTHOME=0
BLOCK_MISC=0
[ -f "$CONF" ] && . "$CONF"

UNITS=""
BINARIES=""
# Usage profiling, ads, log/usage uploads, promos, recommendations.
if [ "$BLOCK_TRACKING" = 1 ]; then
    UNITS="$UNITS contentminer user-context-manager nudge com.webos.service.pushclient
           rdxd remotelogger service-logger rec-info-adapter rec-listmgr"
    BINARIES="$BINARIES /usr/sbin/uploadd /usr/sbin/admanager"
fi
# LG preloading apps at boot (replaced by app-trim.sh).
[ "$BLOCK_PRELOAD" = 1 ] && UNITS="$UNITS preload-manager"
# Voice search / mic button. The voice app ignores closeByAppId -> stub it.
if [ "$BLOCK_VOICE" = 1 ]; then
    UNITS="$UNITS voiceinput voiceconductor"
    BINARIES="$BINARIES /usr/bin/com.webos.app.voice"
fi
# LG ThinQ, Google Home, Alexa smart-home linking. trigger_alexa is never
# blocked: on some TVs the Alexa remote button depends on it.
if [ "$BLOCK_SMARTHOME" = 1 ]; then
    UNITS="$UNITS google-home-controller"
    BINARIES="$BINARIES /usr/sbin/lg.thinqai.adapter /usr/sbin/trigger_thinq
              /usr/palm/services/com.webos.service.iotclient/iot-client"
fi
# Car mode, fitness-machine bluetooth.
[ "$BLOCK_MISC" = 1 ] && UNITS="$UNITS com.webos.service.mycar ftms"

STUB=/var/lib/webosbrew/debloat-stub
STATE=/tmp/debloat.state

apply() {
    [ -x "$STUB" ] || { printf '#!/bin/sh\nexit 1\n' > "$STUB"; chmod 755 "$STUB"; }
    for u in $UNITS; do
        # (file check: every systemctl call costs 10-20 s on these TVs)
        [ -e "/etc/systemd/system/$u.service" ] || [ -e "/lib/systemd/system/$u.service" ] || [ -e "/usr/lib/systemd/system/$u.service" ] || continue
        systemctl mask --runtime "$u.service" > /dev/null 2>&1
        systemctl stop "$u.service" > /dev/null 2>&1
    done
    # On-demand (ls-hubd activated) services: cover the binary with a stub that
    # exits at once, so the hub fails calls in ~0.1 s instead of respawning them.
    for b in $BINARIES; do
        [ -e "$b" ] || continue
        grep -q " $b " /proc/mounts || mount --bind "$STUB" "$b"
        pkill -f "^$b" 2>/dev/null
    done
    echo applied > "$STATE"
}

lift() {
    for b in $BINARIES; do
        while grep -q " $b " /proc/mounts; do umount "$b" || break; done
    done
    for u in $UNITS; do
        systemctl unmask --runtime "$u.service" > /dev/null 2>&1
        systemctl start "$u.service" > /dev/null 2>&1
    done
    echo lifted > "$STATE"
}

# systemctl is slow on these TVs (~10-20 s per call), so an apply/lift can
# still be running when the App-Updates toggle flips again: newest call wins.
case "$1" in
apply|lift)
    for p in $(pgrep -f "debloat.sh (apply|lift)"); do
        [ "$p" != "$$" ] && kill "$p" 2>/dev/null
    done
    ;;
esac

case "$1" in
apply)  apply; echo applied ;;
lift)   lift; echo lifted ;;
status) cat "$STATE" 2>/dev/null || echo lifted ;;
*)      echo "usage: $0 apply|lift|status" >&2; exit 2 ;;
esac
