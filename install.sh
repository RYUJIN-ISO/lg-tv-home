#!/usr/bin/env bash
# lg-tv-home installer. Run it on a Linux or macOS computer that can SSH into
# a rooted LG webOS TV as root (Homebrew Channel plus an SSH key, see
# docs/PREREQUISITES.md).
#   ./install.sh          ask the setup questions, show a summary, then install
#   ./install.sh --yes    reuse the answers saved in setup.conf
# Running it again is safe: every step installs or updates in place.
set -e
cd "$(dirname "$0")"
. lib/common.sh

CONF=setup.conf
REUSE=0
[ "$1" = "--yes" ] && REUSE=1

# ------------------------------------------------------------ questions

ask() { # ask VAR "question" default yn|text
    local var=$1 q=$2 def=$3 kind=$4 cur="${!1:-$3}" a
    if [ "$REUSE" = 1 ]; then printf -v "$var" '%s' "$cur"; return; fi
    if [ "$kind" = yn ]; then
        read -rp "$q [$( [ "$cur" = y ] && echo Y/n || echo y/N )] " a
        a=${a:-$cur}; case "$a" in [Yy]*) a=y ;; *) a=n ;; esac
    else
        read -rp "$q [$cur] " a; a=${a:-$cur}
    fi
    printf -v "$var" '%s' "$a"
}

[ -f "$CONF" ] && . "./$CONF"
if [ -f "$CONF" ] && [ "$REUSE" = 0 ]; then
    read -rp "Found your answers from last time in $CONF. Use them without asking again? [Y/n] " a
    case "${a:-y}" in [Yy]*) REUSE=1 ;; esac
fi

cat <<'EOF'

  lg-tv-home setup
  ----------------
  Every question has a default in [brackets]; Enter accepts it.
  Nothing on the TV changes until you confirm the summary at the end.

EOF
ask TV "SSH host of the TV (an alias from ~/.ssh/config, or root@<ip>):" "lgtv" text
say "checking the TV"
tv true || die "cannot SSH into '$TV' as root (see docs/PREREQUISITES.md)"
tv "test -d /media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service" ||
    die "Homebrew Channel is not installed on the TV. Root it first (docs/PREREQUISITES.md)."
MODEL=$(luna luna://com.webos.service.tv.systemproperty/getSystemInfo '{"keys":["modelName"]}' |
    python3 -c "import json,sys; print(json.load(sys.stdin).get('modelName','?'))" 2>/dev/null || echo "?")
WEBOS=$(tv "nyx-cmd OSInfo query webos_release" 2>/dev/null || echo "?")
say "TV: $MODEL, webOS $WEBOS (tested on an LG OLED 2024 with webOS 10.3)"

echo
echo "1) Home screen"
ask LAUNCHER "Install TV Home, the Apple TV style home screen?" y yn
if [ "$LAUNCHER" = y ]; then
    ask SET_HOME "Make it the TV's home screen (Home button, after power on)? LG's stays installed." y yn
    ask LANGUAGE "Language, en or de (can be changed later in its Settings):" en text
    echo "   Philips Hue: rooms and lights in TV Home's Settings, plus a Light button that"
    echo "   switches between a cinema scene and the lighting from before (or a chosen scene)."
    ask LIGHT "Add Philips Hue control? (needs a Hue bridge on this network)" n yn
    echo "   Remote buttons: give the remote's app buttons (Netflix, Prime, ...), Mic, Input,"
    echo "   colour and number keys any app or action, in TV Home's Settings."
    ask REMOTE "Install the remote button mapper?" y yn
    echo "   Museum prints: 16 public-domain paintings (Monet, Turner, Cross, Twachtman) as"
    echo "   wallpapers and for the picture frame, uncropped, about 49 MB on the TV."
    ask PRINTS "Add the museum prints?" y yn
fi

echo
echo "2) Privacy"
ask ADBLOCK "Block LG's ad, tracking and ACR domains on the TV?" y yn
if [ "$ADBLOCK" = y ] && [ "$LAUNCHER" != y ]; then
    echo "   The block also locks the LG Content Store. TV Home has an App Store switch in its"
    echo "   Settings for that; without TV Home, a small App-Updates app does the same."
    ask APP_UPDATES "Install the App-Updates app?" y yn
fi
ask DEBLOAT "Stop LG's tracking and profiling background services (viewing data, usage logs, promos)?" y yn
if [ "$DEBLOAT" = y ]; then
    ask KEEP_VOICE "Does anyone use voice search with the mic button? (y keeps it)" n yn
    ask KEEP_SMARTHOME "Do you use the LG ThinQ app, Google Home or Alexa with the TV? (y keeps it)" n yn
fi

echo
echo "3) Speed and security"
ask APP_TRIM "Keep only the current and the previous app in memory instead of LG preloading 5 or 6?" y yn
ask TELNET_OFF "Turn off the passwordless root telnet that rooting leaves open? (SSH keeps working)" y yn

# Save the answers. No secrets in here; the Hue key only lives on the TV.
cat > "$CONF" <<EOF
TV=$TV
LAUNCHER=$LAUNCHER
SET_HOME=${SET_HOME:-n}
LANGUAGE=${LANGUAGE:-en}
LIGHT=${LIGHT:-n}
REMOTE=${REMOTE:-n}
PRINTS=${PRINTS:-n}
ADBLOCK=$ADBLOCK
APP_UPDATES=${APP_UPDATES:-n}
DEBLOAT=$DEBLOAT
KEEP_VOICE=${KEEP_VOICE:-y}
KEEP_SMARTHOME=${KEEP_SMARTHOME:-y}
APP_TRIM=$APP_TRIM
TELNET_OFF=$TELNET_OFF
EOF

echo
say "Summary"
sed 's/^/    /' "$CONF"
if [ "$REUSE" = 0 ]; then
    read -rp "Install this on the TV now? [Y/n] " a
    case "${a:-y}" in [Yy]*) ;; *) echo "Nothing changed. Your answers are saved in $CONF."; exit 0 ;; esac
fi

# ------------------------------------------------------------ install

tv "mkdir -p $WB/init.d $DATA/wallpapers $DATA/tiles"

if [ "$LAUNCHER" = y ]; then
    say "TV Home"
    install_app apps/tv-home "$HOME_APP" "TV Home launcher"
    # First install: start in the chosen language.
    tv "[ -f $DATA/config.json ] || echo '{\"language\":\"$LANGUAGE\"}' > $DATA/config.json"
    if [ "$SET_HOME" = y ]; then
        say "making TV Home the home screen"
        # Settings general/defaultApps.home, keeping the other categories.
        cur=$(luna luna://com.webos.settingsservice/getSystemSettings '{"category":"general","keys":["defaultApps"]}')
        apps=$(echo "$cur" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('settings',{}).get('defaultApps') or {}
d['home']='$HOME_APP'; print(json.dumps(d))")
        luna luna://com.webos.settingsservice/setSystemSettings \
            "{\"category\":\"general\",\"settings\":{\"defaultApps\":$apps}}" > /dev/null
        # Profile override: the idle app shown after boot or closing the last app.
        tv "echo '{\"idleApp\":{\"support\":true,\"appId\":\"$HOME_APP\"},\"defaultApps\":{\"support\":true,\"categories\":{\"home\":\"$HOME_APP\",\"aod\":\"com.webos.app.lifeonscreen\"}}}' > /var/webos-profile/override/atvhome_profile.json"
        luna luna://com.webos.service.systemprofile/debug/rescan > /dev/null || warn "profile rescan failed; it applies after the next reboot"
    fi
fi

if [ "$PRINTS" = y ]; then
    say "museum prints"
    tv "mkdir -p $DATA/wallpapers/thumbs"
    scp -q -o BatchMode=yes prints/*.jpg "$TV:$DATA/wallpapers/" || warn "copying the prints failed"
    scp -q -o BatchMode=yes prints/thumbs/*.jpg "$TV:$DATA/wallpapers/thumbs/" || warn "copying the print previews failed"
fi

if [ "$LIGHT" = y ]; then
    say "Light button"
    install_app apps/hue-light "$LIGHT_APP" "Philips Hue"
    if ! tv "test -f $WB/hue-scene.conf"; then
        say "Pair the Hue bridge on the TV: TV Home, Settings, Hue (or run tools/hue-setup.sh)"
    fi
fi

if [ "$REMOTE" = y ]; then
    say "remote button mapper"
    tv "mkdir -p $WB/remote-mapper"
    put tv/remote-mapper/remap.js "$WB/remote-mapper/remap.js"
    put tv/remote-mapper/remote-mapper.sh "$WB/remote-mapper/remote-mapper.sh" 755
    put tv/init.d/86-remote-mapper "$WB/init.d/86-remote-mapper" 755
    tv "[ -f $WB/remote-mapper/map.json ] || echo '{\"buttons\":{}}' > $WB/remote-mapper/map.json"
    tv "sh $WB/remote-mapper/remote-mapper.sh apply" > /dev/null || warn "the mapper is not active yet; it starts after the next reboot"
fi

if [ "$ADBLOCK" = y ]; then
    say "ad and tracking block list"
    tmp=$(mktemp)
    # The base ("safe") list only: list-store would break the Content Store for good.
    curl -sfL https://raw.githubusercontent.com/hugobatista/lg-tv-ad-block/main/list |
        awk '/^#/||/^$/{print;next}{print "0.0.0.0 " $2; print ":: " $2}' > "$tmp"
    [ -s "$tmp" ] || die "could not download the block list"
    put "$tmp" "$WB/lg-ad-block-hosts.txt"
    rm -f "$tmp"
    put tv/init.d/60-lg-ad-block "$WB/init.d/60-lg-ad-block" 755
    put tv/store-mode.sh "$WB/store-mode.sh" 755
    # Apply now unless it is already in /etc/hosts (the hook adds it on every boot).
    tv "grep -q 'lgsmartad.com' /etc/hosts || sh $WB/init.d/60-lg-ad-block"
    if [ "$APP_UPDATES" = y ]; then
        install_app apps/app-updates "$UPDATES_APP" "Temporarily unblocks the LG Content Store"
    fi
fi

if [ "$DEBLOAT" = y ]; then
    say "background services"
    b() { [ "$1" = y ] && echo 0 || echo 1; }
    conf=$(mktemp)
    printf 'BLOCK_TRACKING=1\nBLOCK_PRELOAD=%s\nBLOCK_VOICE=%s\nBLOCK_SMARTHOME=%s\nBLOCK_MISC=1\n' \
        "$( [ "$APP_TRIM" = y ] && echo 1 || echo 0 )" "$(b "$KEEP_VOICE")" "$(b "$KEEP_SMARTHOME")" > "$conf"
    put "$conf" "$WB/debloat.conf"
    rm -f "$conf"
    put tv/debloat.sh "$WB/debloat.sh" 755
    put tv/init.d/80-debloat "$WB/init.d/80-debloat" 755
    # systemctl is slow on these TVs, so this runs in the background (2 to 3 minutes).
    tv "setsid sh $WB/debloat.sh apply > /tmp/debloat.log 2>&1 < /dev/null &"
    say "stopping services in the background (2 to 3 minutes)"
fi

if [ "$APP_TRIM" = y ]; then
    say "app trimming"
    put tv/app-trim.sh "$WB/app-trim.sh" 755
    put tv/init.d/85-app-trim "$WB/init.d/85-app-trim" 755
    # app-trim.sh refuses to start a second copy on its own.
    tv "setsid sh $WB/app-trim.sh > /tmp/app-trim.log 2>&1 < /dev/null &"
fi

if [ "$TELNET_OFF" = y ]; then
    say "turning off telnet"
    tv "touch /var/luna/preferences/webosbrew_telnet_disabled; pkill -x telnetd || true"
fi

if [ "$LAUNCHER" = y ]; then
    luna luna://com.webos.applicationManager/launch "{\"id\":\"$HOME_APP\"}" > /dev/null || true
fi

say "Done. Power the TV off and on once to check that everything comes back by itself."
echo "    How to use it: docs/FEATURES.md    Undo: ./uninstall.sh"
