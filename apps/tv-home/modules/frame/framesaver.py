# Screensaver guard (run as root, in the background; started at boot by
# init.d/87-frame-saver and by TV Home itself). One copy only.
#
# - tvpowerd asks registered clients before it starts LG's screensaver, but
#   starts it whatever they answer. So the guard watches tvpowerd's power
#   state instead: with "Instead of Screensaver" on (config frame.saver), LG's
#   screensaver shows for a few seconds while the frame starts behind it, then
#   the guard closes it (the handoff, see power_state). If LG's screensaver
#   comes up over a frame that already runs, it is closed at once.
# - While the frame runs it also switches LG's screensaver off (setting
#   general.screenSaverEnabled, which tvpowerd follows live), so there is no
#   request to answer late, and back on when the frame ends. The marker file
#   OFF_MARK says the guard turned it off (survives a crash or power cut, so
#   the next start turns it back on); a screensaver the user switched off
#   stays off.
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
SETTINGS = "luna://com.webos.settingsservice/"
OFF_MARK = "/var/lib/webosbrew/atvhome/screensaver-off-by-frame"

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


def lg_saver_enabled():
    out = subprocess.run(["luna-send", "-n", "1", "-w", "5000", SETTINGS + "getSystemSettings",
                          json.dumps({"category": "general", "keys": ["screenSaverEnabled"]})],
                         stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, text=True).stdout
    try:
        return json.loads(out)["settings"]["screenSaverEnabled"] != "off"
    except (ValueError, KeyError, TypeError):
        return None                     # unknown: leave it alone


def set_lg_saver(on):
    subprocess.run(["luna-send", "-n", "1", "-w", "5000", SETTINGS + "setSystemSettings",
                    json.dumps({"category": "general", "settings": {"screenSaverEnabled": "on" if on else "off"}})],
                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL)


# When LG's screensaver covers TV Home, the frame ends itself and removes the
# heartbeat, so remember when the frame was last seen running. Also switches
# LG's screensaver off while the frame runs (see the top).
seen_running = 0
hold_off_until = 0                      # off for a frame that is still starting
def lg_saver_off():
    if not os.path.exists(OFF_MARK) and lg_saver_enabled():
        open(OFF_MARK, "w").close()
        set_lg_saver(False)
        log("LG screensaver off while the frame runs")


def watch_beat():
    global seen_running
    while True:
        fresh = beat_fresh()
        if fresh:
            seen_running = time.time()
        marked = os.path.exists(OFF_MARK)
        if fresh and not marked and not handoff:   # not during the handoff (could close LG's early)
            lg_saver_off()
        elif not (fresh or time.time() < hold_off_until) and marked:
            set_lg_saver(True)
            os.remove(OFF_MARK)
            log("LG screensaver back on")
        time.sleep(3)


def frame_running():
    return beat_fresh() or time.time() - seen_running < 10


# Off too while the Picture Frame is switched off in Settings > Features.
def saver_on():
    try:
        c = json.load(open(CONFIG))
        return c.get("frame", {}).get("saver") is True and c.get("modules", {}).get("frame") is not False
    except (OSError, ValueError, AttributeError):
        return False


# The app on screen (not TV Home, not the screensaver): ending a frame that
# replaced the screensaver goes back to it.
current_app = ""
OWN = ("com.iso.atvhome", SAVER_APP, "")


last_start = 0
last_back = ""                          # the app the running frame returns to
def start_frame(why, back=""):
    global last_start, last_back
    if time.time() - last_start < 20:  # one launch per idle period
        return
    last_start = time.time()
    last_back = back
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
    global handoff_back
    for msg in stream(POWER + "registerScreenSaverRequest", {"subscribe": True, "clientName": NAME}):
        if "timestamp" not in msg:
            continue
        running, replace = frame_running(), saver_on()
        # tvpowerd starts its screensaver whatever the answer says (tested:
        # "no" and "yes" alike), so the answer only keeps the protocol.
        luna(POWER + "responseScreenSaverRequest",
             {"clientName": NAME, "ack": not running, "timestamp": msg["timestamp"]})
        if running:
            log("screensaver request (frame running)")
        elif replace:
            handoff_back = current_app      # the app to return to, before LG's screensaver covers it
            log("screensaver request: LG first, then the frame" + (" (back to " + handoff_back + ")" if handoff_back else ""))
        else:
            log("screensaver request: LG's screensaver")


def foreground():
    global current_app
    for msg in stream(APPS + "getForegroundAppInfo", {"subscribe": True}):
        app = msg.get("appId", "")
        if app not in OWN:
            current_app = app
        elif app == "com.iso.atvhome":
            current_app = ""


# The handoff (Instead of Screensaver): LG's screensaver shows for LG_FIRST
# seconds while the frame starts behind it, then the guard closes it and the
# frame is already there. A key during those seconds closes LG's screensaver
# as usual; then the hidden frame goes and the app before comes back.
# A frame that was already running is never covered: close LG's at once.
LG_FIRST = 10
handoff_back = ""
handoff = None                          # timer that closes LG's screensaver
handoff_start = 0


def close_lg_saver():
    global handoff
    handoff = None
    luna(APPS + "closeByAppId", {"id": SAVER_APP})
    log("handoff: LG screensaver closed, frame showing")


def power_state():
    global handoff, handoff_start
    for msg in stream(POWER + "getPowerState", {"subscribe": True}):
        state = msg.get("state")
        if state == "Active" and handoff:
            handoff.cancel()
            handoff = None
            if time.time() - handoff_start < 3:
                log("handoff: LG screensaver went when the frame started, frame showing")
                continue
            # woken by a key during LG's screensaver: undo the hidden frame
            if last_back:
                luna(APPS + "launch", {"id": last_back})
            else:
                luna(APPS + "launch", {"id": "com.iso.atvhome"})
            log("handoff: woken by a key, back to " + (last_back or "TV Home"))
            continue
        if state != "Screen Saver":
            continue
        if frame_running():
            luna(APPS + "closeByAppId", {"id": SAVER_APP})
            log("LG screensaver came up over the frame, closed it")
            time.sleep(1.5)             # until tvpowerd is back to Active
            last_start_reset()
            start_frame("screensaver closed", last_back)
        elif saver_on() and not handoff:
            last_start_reset()
            start_frame("behind LG's screensaver", handoff_back)
            handoff_start = time.time()
            handoff = threading.Timer(LG_FIRST, close_lg_saver)
            handoff.start()


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
threading.Thread(target=power_state, daemon=True).start()
log("started")
requests()
try:
    os.remove(PID)
except OSError:
    pass
