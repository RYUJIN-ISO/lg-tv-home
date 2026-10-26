#!/bin/sh
# Temporarily lifts the /etc/hosts block so the LG Content Store can update apps.
# Deployed to /var/lib/webosbrew/store-mode.sh; called as root (via
# org.webosbrew.hbchannel.service/exec) by TV Home's Settings and by the
# standalone App-Updates app.
#   on      strip /etc/hosts to its stock header, auto-restore after TIMEOUT seconds
#   off     restore the saved (blocked) hosts file
#   status  print "blocked" or "open <seconds left>"
# A reboot also restores everything: /tmp is wiped and the init.d hooks re-block.
# Also lifts / re-applies the background-service block (debloat.sh) if the TV
# has it, since the Store and updates may need LG's services.

BAK=/tmp/hosts.storemode
DEBLOAT=/var/lib/webosbrew/debloat.sh
TIMER_PID=/tmp/storemode.pid
DEADLINE=/tmp/storemode.deadline
TIMEOUT=${STOREMODE_TIMEOUT:-600}
MARK='# This file is dynamically regenerated on boot by webosbrew'

stop_timer() {
    [ -f "$TIMER_PID" ] && kill "$(cat "$TIMER_PID")" 2>/dev/null
    rm -f "$TIMER_PID" "$DEADLINE"
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
