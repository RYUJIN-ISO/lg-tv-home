#!/bin/sh
# Remote mapper control: puts remap.js into surface-manager's key filter chain
# (configd "com.webos.surfacemanager.keyFilters", live-subscribed by
# surface-manager) or takes it out again. Runtime only: configd values set
# with setConfigs are not written to /etc, a reboot restores LG's chain until
# init.d/86-remote-mapper runs `apply` again.
#   apply    insert the filter after handleScreenSaver (idempotent)
#   reload   re-read map.json (re-inserts the filter -> surface-manager reloads)
#   remove   restore LG's original chain
#   status   "active" / "inactive"
#   learned  print the last presses seen in learn mode (JSON)
#   getmap   print map.json          setmap <base64 JSON>  write map.json + reload
#   learn on|off  toggle learn mode (+ reload)
#   enable / disable   switch the mapper on/off (disable survives reboots)
#   apps     visible installed apps as JSON [{id,title}] (for the Remote app)
# Failsafe: touch /var/lib/webosbrew/remote-mapper/disabled to keep it off.
D=/var/lib/webosbrew/remote-mapper
exec python3 - "$@" <<'EOF'
import base64, json, os, subprocess, sys, time
D = "/var/lib/webosbrew/remote-mapper"
KEY = "com.webos.surfacemanager.keyFilters"
ENTRY = {"handler": "remapKeys", "file": D + "/remap.js"}

def luna(method, params):
    r = subprocess.run(["luna-send", "-n", "1", "-w", "8000", "luna://com.webos.service.config/" + method,
                        json.dumps(params)], capture_output=True, text=True, stdin=subprocess.DEVNULL)
    return json.loads(r.stdout or "{}")

def current():
    for _ in range(3):
        c = luna("getConfigs", {"configNames": [KEY]}).get("configs", {}).get(KEY)
        if c: return c
        time.sleep(1)
    sys.exit("could not read " + KEY)

def put(chain):
    if not luna("setConfigs", {"configs": {KEY: chain}}).get("returnValue"):
        sys.exit("setConfigs failed")

def stock(chain):
    return [e for e in chain if "remote-mapper" not in e.get("file", "")]

def with_filter(chain):
    s = stock(chain)
    i = next((n + 1 for n, e in enumerate(s) if e.get("handler") == "handleScreenSaver"), 0)
    return s[:i] + [ENTRY] + s[i:]

cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
MAP = D + "/map.json"

def read_map():
    try: return json.load(open(MAP))
    except Exception: return {"buttons": {}}

def write_map(m):
    tmp = MAP + ".tmp"
    with open(tmp, "w") as f: json.dump(m, f)
    os.replace(tmp, MAP)

if cmd == "getmap":
    print(json.dumps(read_map())); sys.exit()
if cmd == "apps":
    r = subprocess.run(["luna-send", "-n", "1", "-w", "15000", "luna://com.webos.applicationManager/listApps", "{}"],
                       capture_output=True, text=True, stdin=subprocess.DEVNULL)
    apps = [{"id": a["id"], "title": a.get("title", a["id"])} for a in json.loads(r.stdout or "{}").get("apps", [])
            if a.get("visible")]
    print(json.dumps(sorted(apps, key=lambda a: a["title"].lower()))); sys.exit()
if cmd == "setmap":
    m = json.loads(base64.b64decode(sys.argv[2]).decode("utf-8"))
    m["learn"] = read_map().get("learn", False)
    write_map(m); cmd = "reload"
if cmd == "learn":
    m = read_map(); m["learn"] = (sys.argv[2] == "on") if len(sys.argv) > 2 else True
    write_map(m)
    if m["learn"]: luna("setConfigs", {"configs": {"com.iso.remotemapper.learned": []}})
    cmd = "reload"

if cmd == "disable":
    open(D + "/disabled", "w").close(); cmd = "remove"
if cmd == "enable":
    if os.path.exists(D + "/disabled"): os.remove(D + "/disabled")
    cmd = "apply"

chain = current()
active = any("remote-mapper" in e.get("file", "") for e in chain)
if cmd == "apply" or cmd == "reload":
    if os.path.exists(D + "/disabled"):
        sys.exit("disabled (remove %s/disabled to enable)" % D)
    if not os.path.exists(D + "/remap.js"):
        sys.exit("remap.js missing")
    # Learn mode never outlives a reboot or a fresh apply (it is left on when
    # TV Home closes while learning).
    if cmd == "apply" and read_map().get("learn"):
        m = read_map(); m["learn"] = False; write_map(m)
    if active:          # change the value twice so surface-manager reloads the filters
        put(stock(chain)); time.sleep(1)
    put(with_filter(chain))
    print("active")
elif cmd == "remove":
    if active: put(stock(chain))
    print("inactive")
elif cmd == "learned":
    v = luna("getConfigs", {"configNames": ["com.iso.remotemapper.learned"]}).get("configs", {})
    print(json.dumps(v.get("com.iso.remotemapper.learned", [])))
else:
    print("active" if active else "inactive")
EOF
