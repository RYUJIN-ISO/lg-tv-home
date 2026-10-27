#!/usr/bin/env bash
# Removes everything install.sh set up and restores LG's own behaviour.
#   ./uninstall.sh            (uses TV from setup.conf, or asks)
# Rooting / Homebrew Channel / SSH are left alone.
set -e
cd "$(dirname "$0")"
. lib/common.sh
[ -f setup.conf ] && . ./setup.conf
[ -n "$TV" ] || read -rp "SSH host of the TV: " TV
tv true || die "cannot SSH into '$TV'"

read -rp "Remove lg-tv-home from $TV and restore LG's home screen? [y/N] " a
case "$a" in [Yy]*) ;; *) exit 0 ;; esac

say "restoring LG's home screen"
tv "rm -f /var/webos-profile/override/atvhome_profile.json"
luna luna://com.webos.service.systemprofile/debug/rescan > /dev/null || true
cur=$(luna luna://com.webos.settingsservice/getSystemSettings '{"category":"general","keys":["defaultApps"]}' || echo '{}')
apps=$(echo "$cur" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('settings',{}).get('defaultApps') or {}
d.pop('home',None); print(json.dumps(d))")
luna luna://com.webos.settingsservice/setSystemSettings \
    "{\"category\":\"general\",\"settings\":{\"defaultApps\":$apps}}" > /dev/null || warn "could not reset defaultApps"

say "removing the remote button mapper"
tv "[ -f $WB/remote-mapper/remote-mapper.sh ] && sh $WB/remote-mapper/remote-mapper.sh remove; rm -f $WB/init.d/86-remote-mapper" || true

say "removing boot hooks and background scripts"
tv "[ -f /tmp/atvhome-saver.pid ] && kill \$(cat /tmp/atvhome-saver.pid); rm -f $WB/init.d/87-frame-saver" || true
tv "[ -f /tmp/app-trim.pid ] && kill \$(cat /tmp/app-trim.pid); rm -f $WB/init.d/80-debloat $WB/init.d/85-app-trim $WB/init.d/60-lg-ad-block
    [ -f $WB/debloat.sh ] && sh $WB/debloat.sh lift > /dev/null 2>&1
    [ -f $WB/store-mode.sh ] && sh $WB/store-mode.sh off > /dev/null 2>&1
    rm -f $WB/debloat.sh $WB/debloat.conf $WB/debloat-stub $WB/app-trim.sh $WB/lg-ad-block-hosts.txt $WB/store-mode.sh"

say "uninstalling apps"
for id in "$HOME_APP" "$LIGHT_APP" "$UPDATES_APP"; do
    luna luna://com.webos.appInstallService/dev/remove "{\"id\":\"$id\"}" > /dev/null 2>&1 && echo "    removed $id" || true
done

read -rp "Also delete the saved layout, wallpapers and Hue pairing on the TV? [y/N] " a
case "$a" in [Yy]*) tv "rm -rf $DATA $WB/hue-scene.conf $WB/hue-scene.mode $WB/remote-mapper" ;; esac
read -rp "Turn the passwordless telnet back on? (not recommended) [y/N] " a
case "$a" in [Yy]*) tv "rm -f /var/luna/preferences/webosbrew_telnet_disabled" ;; esac

say "Done. Reboot the TV (power off/on) to finish: the hosts block list and"
echo "    stopped services return to stock on the next boot."
