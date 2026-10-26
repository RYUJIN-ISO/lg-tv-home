# Philips Hue for TV Home (run as root via Homebrew Channel exec).
# Config: /var/lib/webosbrew/hue-scene.conf (KEY=VALUE lines, also read by
# older scene.sh versions):
#   BRIDGE, KEY      bridge address and API key
#   GROUP            room or zone the Light button works on
#   SCENE            cinema scene
#   RESTORE          snapshot scene that stores the lighting before cinema
#   BACK             "previous" (restore the snapshot) or "scene"
#   BACK_SCENE       scene to switch to when BACK=scene
#
#   python3 hue.py status                     everything the Hue menu shows (JSON)
#   python3 hue.py toggle                     Light button: prints movie / restored
#   python3 hue.py room <id> on|off|bri <%>   whole room or zone
#   python3 hue.py light <id> on|off|bri <%>  single light
#   python3 hue.py scene <room id> <scene id> recall a scene
#   python3 hue.py set group=<id> scene=<id> back=previous|<scene id>
#   python3 hue.py discover | pair <ip>       find a bridge, pair (press its button first)
import json, os, ssl, sys, urllib.request

CONF = "/var/lib/webosbrew/hue-scene.conf"
MODE = "/var/lib/webosbrew/hue-scene.mode"
SNAPSHOT_NAME = "TV Home before"
CTX = ssl._create_unverified_context()   # the bridge uses a self-signed certificate


def read_conf():
    c = {}
    try:
        for line in open(CONF):
            if "=" in line and not line.startswith("#"):
                k, v = line.strip().split("=", 1)
                c[k] = v
    except OSError:
        pass
    return c


def write_conf(c):
    tmp = CONF + ".tmp"
    with open(tmp, "w") as f:
        for k in ("BRIDGE", "KEY", "GROUP", "SCENE", "RESTORE", "BACK", "BACK_SCENE"):
            if c.get(k):
                f.write("%s=%s\n" % (k, c[k]))
    os.chmod(tmp, 0o600)
    os.replace(tmp, CONF)


def call(c, method, path, body=None, timeout=5):
    url = "https://%s/api" % c["BRIDGE"] + ("/" + c["KEY"] + path if c.get("KEY") else path)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    out = json.load(urllib.request.urlopen(req, context=CTX, timeout=timeout))
    if isinstance(out, list) and out and "error" in out[0]:
        raise RuntimeError(out[0]["error"].get("description", "bridge error"))
    return out


def pct(bri):
    return round((bri or 0) * 100 / 254)


def bri(p):
    return max(1, min(254, round(int(p) * 254 / 100)))


def status(c):
    if not c.get("BRIDGE") or not c.get("KEY"):
        return {"paired": False}
    groups, lights, scenes = call(c, "GET", "/groups"), call(c, "GET", "/lights"), call(c, "GET", "/scenes")
    rooms = []
    for gid, g in sorted(groups.items(), key=lambda kv: int(kv[0])):
        if g.get("type") not in ("Room", "Zone"):
            continue
        rooms.append({
            "id": gid, "name": g["name"], "type": g["type"],
            "on": g["state"]["any_on"], "bri": pct(g["action"].get("bri")),
            "lights": [{"id": l, "name": lights[l]["name"], "on": lights[l]["state"]["on"],
                        "bri": pct(lights[l]["state"].get("bri")),
                        "reachable": lights[l]["state"].get("reachable", True)}
                       for l in g["lights"] if l in lights],
            "scenes": sorted([{"id": s, "name": v["name"]} for s, v in scenes.items()
                              if v.get("group") == gid and s != c.get("RESTORE")
                              and v["name"] != SNAPSHOT_NAME], key=lambda x: x["name"].lower()),
        })
    mode = open(MODE).read().strip() if os.path.exists(MODE) else "normal"
    return {"paired": True, "bridge": c["BRIDGE"], "mode": mode, "rooms": rooms,
            "button": {"group": c.get("GROUP", ""), "scene": c.get("SCENE", ""),
                       "back": c.get("BACK", "previous"), "backScene": c.get("BACK_SCENE", "")}}


def ensure_snapshot(c):
    """The snapshot scene must belong to the button's room."""
    rid = c.get("RESTORE")
    if rid:
        try:
            if call(c, "GET", "/scenes/" + rid).get("group") == c["GROUP"]:
                return
        except Exception:
            pass
    out = call(c, "POST", "/scenes", {"name": SNAPSHOT_NAME, "type": "GroupScene",
                                      "group": c["GROUP"], "recycle": False})
    c["RESTORE"] = out[0]["success"]["id"]
    write_conf(c)


def toggle(c):
    if not c.get("GROUP") or not c.get("SCENE"):
        raise RuntimeError("Light button not set up")
    action = "/groups/%s/action" % c["GROUP"]
    cinema = open(MODE).read().strip() == "movie" if os.path.exists(MODE) else False
    if cinema:
        back = c.get("BACK_SCENE") if c.get("BACK") == "scene" and c.get("BACK_SCENE") else c.get("RESTORE")
        call(c, "PUT", action, {"scene": back})
        open(MODE, "w").write("normal")
        return "restored"
    if c.get("BACK", "previous") != "scene":
        ensure_snapshot(c)
        call(c, "PUT", "/scenes/" + c["RESTORE"], {"storelightstate": True})
    call(c, "PUT", action, {"scene": c["SCENE"]})
    open(MODE, "w").write("movie")
    return "movie"


def onoff(c, path, args):
    if args[0] in ("on", "off"):
        call(c, "PUT", path, {"on": args[0] == "on"})
    elif args[0] == "bri":
        call(c, "PUT", path, {"on": True, "bri": bri(args[1])})


def main(argv):
    c = read_conf()
    cmd = argv[0] if argv else "status"
    if cmd == "status":
        print(json.dumps(status(c)))
    elif cmd == "toggle":
        print(toggle(c))
    elif cmd == "room":
        onoff(c, "/groups/%s/action" % argv[1], argv[2:]); print("ok")
    elif cmd == "light":
        onoff(c, "/lights/%s/state" % argv[1], argv[2:]); print("ok")
    elif cmd == "scene":
        call(c, "PUT", "/groups/%s/action" % argv[1], {"scene": argv[2]})
        if os.path.exists(MODE):
            os.remove(MODE)            # a manual scene ends cinema mode
        print("ok")
    elif cmd == "set":
        for kv in argv[1:]:
            k, v = kv.split("=", 1)
            if k == "group" and v != c.get("GROUP"):
                c["GROUP"], c["SCENE"], c["BACK_SCENE"] = v, "", ""
                if os.path.exists(MODE):
                    os.remove(MODE)
            elif k == "scene":
                c["SCENE"] = v
            elif k == "back":
                c["BACK"], c["BACK_SCENE"] = ("previous", "") if v == "previous" else ("scene", v)
        write_conf(c)
        if c.get("GROUP"):
            ensure_snapshot(c)
        print("ok")
    elif cmd == "discover":
        try:
            found = json.load(urllib.request.urlopen("https://discovery.meethue.com", timeout=8))
        except Exception:
            found = []
        print(json.dumps([{"ip": b["internalipaddress"]} for b in found if b.get("internalipaddress")]))
    elif cmd == "pair":
        try:
            out = call({"BRIDGE": argv[1], "KEY": ""}, "POST", "", {"devicetype": "lg-tv-home#tv"})
            c.update({"BRIDGE": argv[1], "KEY": out[0]["success"]["username"]})
            write_conf(c)
            print("ok")
        except RuntimeError:
            print("press")             # link button not pressed yet
    else:
        sys.exit("unknown command")


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception as e:
        sys.stderr.write(str(e) + "\n")
        sys.exit(1)
