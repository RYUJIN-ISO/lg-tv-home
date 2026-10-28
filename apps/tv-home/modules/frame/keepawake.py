# Picture frame keep-awake (run as root via Homebrew Channel exec, in the
# background). tvpowerd asks registered clients before it starts the
# screensaver; one "no" (ack: false) keeps it away. This answers "no" for as
# long as the launcher touches the heartbeat file, and quits when the
# heartbeat is older than 150 s, so it can never block the screensaver for
# good. Requests are logged to /tmp/atvhome-awake.log.
import json, os, signal, subprocess, sys, threading, time

PID = "/tmp/atvhome-awake.pid"
BEAT = "/tmp/atvhome-awake.beat"
LOG = "/tmp/atvhome-awake.log"
NAME = "atvhome-frame"
POWER = "luna://com.webos.service.tvpower/power/"

try:                                    # one copy only
    os.kill(int(open(PID).read()), 0)
    sys.exit(0)
except (OSError, ValueError):
    pass
open(PID, "w").write(str(os.getpid()))


def log(text):
    with open(LOG, "a") as f:
        f.write(time.strftime("%H:%M:%S ") + text + "\n")


sub = subprocess.Popen(["luna-send", "-i", POWER + "registerScreenSaverRequest",
                        json.dumps({"subscribe": True, "clientName": NAME})],
                       stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, text=True)


def watchdog():
    while True:
        time.sleep(20)
        try:
            age = time.time() - os.path.getmtime(BEAT)
        except OSError:
            age = 999
        if age > 150:
            log("heartbeat stopped, quitting")
            sub.terminate()
            return


def stop(*_):
    sub.terminate()                     # never leave the registration behind


signal.signal(signal.SIGTERM, stop)
threading.Thread(target=watchdog, daemon=True).start()
log("registered")
for line in sub.stdout:
    try:
        msg = json.loads(line)
    except ValueError:
        continue
    if "timestamp" in msg:
        subprocess.run(["luna-send", "-n", "1", "-w", "3000", POWER + "responseScreenSaverRequest",
                        json.dumps({"clientName": NAME, "ack": False, "timestamp": msg["timestamp"]})],
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
        log("screensaver request answered with no")
try:
    os.remove(PID)
except OSError:
    pass
