#!/bin/sh
# Temporarily lifts the /etc/hosts block so the LG Content Store can update apps.
# Deployed to /var/lib/webosbrew/store-mode.sh; called as root (via
# org.webosbrew.hbchannel.service/exec) by TV Home's Settings and by the
# standalone App-Updates app.
#   on      strip /etc/hosts to its stock header; restores it as soon as the
#           LG Store is left (watch), or after TIMEOUT seconds at the latest
#   off     restore the saved (blocked) hosts file
#   status  print "blocked" or "open <seconds left>"
# A reboot also restores everything: /tmp is wiped and the init.d hooks re-block.
# Also lifts / re-applies the background-service block (debloat.sh) if the TV
# has it, since the Store and updates may need LG's services.

BAK=/tmp/hosts.storemode
DEBLOAT=/var/lib/webosbrew/debloat.sh
TIMER_PID=/tmp/storemode.pid
WATCH_PID=/tmp/storemode-watch.pid
STORE_APP=com.webos.app.discovery
DEADLINE=/tmp/storemode.deadline
TIMEOUT=${STOREMODE_TIMEOUT:-600}
MARK='# This file is dynamically regenerated on boot by webosbrew'

stop_timer() {
    [ -f "$TIMER_PID" ] && kill "$(cat "$TIMER_PID")" 2>/dev/null
    [ -f "$WATCH_PID" ] && kill "$(cat "$WATCH_PID")" 2>/dev/null
    rm -f "$TIMER_PID" "$WATCH_PID" "$DEADLINE"
}

foreground() {
    luna-send -n 1 -w 3000 luna://com.webos.applicationManager/getForegroundAppInfo '{}' \
        < /dev/null 2>/dev/null | sed -n 's/.*"appId":"\([^"]*\)".*/\1/p'
}

case "$1" in
on)
    if [ ! -f "$BAK" ]; then
        if ! grep -q "^$MARK" /etc/hosts; then
            echo "error: marker not found in /etc/hosts" >&2
            exit 1
        fi
        cp /etc/hosts "$BAK"
    fi
    # Everything before the webosbrew marker is the stock header.
    awk -v m="$MARK" 'index($0, m) == 1 { exit } { print }' "$BAK" > /tmp/hosts.stock
    cat /tmp/hosts.stock > /etc/hosts
    rm -f /tmp/hosts.stock
    stop_timer
    echo $(( $(date +%s) + TIMEOUT )) > "$DEADLINE"
    setsid sh "$0" timer > /dev/null 2>&1 < /dev/null &
    setsid sh "$0" watch > /dev/null 2>&1 < /dev/null &
    [ -f "$DEBLOAT" ] && setsid sh "$DEBLOAT" lift > /dev/null 2>&1 < /dev/null &
    echo "open $TIMEOUT"
    ;;
off)
    stop_timer
    if [ -f "$BAK" ]; then
        cat "$BAK" > /etc/hosts
        rm -f "$BAK"
    fi
    [ -f "$DEBLOAT" ] && setsid sh "$DEBLOAT" apply > /dev/null 2>&1 < /dev/null &
    echo blocked
    ;;
timer)
    echo $$ > "$TIMER_PID"
    sleep "$TIMEOUT"
    rm -f "$TIMER_PID"
    sh "$0" off > /dev/null
    ;;
watch)
    # Re-lock once the Store has been on screen and another app has taken
    # over (seen twice in a row, 3 s apart, so a blip doesn't count). If the
    # Store never shows up, the timer still re-locks.
    echo $$ > "$WATCH_PID"
    seen=0 away=0
    while [ -f "$BAK" ]; do
        sleep 3
        app=$(foreground)
        case "$app" in
            '') ;;
            "$STORE_APP") seen=1 away=0 ;;
            *) [ $seen = 1 ] && away=$((away + 1)) ;;
        esac
        if [ $away -ge 2 ]; then
            rm -f "$WATCH_PID"
            sh "$0" off > /dev/null
            exit 0
        fi
    done
    rm -f "$WATCH_PID"
    ;;
status)
    if [ -f "$BAK" ]; then
        left=$TIMEOUT
        [ -f "$DEADLINE" ] && left=$(( $(cat "$DEADLINE") - $(date +%s) ))
        [ "$left" -lt 0 ] && left=0
        echo "open $left"
    else
        echo blocked
    fi
    ;;
*)
    echo "usage: $0 on|off|status" >&2
    exit 2
    ;;
esac
