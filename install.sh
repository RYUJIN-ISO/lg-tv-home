#!/usr/bin/env bash
# lg-tv-home installer. Run it on a Linux or macOS computer that can SSH into
# a rooted LG webOS TV as root (Homebrew Channel plus an SSH key, see
# docs/PREREQUISITES.md).
#   ./install.sh          choose the modules, answer a few questions, see a
#                         summary, then install
#   ./install.sh --yes    reuse the choices saved in setup.conf
# Running it again is safe: every step installs or updates in place, and a
# module that is no longer chosen is taken off the TV (its settings stay).
set -e
cd "$(dirname "$0")"
. lib/common.sh

CONF=setup.conf
REUSE=0
[ "$1" = "--yes" ] && REUSE=1

# ------------------------------------------------------------ modules

# Everything that can be chosen, in the order of the checklist. The ones
# after LAUNCHER up to PRINTS are parts of TV Home and need it.
MODULES="LAUNCHER FRAME PLEX LIGHT AVR REMOTE PRINTS ADBLOCK DEBLOAT APP_TRIM TELNET_OFF"
PART_OF_HOME="FRAME PLEX LIGHT AVR REMOTE PRINTS"

label() {
    case $1 in
        LAUNCHER)   echo "TV Home: the Apple TV style home screen (wallpapers, folders, organize apps)" ;;
        FRAME)      echo "  Picture Frame: wallpapers full screen, optionally instead of LG's screensaver" ;;
        PLEX)       echo "  Plex: Continue Watching above the apps (each person signs in on the TV)" ;;
        LIGHT)      echo "  Philips Hue: Light button (cinema scene) and rooms in Settings (needs a Hue bridge)" ;;
        AVR)        echo "  AV receiver button: sound to the receiver on HDMI eARC with one press" ;;
        REMOTE)     echo "  Remote buttons: give Netflix, Prime, Mic, colour keys ... any app or action" ;;
        PRINTS)     echo "  Museum prints: 16 public-domain paintings as wallpapers (about 49 MB)" ;;
        ADBLOCK)    echo "Privacy lock: block LG's ad, tracking and ACR servers on the TV (locks the LG Store;" ;;
        DEBLOAT)    echo "Stop LG's tracking and profiling background services" ;;
        APP_TRIM)   echo "Keep only the current and previous app in memory (faster)" ;;
        TELNET_OFF) echo "Turn off the passwordless root telnet that rooting leaves open" ;;
    esac
}
# Second lines for the checklist (where one line isn't enough).
label2() {
    case $1 in
        ADBLOCK) echo "an App Store switch opens it until you leave it). Skip it with a Pi-hole or similar." ;;
    esac
}

preset() {
    local on=$1 m
    for m in $MODULES; do printf -v "$m" n; done
    for m in $on; do printf -v "$m" y; done
}
PRESET_RECOMMENDED="LAUNCHER FRAME PLEX REMOTE PRINTS ADBLOCK DEBLOAT APP_TRIM TELNET_OFF"
PRESET_EVERYTHING=$MODULES
PRESET_PIHOLE="LAUNCHER FRAME PLEX REMOTE PRINTS DEBLOAT APP_TRIM TELNET_OFF"
PRESET_MINIMAL="LAUNCHER TELNET_OFF"

part_of_home() { case " $PART_OF_HOME " in *" $1 "*) return 0 ;; esac; return 1; }

# The checklist: numbers switch items, letters pick a preset, Enter is done.
checklist() {
    local i m a mark
    while :; do
        echo
        i=0
        for m in $MODULES; do
            i=$((i + 1))
            mark="[ ]"
            [ "${!m}" = y ] && mark="[x]"
            part_of_home "$m" && [ "$LAUNCHER" != y ] && mark="[-]"
            printf '  %2d %s %s\n' "$i" "$mark" "$(label "$m")"
            [ -n "$(label2 "$m")" ] && printf '         %s\n' "$(label2 "$m")"
        done
        echo
        echo "  Presets: r) recommended   e) everything   p) Pi-hole user (all but the privacy lock)"
        echo "           m) minimal (TV Home only)"
        read -rp "  Numbers to switch (e.g. 4 5), a preset letter, or Enter when done: " a
        [ -z "$a" ] && return
        case "$a" in
            r) preset "$PRESET_RECOMMENDED"; continue ;;
            e) preset "$PRESET_EVERYTHING"; continue ;;
            p) preset "$PRESET_PIHOLE"; continue ;;
            m) preset "$PRESET_MINIMAL"; continue ;;
        esac
        for i in $a; do
            m=$(echo $MODULES | cut -d' ' -f"$i" 2>/dev/null) || m=""
            case "$i" in *[!0-9]*) m="" ;; esac
            if [ -z "$m" ]; then echo "  ($i is not on the list)"; continue; fi
            if [ "${!m}" = y ]; then printf -v "$m" n; else printf -v "$m" y; fi
        done
    done
}

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
    read -rp "Found your choices from last time in $CONF. Use them without asking again? [Y/n] " a
    case "${a:-y}" in [Yy]*) REUSE=1 ;; esac
fi

cat <<'EOF'

  lg-tv-home setup
  ----------------
  Choose the modules, answer a few questions (Enter takes the default in
  [brackets]). Nothing on the TV changes until you confirm the summary.
EOF
echo
ask TV "SSH host of the TV (an alias from ~/.ssh/config, or root@<ip>):" "lgtv" text
say "checking the TV"
tv true || die "cannot SSH into '$TV' as root (see docs/PREREQUISITES.md)"
tv "test -d /media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service" ||
    die "Homebrew Channel is not installed on the TV. Root it first (docs/PREREQUISITES.md)."
MODEL=$(luna luna://com.webos.service.tv.systemproperty/getSystemInfo '{"keys":["modelName"]}' |
    python3 -c "import json,sys; print(json.load(sys.stdin).get('modelName','?'))" 2>/dev/null || echo "?")
WEBOS=$(tv "nyx-cmd OSInfo query webos_release" 2>/dev/null || echo "?")
say "TV: $MODEL, webOS $WEBOS (tested on an LG OLED 2024 with webOS 10.3)"
ON_TV=$(installed_modules)

# Choices saved before modules existed: Picture Frame and Plex were always
# part of TV Home, the AV receiver button was a setting (keep it where it is on).
if [ -f "$CONF" ]; then
    : "${FRAME:=$LAUNCHER}" "${PLEX:=$LAUNCHER}"
    if [ -z "$AVR" ]; then
        AVR=n
        tv "grep -q '\"avrButton\": *true' $DATA/config.json" 2>/dev/null && AVR=y
    fi
else
    preset "$PRESET_RECOMMENDED"
fi

if [ "$REUSE" = 0 ]; then
    echo
    echo "1) Modules"
    checklist
fi
if [ "$LAUNCHER" != y ]; then for m in $PART_OF_HOME; do printf -v "$m" n; done; fi

echo
echo "2) Details"
if [ "$LAUNCHER" = y ]; then
    ask SET_HOME "Make TV Home the TV's home screen (Home button, after power on)? LG's stays installed." y yn
    ask LANGUAGE "Language, en or de (can be changed later in its Settings):" en text
fi
if [ "$DEBLOAT" = y ]; then
    ask KEEP_VOICE "Does anyone use voice search with the mic button? (y keeps it)" n yn
    ask KEEP_SMARTHOME "Do you use the LG ThinQ app, Google Home or Alexa with the TV? (y keeps it)" n yn
fi
# Without TV Home, the small App-Updates app is the way to open the locked store.
APP_UPDATES=n
[ "$ADBLOCK" = y ] && [ "$LAUNCHER" != y ] && APP_UPDATES=y

# Save the choices. No secrets in here; the Hue key only lives on the TV.
cat > "$CONF" <<EOF
TV=$TV
LAUNCHER=$LAUNCHER
FRAME=$FRAME
PLEX=$PLEX
LIGHT=$LIGHT
AVR=$AVR
REMOTE=$REMOTE
PRINTS=$PRINTS
ADBLOCK=$ADBLOCK
DEBLOAT=$DEBLOAT
APP_TRIM=$APP_TRIM
TELNET_OFF=$TELNET_OFF
SET_HOME=${SET_HOME:-n}
LANGUAGE=${LANGUAGE:-en}
KEEP_VOICE=${KEEP_VOICE:-y}
KEEP_SMARTHOME=${KEEP_SMARTHOME:-y}
EOF

# What comes off the TV: on it now, not chosen any more.
REMOVE=""
for m in $ON_TV; do [ "${!m}" = y ] || REMOVE="$REMOVE $m"; done
# TV Home leaving takes the frame guard with it (remove_launcher).
case " $REMOVE " in *" LAUNCHER "*) REMOVE=$(echo "$REMOVE" | sed 's/ FRAME//') ;; esac

echo
say "Summary"
for m in $MODULES; do
    [ "${!m}" = y ] && printf '    install  %s\n' "$(label "$m" | sed 's/^ *//; s/:.*//')"
done
for m in $REMOVE; do printf '    REMOVE   %s\n' "$(label "$m" | sed 's/^ *//; s/:.*//')"; done
[ -n "$REMOVE" ] && echo "    (Settings, sign-ins and pairings stay on the TV; choosing a module again brings them back.)"
[ "$TELNET_OFF" = y ] || echo "    telnet: left as it is"
if [ "$REUSE" = 0 ]; then
    read -rp "Go ahead? [Y/n] " a
    case "${a:-y}" in [Yy]*) ;; *) echo "Nothing changed. Your choices are saved in $CONF."; exit 0 ;; esac
fi

# ------------------------------------------------------------ remove

for m in $REMOVE; do
    say "removing $(label "$m" | sed 's/^ *//; s/:.*//')"
    case $m in
        LAUNCHER) remove_launcher ;;
        FRAME)    remove_frame ;;
        PLEX)     remove_plex ;;
        LIGHT)    remove_light ;;
        REMOTE)   remove_remote ;;
        ADBLOCK)  remove_adblock ;;
        DEBLOAT)  remove_debloat ;;
        APP_TRIM) remove_app_trim ;;
    esac
done
# The App-Updates app is only for a privacy lock without TV Home.
if [ "$APP_UPDATES" != y ] && tv "test -d $APPS_DIR/$UPDATES_APP"; then remove_app "$UPDATES_APP"; fi

# ------------------------------------------------------------ install

tv "mkdir -p $WB/init.d $DATA/wallpapers $DATA/tiles"

if [ "$LAUNCHER" = y ]; then
    say "TV Home"
    mods=""
    [ "$REMOTE" = y ] && mods="$mods remote"
    [ "$PLEX" = y ]   && mods="$mods plex"
    [ "$LIGHT" = y ]  && mods="$mods hue"
    [ "$ADBLOCK" = y ] && mods="$mods store"
    [ "$FRAME" = y ]  && mods="$mods frame"
    [ "$AVR" = y ]    && mods="$mods avr"
    stage=$(mktemp -d)
    stage_home "$stage/tv-home" $mods
    install_app "$stage/tv-home" "$HOME_APP" "TV Home launcher"
    rm -rf "$stage"
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

if [ "$FRAME" = y ]; then
    say "Picture Frame"
    put tv/init.d/87-frame-saver "$WB/init.d/87-frame-saver" 755
    tv "setsid python3 $APPS_DIR/$HOME_APP/framesaver.py > /dev/null 2>&1 < /dev/null &"
fi

if [ "$PLEX" = y ]; then
    say "Plex"
    install_app apps/plex-link "$PLEX_LINK_APP" "Opens Plex at a title for TV Home"
fi

if [ "$AVR" = y ]; then
    # Chosen here, so the button shows (unless it was switched off on the TV before).
    tv "python3 -c \"
import json
p = '$DATA/config.json'
try: c = json.load(open(p))
except Exception: c = {}
if 'avrButton' not in c:
    c['avrButton'] = True
    json.dump(c, open(p, 'w'))
\""
fi

if [ "$PRINTS" = y ]; then
    say "museum prints"
    tv "mkdir -p $DATA/wallpapers/thumbs"
    scp -q -o BatchMode=yes prints/*.jpg "$TV:$DATA/wallpapers/" || warn "copying the prints failed"
    scp -q -o BatchMode=yes prints/thumbs/*.jpg "$TV:$DATA/wallpapers/thumbs/" || warn "copying the print previews failed"
fi

if [ "$LIGHT" = y ]; then
    say "Philips Hue"
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
    say "privacy lock (ad and tracking block list)"
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
    # The groups asked about follow the answers; everything else in an
    # existing debloat.conf (BLOCK_TRACKING, BLOCK_MISC, lines added by hand)
    # stays as it is. A new one blocks tracking and misc as well.
    conf=$(mktemp)
    tv "cat $WB/debloat.conf 2>/dev/null" | python3 -c "
import sys
asked = {'BLOCK_PRELOAD': sys.argv[1], 'BLOCK_VOICE': sys.argv[2], 'BLOCK_SMARTHOME': sys.argv[3]}
lines = sys.stdin.read().splitlines() or ['BLOCK_TRACKING=1', 'BLOCK_PRELOAD=0', 'BLOCK_VOICE=0', 'BLOCK_SMARTHOME=0', 'BLOCK_MISC=1']
out = []
for l in lines:
    k = l.split('=', 1)[0].strip()
    if k in asked: l = k + '=' + asked.pop(k)
    out.append(l)
out += [k + '=' + v for k, v in asked.items()]
print('\\n'.join(out))" "$( [ "$APP_TRIM" = y ] && echo 1 || echo 0 )" "$(b "$KEEP_VOICE")" "$(b "$KEEP_SMARTHOME")" > "$conf"
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
