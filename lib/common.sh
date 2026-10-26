# Shared helpers for install.sh / uninstall.sh / tools. Source, don't run.
# Needs on the computer: ssh, scp, tar, ar (binutils), python3, curl.

HOME_APP=com.iso.atvhome
LIGHT_APP=com.iso.moviescene
UPDATES_APP=com.iso.appupdates
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

# install_app <app dir> <app id> <description>
install_app() {
    ipk=$(build_ipk "$1" "$2" "$3")
    scp -q -o BatchMode=yes "$ipk" "$TV:/tmp/$2.ipk" 2>/dev/null || die "copying $2 to the TV failed"
    res=$(tv "luna-send -w 120000 -i luna://com.webos.appInstallService/dev/install \
        '{\"id\":\"$2\",\"ipkUrl\":\"/tmp/$2.ipk\",\"subscribe\":true}' < /dev/null 2>&1 | \
        while read -r l; do echo \"\$l\"; case \"\$l\" in *installed*|*failed*|*errorText*) break;; esac; done; rm -f /tmp/$2.ipk")
    case "$res" in
        *'"state":"installed"'*) say "installed $2" ;;
        *) die "installing $2 failed: $(echo "$res" | tail -1)" ;;
    esac
    rm -rf "$(dirname "$ipk")"
}

# put <local file> <remote path> [mode]
put() {
    scp -q -o BatchMode=yes "$1" "$TV:$2" 2>/dev/null || die "copying $1 failed"
    [ -n "$3" ] && tv "chmod $3 '$2'"
}
