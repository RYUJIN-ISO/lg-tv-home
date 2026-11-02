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
import base64, json, os, select, subprocess, sys, time
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

QS = "com.webos.app.quicksettings"

def guard_quick_settings():
    # Any change of the chain makes surface-manager re-run LG's appLaunch.js
    # init(), which "preloads" quick settings again - and that often shows the
    # already running panel (~2 s later; at boot every time). Call this right
    # before the change: a child subscribes to the system UI foreground, closes
    # the panel the first time it appears and exits (after 8 s at the latest).
    # A panel that was already open is left alone.
    sys.stdout.flush()
    ready_r, ready_w = os.pipe()
    if os.fork():
        os.close(ready_w)
        select.select([ready_r], [], [], 3)   # child subscribed (or gave up)
        os.close(ready_r)
        return
    os.close(ready_r)
    os.setsid()
    devnull = os.open(os.devnull, os.O_RDWR)
    for fd in (0, 1, 2): os.dup2(devnull, fd)
    sysui = "luna://com.webos.service.systemUIManager/"
    p = subprocess.Popen(["luna-send", "-i", sysui + "getForegroundAppInfo", '{"subscribe":true}'],
                         stdout=subprocess.PIPE, stdin=devnull, stderr=devnull)
    buf, first, end = "", True, time.time() + 8
    dec = json.JSONDecoder()
    try:
        while time.time() < end:
            if not select.select([p.stdout], [], [], end - time.time())[0]: break
            chunk = os.read(p.stdout.fileno(), 4096)
            if not chunk: break
            buf += chunk.decode("utf-8", "replace")
            while True:
                buf = buf.lstrip()
                try: msg, n = dec.raw_decode(buf)
                except ValueError: break
                buf = buf[n:]
                shown = any(a.get("appId") == QS for a in msg.get("foregroundAppInfo", []))
                if first:
                    first = False
                    os.close(ready_w)
                    if shown: raise StopIteration      # user's own panel
                elif shown:
                    subprocess.run(["luna-send", "-n", "1", "-w", "1500", sysui + "closeByAppId",
                                    json.dumps({"appId": QS})], stdout=devnull, stdin=devnull, stderr=devnull)
                    raise StopIteration
    except StopIteration:
        pass
    p.kill()
    os._exit(0)

def stock(chain):
    return [e for e in chain if "remote-mapper" not in e.get("file", "")]

def with_filter(chain):
    # "rev" makes every apply/reload a single change that surface-manager sees
    # (it only reads handler + file), so LG's quick settings preload runs once.
    s = stock(chain)
    i = next((n + 1 for n, e in enumerate(s) if e.get("handler") == "handleScreenSaver"), 0)
    return s[:i] + [dict(ENTRY, rev=int(time.time() * 1000))] + s[i:]

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
    guard_quick_settings()
    put(with_filter(chain))
    print("active")
elif cmd == "remove":
    if active:
        guard_quick_settings()
        put(stock(chain))
    print("inactive")
elif cmd == "learned":
    v = luna("getConfigs", {"configNames": ["com.iso.remotemapper.learned"]}).get("configs", {})
    print(json.dumps(v.get("com.iso.remotemapper.learned", [])))
else:
    print("active" if active else "inactive")
EOF
