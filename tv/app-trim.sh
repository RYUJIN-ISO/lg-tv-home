#!/bin/sh
# Replaces LG's preloading (preload-manager is stopped by debloat.sh): keeps
# only the app in use and the one used before it in RAM, closes other user
# apps. System apps, the launcher, Homebrew stuff and inputs are never closed.
# Deployed to /var/lib/webosbrew/app-trim.sh; started by init.d/85-app-trim.

# One watcher only (the boot hook and a manual start must not double up).
PIDFILE=/tmp/app-trim.pid
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "already running" >&2
    exit 0
fi
echo $$ > "$PIDFILE"

KEEP_ALWAYS=" com.iso.atvhome com.webos.app.home com.webos.app.livetv com.webos.app.screensaver "
# LG's own apps that behave like user apps (preloaded or opened from home).
LG_USER_APPS=" com.webos.app.browser com.webos.app.lgchannels com.webos.app.voice com.webos.app.discovery com.webos.app.mediadiscovery com.webos.app.homeconnect com.webos.app.lifeonscreen com.webos.app.sportsteamsettings amazon.alexa.view "
INTERVAL=3

luna() {
    p=$2; [ -n "$p" ] || p='{}'
    luna-send -n 1 -w 5000 "$1" "$p" < /dev/null 2>/dev/null
}

is_user_app() {
    case "$1" in com.iso.*|org.webosbrew.*) return 1 ;; esac
    case "$LG_USER_APPS" in *" $1 "*) return 0 ;; esac
    [ -d "/media/cryptofs/apps/usr/palm/applications/$1" ] ||
        [ -d "/media/developer/apps/usr/palm/applications/$1" ]
}

trim() {
    luna luna://com.webos.applicationManager/running |
        sed 's/"id":"/\n/g' | sed -n '2,$s/".*//p' | sort -u |
        while read -r id; do
            case "$KEEP_ALWAYS" in *" $id "*) continue ;; esac
            [ "$id" = "$CUR" ] || [ "$id" = "$PREV" ] && continue
            is_user_app "$id" || continue
            luna luna://com.webos.applicationManager/closeByAppId "{\"id\":\"$id\"}" > /dev/null
            echo "$(date +%T) closed $id (current=$CUR previous=$PREV)"
        done
}

foreground() {
    luna luna://com.webos.applicationManager/getForegroundAppInfo |
        sed -n 's/.*"appId":"\([^"]*\)".*/\1/p'
}

# Start: keep whatever is on screen, close what LG preloaded in the background.
CUR=""; PREV=""
fg=$(foreground)
is_user_app "$fg" && CUR=$fg
trim

# At boot LG may still preload apps until debloat.sh has stopped its preload
# manager: trim once more as soon as debloat reports it is done.
DEBLOATED=""
while :; do
    sleep $INTERVAL
    if [ -z "$DEBLOATED" ] && [ "$(cat /tmp/debloat.state 2>/dev/null)" = applied ]; then
        DEBLOATED=1
        trim
    fi
    fg=$(foreground)
    if [ -n "$fg" ] && [ "$fg" != "$CUR" ] && is_user_app "$fg"; then
        PREV=$CUR; CUR=$fg
        trim
    fi
done
