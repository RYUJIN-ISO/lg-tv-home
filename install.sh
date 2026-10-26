#!/usr/bin/env bash
# lg-tv-home installer. Run from a Linux/macOS computer that can SSH into a
# rooted LG webOS TV as root (Homebrew Channel + SSH key, see docs/PREREQUISITES.md).
#   ./install.sh                 ask the setup questions, then install
#   ./install.sh --yes           reuse the answers saved in setup.conf
# Re-running is safe: everything is (re)installed idempotently.
set -e
cd "$(dirname "$0")"
. lib/common.sh

CONF=setup.conf
REUSE=0
[ "$1" = "--yes" ] && REUSE=1

# ------------------------------------------------------------ questions

ask() { # ask VAR "question" default [y/n|text]
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
    read -rp "Found answers from last time in $CONF. Reuse them without asking? [Y/n] " a
    case "${a:-y}" in [Yy]*) REUSE=1 ;; esac
fi

cat <<'EOF'

  lg-tv-home setup
  ----------------
  Every answer has a default in [brackets]; Enter accepts it.
  Nothing on the TV changes until you confirm the summary at the end.

EOF
ask TV "SSH host of the TV (alias from ~/.ssh/config or root@<ip>):" "lgtv" text
say "checking the TV ..."
tv true || die "cannot SSH into '$TV' as root (see docs/PREREQUISITES.md)"
tv "test -d /media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service" ||
    die "Homebrew Channel not found on the TV - it must be rooted first"
MODEL=$(luna luna://com.webos.service.tv.systemproperty/getSystemInfo '{"keys":["modelName"]}' |
    python3 -c "import json,sys; print(json.load(sys.stdin).get('modelName','?'))" 2>/dev/null || echo "?")
WEBOS=$(tv "nyx-cmd OSInfo query webos_release" 2>/dev/null || echo "?")
say "TV: $MODEL, webOS $WEBOS (tested: LG OLED 2024 / webOS 25 = 10.3.x)"

echo
echo "1) Home screen"
ask LAUNCHER   "Install the TV Home launcher (Apple TV-style home screen)?" y yn
if [ "$LAUNCHER" = y ]; then
    ask SET_HOME "Make it THE home screen (Home button, after boot)? LG's stays installed." y yn
    ask LANGUAGE "Launcher language (en/de, changeable later in its Settings):" en text
    echo "   The launcher's top-left Light button can toggle a Philips Hue 'movie' scene:"
    echo "   1st press saves the current lights and recalls your movie scene, 2nd press restores them."
    ask LIGHT    "Set up light control with Philips Hue? (needs a Hue bridge on this network)" n yn
fi

echo
echo "2) Privacy"
ask ADBLOCK    "Block LG's ad / tracking / ACR domains on the TV (community hosts list)?" y yn
if [ "$ADBLOCK" = y ]; then
    echo "   With the block on, the LG Content Store can't update apps. The App-Updates app"
    echo "   lifts the block for 10 minutes on demand."
    ask APP_UPDATES "Install the App-Updates toggle app?" y yn
fi
ask DEBLOAT    "Stop LG's tracking/profiling background services (viewing data, usage logs, promos)?" y yn
if [ "$DEBLOAT" = y ]; then
    ask KEEP_VOICE     "Does anyone use voice search (mic button on the remote)? (y = keep it)" n yn
    ask KEEP_SMARTHOME "Use LG ThinQ app, Google Home or Alexa linking? (y = keep it)" n yn
fi

echo
echo "3) Speed"
ask APP_TRIM   "Keep only the current + previous app in RAM instead of LG preloading 5-6 apps?" y yn
ask TELNET_OFF "Turn off the passwordless root telnet that rooting leaves open (SSH keeps working)?" y yn

# Save answers (no secrets in here; the Hue key only lives on the TV).
cat > "$CONF" <<EOF
TV=$TV
LAUNCHER=$LAUNCHER
SET_HOME=${SET_HOME:-n}
LANGUAGE=${LANGUAGE:-en}
LIGHT=${LIGHT:-n}
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
    case "${a:-y}" in [Yy]*) ;; *) echo "Nothing changed. Answers saved in $CONF."; exit 0 ;; esac
fi

# ------------------------------------------------------------ install

tv "mkdir -p $WB/init.d $DATA/wallpapers $DATA/tiles"

if [ "$LAUNCHER" = y ]; then
    say "launcher"
    install_app apps/tv-home "$HOME_APP" "TV Home launcher"
    # First install: seed the config with the chosen language.
    tv "[ -f $DATA/config.json ] || echo '{\"language\":\"$LANGUAGE\"}' > $DATA/config.json"
    if [ "$SET_HOME" = y ]; then
        say "making TV Home the home screen"
        # 1) settings general/defaultApps.home (merge, keep other categories)
        cur=$(luna luna://com.webos.settingsservice/getSystemSettings '{"category":"general","keys":["defaultApps"]}')
        apps=$(echo "$cur" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('settings',{}).get('defaultApps') or {}
d['home']='$HOME_APP'; print(json.dumps(d))")
        luna luna://com.webos.settingsservice/setSystemSettings \
            "{\"category\":\"general\",\"settings\":{\"defaultApps\":$apps}}" > /dev/null
        # 2) profile override: idle app (after boot / closing the last app)
        tv "echo '{\"idleApp\":{\"support\":true,\"appId\":\"$HOME_APP\"},\"defaultApps\":{\"support\":true,\"categories\":{\"home\":\"$HOME_APP\",\"aod\":\"com.webos.app.lifeonscreen\"}}}' > /var/webos-profile/override/atvhome_profile.json"
        luna luna://com.webos.service.systemprofile/debug/rescan > /dev/null || warn "profile rescan failed (applies after reboot)"
    fi
fi

if [ "$LIGHT" = y ]; then
    say "light control"
    install_app apps/hue-light "$LIGHT_APP" "Hue movie scene toggle"
    if tv "test -f $WB/hue-scene.conf"; then
        say "Hue already configured on the TV (re-run tools/hue-setup.sh to change it)"
    else
        TV=$TV tools/hue-setup.sh || warn "Hue setup not finished - run: TV=$TV tools/hue-setup.sh"
    fi
fi

if [ "$ADBLOCK" = y ]; then
    say "ad / tracking block list"
    tmp=$(mktemp)
    # Base ("safe") list only; list-store breaks the Content Store entirely.
    curl -sfL https://raw.githubusercontent.com/hugobatista/lg-tv-ad-block/main/list |
        awk '/^#/||/^$/{print;next}{print "0.0.0.0 " $2; print ":: " $2}' > "$tmp"
    [ -s "$tmp" ] || die "could not download the block list"
    put "$tmp" "$WB/lg-ad-block-hosts.txt"
    rm -f "$tmp"
    put tv/init.d/60-lg-ad-block "$WB/init.d/60-lg-ad-block" 755
    # Apply now unless already in /etc/hosts (the hook appends on every boot).
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
    # systemctl is slow on these TVs: apply in the background (2-3 min).
    tv "setsid sh $WB/debloat.sh apply > /tmp/debloat.log 2>&1 < /dev/null &"
    say "stopping services in the background (takes 2-3 minutes)"
fi

if [ "$APP_TRIM" = y ]; then
    say "app trimming"
    put tv/app-trim.sh "$WB/app-trim.sh" 755
    put tv/init.d/85-app-trim "$WB/init.d/85-app-trim" 755
    tv "pgrep -f app-trim.sh > /dev/null || setsid sh $WB/app-trim.sh > /tmp/app-trim.log 2>&1 < /dev/null &"
fi

if [ "$TELNET_OFF" = y ]; then
    say "turning off telnet"
    tv "touch /var/luna/preferences/webosbrew_telnet_disabled; pkill -f 'bin/telnetd' || true"
fi

if [ "$LAUNCHER" = y ]; then
    luna luna://com.webos.applicationManager/launch "{\"id\":\"$HOME_APP\"}" > /dev/null || true
fi

say "Done. A reboot (power off/on) confirms everything comes back on its own."
echo "    Features and tips: docs/FEATURES.md   Undo: ./uninstall.sh"
