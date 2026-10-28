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

# Every module, whether it is on the TV or not (each step skips what is missing).
say "removing the remote button mapper"
remove_remote
say "removing the privacy lock, background service block and app trimming"
remove_adblock
remove_debloat
remove_app_trim
say "removing Plex and Hue helpers"
remove_plex
remove_light
say "restoring LG's home screen and removing TV Home"
remove_launcher

read -rp "Also delete the saved layout, wallpapers, Hue pairing and Plex sign-in on the TV? [y/N] " a
case "$a" in [Yy]*) tv "rm -rf $DATA $WB/hue-scene.conf $WB/hue-scene.mode $WB/remote-mapper" ;; esac
read -rp "Turn the passwordless telnet back on? (not recommended) [y/N] " a
case "$a" in [Yy]*) tv "rm -f /var/luna/preferences/webosbrew_telnet_disabled" ;; esac

say "Done. Reboot the TV (power off/on) to finish: the stopped services"
echo "    return to stock on the next boot."
