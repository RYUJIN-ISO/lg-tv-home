# Screensaver guard (run as root, in the background; started at boot by
# init.d/87-frame-saver and by TV Home itself). One copy only.
#
# - tvpowerd asks registered clients before it starts LG's screensaver. While
#   the picture frame runs (heartbeat fresh, see keepawake.py) the answer is
#   "no". With "Instead of Screensaver" on (config frame.saver) the answer is
#   "no" too, and the frame starts instead.
# - On a busy TV the answer can come too late and LG's screensaver starts
#   anyway. So it also watches the foreground app: if the screensaver shows
#   while the frame should, it closes the screensaver and brings the frame up.
# Log: /tmp/atvhome-saver.log
import json, os, signal, subprocess, sys, threading, time

PID = "/tmp/atvhome-saver.pid"
BEAT = "/tmp/atvhome-awake.beat"
LOG = "/tmp/atvhome-saver.log"
CONFIG = "/var/lib/webosbrew/atvhome/config.json"
NAME = "atvhome-saver"
POWER = "luna://com.webos.service.tvpower/power/"
APPS = "luna://com.webos.applicationManager/"
SAVER_APP = "com.webos.app.screensaver"

try:                                    # one copy only
    os.kill(int(open(PID).read()), 0)
    sys.exit(0)
except (OSError, ValueError):
    pass
open(PID, "w").write(str(os.getpid()))


def log(text):
    with open(LOG, "a") as f:
        f.write(time.strftime("%H:%M:%S ") + text + "\n")


def luna(uri, params):
    # Fire and forget: waiting for the reply is what made answers late.
    subprocess.Popen(["luna-send", "-n", "1", uri, json.dumps(params)],
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def beat_fresh():
    try:
        return time.time() - os.path.getmtime(BEAT) < 150
    except OSError:
        return False


# When LG's screensaver covers TV Home, the frame ends itself and removes the
# heartbeat, so remember when the frame was last seen running.
seen_running = 0
def watch_beat():
    global seen_running
    while True:
        if beat_fresh():
            seen_running = time.time()
        time.sleep(3)


def frame_running():
    return beat_fresh() or time.time() - seen_running < 10


def saver_on():
    try:
        return json.load(open(CONFIG)).get("frame", {}).get("saver") is True
    except (OSError, ValueError):
        return False


# The app on screen (not TV Home, not the screensaver): ending a frame that
# replaced the screensaver goes back to it.
current_app = ""
OWN = ("com.iso.atvhome", SAVER_APP, "")


last_start = 0
def start_frame(why, back=""):
    global last_start
    if time.time() - last_start < 20:  # one launch per idle period
        return
    last_start = time.time()
    params = {"frame": True}
    if back:
        params["back"] = back
    luna(APPS + "launch", {"id": "com.iso.atvhome", "params": params})
    log("frame started (" + why + (", back to " + back if back else "") + ")")


subs = []
def stream(uri, params):
    p = subprocess.Popen(["luna-send", "-i", uri, json.dumps(params)],
                         stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, text=True)
    subs.append(p)
    for line in p.stdout:
        try:
            yield json.loads(line)
        except ValueError:
            continue


def requests():
    for msg in stream(POWER + "registerScreenSaverRequest", {"subscribe": True, "clientName": NAME}):
        if "timestamp" not in msg:
            continue
        running, replace = frame_running(), saver_on()
        luna(POWER + "responseScreenSaverRequest",
             {"clientName": NAME, "ack": not (running or replace), "timestamp": msg["timestamp"]})
        if running:
            log("screensaver request: no (frame running)")
        elif replace:
            log("screensaver request: no")
            start_frame("instead of screensaver", current_app)
        else:
            log("screensaver request: yes")


def foreground():
    global current_app
    for msg in stream(APPS + "getForegroundAppInfo", {"subscribe": True}):
        app = msg.get("appId", "")
        if app not in OWN:
            current_app = app
        elif app == "com.iso.atvhome":
            current_app = ""
        if app != SAVER_APP:
            continue
        running, replace = frame_running(), saver_on()
        if running or replace:
            luna(APPS + "closeByAppId", {"id": SAVER_APP})
            log("LG screensaver came up anyway, closed it")
            if running:
                last_start_reset()
                start_frame("screensaver closed")
            else:
                start_frame("screensaver closed", current_app)


def last_start_reset():
    global last_start
    last_start = 0                      # the frame must come back right away


def stop(*_):
    for p in subs:                      # never leave the registration behind
        p.terminate()
    try:
        os.remove(PID)
    except OSError:
        pass
    os._exit(0)


signal.signal(signal.SIGTERM, stop)
threading.Thread(target=watch_beat, daemon=True).start()
threading.Thread(target=foreground, daemon=True).start()
log("started")
requests()
try:
    os.remove(PID)
except OSError:
    pass
