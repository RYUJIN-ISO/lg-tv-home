# Shared helpers for install.sh / uninstall.sh / tools. Source, don't run.
# Needs on the computer: ssh, scp, tar, ar (binutils), python3, curl.

HOME_APP=com.iso.atvhome
LIGHT_APP=com.iso.moviescene
UPDATES_APP=com.iso.appupdates
PLEX_LINK_APP=com.iso.plexlink    # apps/plex-link: opens Plex at a title for TV Home's Plex rows
WB=/var/lib/webosbrew
DATA=$WB/atvhome

say()  { printf '\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33m!!  %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31mxx  %s\033[0m\n' "$*" >&2; exit 1; }

# tv <command>: run a shell command on the TV as root. stdin is /dev/null on
# purpose: luna-send silently prints nothing when its stdin is the SSH pipe.
tv() {
    # (the redirect must happen on the TV side: ssh's remote stdin is the channel)
    ssh -o BatchMode=yes -o ConnectTimeout=10 "$TV" "exec < /dev/null; $*" < /dev/null \
        2> >(grep -v -E 'post-quantum|store now|pq.html|upgraded' >&2)
}

# luna <uri> [json]: luna-send on the TV, retried (first calls after idle
# sometimes get no reply).
luna() {
    local params=$2
    [ -n "$params" ] || params='{}'
    tv "for i in 1 2 3; do o=\$(luna-send -n 1 -w 10000 '$1' '$params' < /dev/null 2>/dev/null); [ -n \"\$o\" ] && { echo \"\$o\"; exit 0; }; done; exit 1"
}

# build_ipk <app dir> <app id> <description>: prints the .ipk path.
build_ipk() {
    dir=$1 id=$2 desc=$3
    ver=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['version'])" "$dir/appinfo.json")
    out=$(mktemp -d)
    b=$(mktemp -d)
    mkdir -p "$b/data/usr/palm/applications/$id" "$b/control"
    cp -r "$dir"/. "$b/data/usr/palm/applications/$id/"
    rm -rf "$b/data/usr/palm/applications/$id/cache"
    chmod 755 "$b"/data/usr/palm/applications/"$id"/*.sh 2>/dev/null
    cat > "$b/control/control" <<EOF
Package: $id
Version: $ver
Section: misc
Priority: optional
Architecture: all
Installed-Size: $(du -sk "$b/data" | cut -f1)
Maintainer: lg-tv-home
Description: $desc
webOS-Package-Format-Version: 2
webOS-Packager-Version: x.y.x
EOF
    echo "2.0" > "$b/debian-binary"
    (cd "$b/control" && tar --owner=0 --group=0 -czf ../control.tar.gz .)
    (cd "$b/data" && tar --owner=0 --group=0 -czf ../data.tar.gz .)
    (cd "$b" && ar rc "$out/${id}_${ver}_all.ipk" debian-binary control.tar.gz data.tar.gz)
    rm -rf "$b"
    echo "$out/${id}_${ver}_all.ipk"
}

# TV Home's modules in the order they appear (Settings rows, top buttons).
HOME_MODULES="remote plex hue store frame avr"

# stage_home <out dir> <module...>: TV Home with only these modules, ready
# for install_app. modules/<m>/<m>.js and <m>.css are joined into modules.js
# and modules.css (always written, empty without modules); a module's other
# files (Python helpers, the frame's worker) go next to app.js.
stage_home() {
    local out=$1 m f
    shift
    mkdir -p "$out"
    (cd apps/tv-home && tar --exclude=./modules --exclude=./cache -cf - .) | (cd "$out" && tar -xf -)
    : > "$out/modules.js"
    : > "$out/modules.css"
    for m in $HOME_MODULES; do
        case " $* " in *" $m "*) ;; *) continue ;; esac
        for f in apps/tv-home/modules/"$m"/*; do
            case "$(basename "$f")" in
                "$m.js")  { cat "$f"; echo; } >> "$out/modules.js" ;;
                "$m.css") { cat "$f"; echo; } >> "$out/modules.css" ;;
                *)        cp "$f" "$out/" ;;
            esac
        done
    done
}

# install_app <app dir> <app id> <description>
install_app() {
    ipk=$(build_ipk "$1" "$2" "$3")
    scp -q -o BatchMode=yes "$ipk" "$TV:/tmp/$2.ipk" 2>/dev/null || die "copying $2 to the TV failed"
    # The install subscription keeps running after the final status, so watch
    # its log and stop it as soon as the result is in.
    res=$(tv "L=/tmp/install-$2.log
        luna-send -w 120000 -i luna://com.webos.appInstallService/dev/install \
            '{\"id\":\"$2\",\"ipkUrl\":\"/tmp/$2.ipk\",\"subscribe\":true}' > \$L 2>&1 &
        P=\$!
        for i in \$(seq 1 120); do grep -qE 'installed|failed|errorText' \$L && break; sleep 1; done
        kill \$P 2>/dev/null; tail -n 1 \$L; rm -f \$L /tmp/$2.ipk")
    case "$res" in
        *'"state":"installed"'*) say "installed $2" ;;
        *) die "installing $2 failed: $res" ;;
    esac
    rm -rf "$(dirname "$ipk")"
}

# ------------------------------------------------------------ modules on the TV

APPS_DIR=/media/developer/apps/usr/palm/applications

# What is on the TV now: prints the setup.conf keys of the modules found.
# (AVR lives inside TV Home and the prints are just pictures: not probed.)
installed_modules() {
    tv "t() { [ -e \"\$2\" ] && printf '%s ' \"\$1\"; }
        t LAUNCHER $APPS_DIR/$HOME_APP; t FRAME $WB/init.d/87-frame-saver
        t PLEX $APPS_DIR/$PLEX_LINK_APP; t LIGHT $APPS_DIR/$LIGHT_APP
        t REMOTE $WB/init.d/86-remote-mapper; t ADBLOCK $WB/init.d/60-lg-ad-block
        t DEBLOAT $WB/init.d/80-debloat; t APP_TRIM $WB/init.d/85-app-trim; true"
}

remove_app() {
    case "$(luna luna://com.webos.appInstallService/dev/remove "{\"id\":\"$1\"}" 2>/dev/null)" in
        *'"returnValue":true'*) echo "    removed $1" ;;
    esac
}

# remove_<module>: takes one module off the TV. Settings and sign-ins stay
# (config.json, Hue pairing, Plex sign-in, button map), so installing the
# module again brings them back.
remove_frame() {
    tv "[ -f /tmp/atvhome-saver.pid ] && kill \$(cat /tmp/atvhome-saver.pid); rm -f $WB/init.d/87-frame-saver
        # The frame's guard may have switched LG's screensaver off: switch it back on.
        [ -f $DATA/screensaver-off-by-frame ] && luna-send -n 1 luna://com.webos.settingsservice/setSystemSettings '{\"category\":\"general\",\"settings\":{\"screenSaverEnabled\":\"on\"}}' > /dev/null
        rm -f $DATA/screensaver-off-by-frame; true"
}
remove_plex()  { remove_app "$PLEX_LINK_APP"; }
remove_light() { remove_app "$LIGHT_APP"; }
remove_remote() {
    tv "[ -f $WB/remote-mapper/remote-mapper.sh ] && sh $WB/remote-mapper/remote-mapper.sh remove
        rm -f $WB/init.d/86-remote-mapper $WB/remote-mapper/remap.js $WB/remote-mapper/remote-mapper.sh; true"
}
# The block list's lines leave /etc/hosts right away (store-mode off first, in
# case the store is open and hosts is the stripped copy).
remove_adblock() {
    tv "[ -f $WB/store-mode.sh ] && sh $WB/store-mode.sh off > /dev/null 2>&1
        L=$WB/lg-ad-block-hosts.txt
        if [ -s \$L ]; then grep -v '^#' \$L | grep -v '^\$' > /tmp/adblock.lines
            grep -vxFf /tmp/adblock.lines /etc/hosts > /tmp/hosts.new && cat /tmp/hosts.new > /etc/hosts
            rm -f /tmp/adblock.lines /tmp/hosts.new; fi
        rm -f $WB/init.d/60-lg-ad-block \$L $WB/store-mode.sh; true"
    remove_app "$UPDATES_APP"
}
remove_debloat() {
    tv "[ -f $WB/debloat.sh ] && sh $WB/debloat.sh lift > /dev/null 2>&1
        rm -f $WB/init.d/80-debloat $WB/debloat.sh $WB/debloat.conf $WB/debloat-stub; true"
}
remove_app_trim() {
    tv "[ -f /tmp/app-trim.pid ] && kill \$(cat /tmp/app-trim.pid); rm -f $WB/init.d/85-app-trim $WB/app-trim.sh; true"
}
# LG's home screen back (Home button, after power on), then TV Home goes.
remove_launcher() {
    tv "rm -f /var/webos-profile/override/atvhome_profile.json"
    luna luna://com.webos.service.systemprofile/debug/rescan > /dev/null || true
    local cur apps
    cur=$(luna luna://com.webos.settingsservice/getSystemSettings '{"category":"general","keys":["defaultApps"]}' || echo '{}')
    apps=$(echo "$cur" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('settings',{}).get('defaultApps') or {}
d.pop('home',None); print(json.dumps(d))")
    luna luna://com.webos.settingsservice/setSystemSettings \
        "{\"category\":\"general\",\"settings\":{\"defaultApps\":$apps}}" > /dev/null || warn "could not reset defaultApps"
    remove_frame
    remove_app "$HOME_APP"
}

# put <local file> <remote path> [mode]
put() {
    scp -q -o BatchMode=yes "$1" "$TV:$2" 2>/dev/null || die "copying $1 failed"
    if [ -n "$3" ]; then tv "chmod $3 '$2'"; fi   # (an && here would end set -e scripts without a mode)
}
