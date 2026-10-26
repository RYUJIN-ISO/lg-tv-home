#!/usr/bin/env bash
# Guided Philips Hue setup for the TV Home "Light" button.
# Run from a computer on the same network as the Hue bridge and the TV:
#   TV=<ssh host> tools/hue-setup.sh
# Steps: find the bridge -> press its link button -> pick the room/zone ->
# pick the "movie" scene -> a "TV Home before" snapshot scene is created ->
# config is written to the TV (/var/lib/webosbrew/hue-scene.conf, mode 600).
set -e
cd "$(dirname "$0")/.."
. lib/common.sh
[ -n "$TV" ] || die "set TV=<ssh host of the TV>"

json() { python3 -c "import json,sys; d=json.load(sys.stdin); $1"; }

say "Philips Hue setup"
read -rp "Hue bridge IP (empty = look it up via discovery.meethue.com): " BRIDGE
if [ -z "$BRIDGE" ]; then
    BRIDGE=$(curl -s -m 10 https://discovery.meethue.com | json "print(d[0]['internalipaddress'] if d else '')" 2>/dev/null)
    [ -n "$BRIDGE" ] || die "no bridge found; enter its IP (Hue app -> Settings -> My Hue system)"
    say "found bridge at $BRIDGE"
fi
curl -sk -m 5 "https://$BRIDGE/api/config" > /dev/null || die "bridge $BRIDGE not reachable"

say "Press the round link button on the Hue bridge now (60 s) ..."
KEY=""
for i in $(seq 1 30); do
    r=$(curl -sk -m 5 -X POST "https://$BRIDGE/api" -d '{"devicetype":"lg-tv-home#tv"}')
    KEY=$(echo "$r" | json "print(d[0].get('success',{}).get('username',''))" 2>/dev/null || true)
    [ -n "$KEY" ] && break
    sleep 2
done
[ -n "$KEY" ] || die "link button not pressed in time"
API="https://$BRIDGE/api/$KEY"
say "paired"

echo "Rooms and zones:"
curl -sk "$API/groups" | json "
for k, g in sorted(d.items(), key=lambda x: int(x[0])):
    if g.get('type') in ('Room', 'Zone', 'Entertainment'):
        print('  %4s  %-28s %s' % (k, g['name'], g['type']))"
read -rp "Number of the room/zone the TV lights are in: " GROUP
[ -n "$GROUP" ] || die "no room chosen"

echo "Scenes for that room:"
curl -sk "$API/scenes" | json "
for k, s in sorted(d.items(), key=lambda x: x[1]['name']):
    if s.get('group') == '$GROUP' and not s['name'].startswith('TV Home'):
        print('  %-18s %s' % (k, s['name']))"
echo "(Create a scene in the Hue app first if none fits, then re-run.)"
read -rp "ID of the scene for watching (first column): " SCENE
[ -n "$SCENE" ] || die "no scene chosen"

# Snapshot scene the "before" lighting is saved into on each press.
RESTORE=$(curl -sk -X POST "$API/scenes" \
    -d "{\"name\":\"TV Home before\",\"type\":\"GroupScene\",\"group\":\"$GROUP\",\"recycle\":false}" |
    json "print(d[0]['success']['id'])") || die "could not create the snapshot scene"

conf=$(mktemp)
printf 'BRIDGE=%s\nKEY=%s\nGROUP=%s\nSCENE=%s\nRESTORE=%s\n' "$BRIDGE" "$KEY" "$GROUP" "$SCENE" "$RESTORE" > "$conf"
put "$conf" "$WB/hue-scene.conf" 600
rm -f "$conf"
tv "rm -f $WB/hue-scene.mode"
say "Hue configured. The Light button (top left on the home screen) now toggles the scene."
