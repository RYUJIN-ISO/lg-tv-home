# USB pictures + saving cropped wallpapers for TV Home (run as root via exec).
#   python3 usb.py list                 stage pictures from /tmp/usb/* into cache/usb/,
#                                       print [{name, url, w, h}]
#   python3 usb.py chunk <id> <base64>  append part of a cropped JPEG
#   python3 usb.py finish <id> <name>   decode it into the wallpapers data dir
#   python3 usb.py keep <cache path> <name>  keep the full-size original for re-cropping
# The web runtime can't read files outside the app folder, hence the staging.
import base64, glob, json, os, re, shutil, struct, sys

APP = os.path.dirname(os.path.abspath(__file__))
STAGE = os.path.join(APP, "cache", "usb")
WALLS = "/var/lib/webosbrew/atvhome/wallpapers"
EXT = re.compile(r"\.(jpe?g|png)$", re.I)
MAX_FILES, MAX_BYTES = 30, 40 * 1024 * 1024


def size(path):
    """(w, h) from the JPEG SOF / PNG IHDR header, or None."""
    with open(path, "rb") as f:
        head = f.read(26)
        if head[:8] == b"\x89PNG\r\n\x1a\n":
            return struct.unpack(">II", head[16:24])
        if head[:2] != b"\xff\xd8":
            return None
        f.seek(2)
        while True:
            b = f.read(1)
            while b and b != b"\xff":
                b = f.read(1)
            while b == b"\xff":
                b = f.read(1)
            if not b:
                return None
            if b[0] in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                f.read(3)
                h, w = struct.unpack(">HH", f.read(4))
                return w, h
            seglen = struct.unpack(">H", f.read(2))[0]
            f.seek(seglen - 2, 1)


def list_usb():
    found = []
    for root in glob.glob("/tmp/usb/*/*"):
        for dirpath, dirs, files in os.walk(root):
            if dirpath[len(root):].count(os.sep) >= 4:
                dirs[:] = []
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for n in files:
                p = os.path.join(dirpath, n)
                if EXT.search(n) and not n.startswith(".") and os.path.getsize(p) <= MAX_BYTES:
                    found.append(p)
    found.sort(key=lambda p: os.path.getmtime(p), reverse=True)
    shutil.rmtree(STAGE, ignore_errors=True)
    os.makedirs(STAGE, exist_ok=True)
    out = []
    for i, p in enumerate(found[:MAX_FILES]):
        try:
            wh = size(p)
        except Exception:
            wh = None
        if not wh:
            continue
        dst = os.path.join(STAGE, "%02d%s" % (i, os.path.splitext(p)[1].lower()))
        shutil.copyfile(p, dst)
        out.append({"name": os.path.splitext(os.path.basename(p))[0], "url": "cache/usb/" + os.path.basename(dst),
                    "w": wh[0], "h": wh[1]})
    print(json.dumps(out))


def safe(s):
    return re.sub(r"[^A-Za-z0-9_-]", "", s)[:40] or "picture"


cmd = sys.argv[1] if len(sys.argv) > 1 else ""
if cmd == "list":
    list_usb()
elif cmd == "chunk":
    with open("/tmp/crop-%s.b64" % safe(sys.argv[2]), "a") as f:
        f.write(sys.argv[3])
    print("ok")
elif cmd == "finish":
    tmp = "/tmp/crop-%s.b64" % safe(sys.argv[2])
    os.makedirs(WALLS, exist_ok=True)
    name = safe(sys.argv[3]) + ".jpg"
    with open(tmp) as f, open(os.path.join(WALLS, name), "wb") as o:
        o.write(base64.b64decode(f.read()))
    os.remove(tmp)
    print(name)
elif cmd == "thumb":
    # thumb <name> <b64>: the 640x360 preview of an imported picture
    d = os.path.join(WALLS, "thumbs")
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, safe(sys.argv[2]) + ".jpg"), "wb") as o:
        o.write(base64.b64decode(sys.argv[3]))
    print("ok")
elif cmd == "keep":
    src = os.path.join(APP, sys.argv[2].split("?")[0])
    dst_dir = os.path.join(WALLS, "originals")
    os.makedirs(dst_dir, exist_ok=True)
    for old in glob.glob(os.path.join(dst_dir, safe(sys.argv[3]) + ".*")):
        os.remove(old)
    shutil.copyfile(src, os.path.join(dst_dir, safe(sys.argv[3]) + os.path.splitext(src)[1].lower()))
    print("kept")
else:
    sys.exit("usage: usb.py list | chunk <id> <b64> | finish <id> <name> | thumb <name> <b64>")
