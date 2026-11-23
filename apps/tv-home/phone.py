# Pictures from a phone for TV Home (run as root via exec).
#   python3 phone.py start <en|de>  start the upload server (or reuse the running
#                                   one); print {url, qr} and return at once
#   python3 phone.py list           print the received pictures [{name, url, w, h}]
#   python3 phone.py remove <file>  drop a received picture (it was added)
#   python3 phone.py stop           stop the server
#   python3 phone.py serve <lang>   the server itself (started by start)
#
# The phone opens http://<tv>:<port>/<token>, picks pictures and sends each one
# as a JPEG (scaled and turned upright by the phone's browser). They land in
# cache/phone/, where TV Home shows them like a USB stick: OK crops and adds.
# Only the random token in the address lets a phone in; the server stops by
# itself after IDLE seconds without a request and after at most LIFE seconds.
import hmac, json, os, re, secrets, signal, socket, struct, subprocess, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

APP = os.path.dirname(os.path.abspath(__file__))
STAGE = os.path.join(APP, "cache", "phone")
STATE = "/tmp/atvhome-phone.json"
PORTS = range(8765, 8776)
IDLE, LIFE = 15 * 60, 60 * 60
MAX_FILES, MAX_BYTES = 30, 40 * 1024 * 1024
MIN_FREE = 150 * 1024 * 1024   # imports go on to /var (about 1 GB, shared with webOS)

sys.path.insert(0, APP)   # qrcodegen.py next to this file


def size(path):   # the same as in usb.py (importing usb.py would run its commands)
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



def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 9))   # no packet is sent; picks the LAN interface
        return s.getsockname()[0]
    finally:
        s.close()


def running():
    try:
        with open(STATE) as f:
            st = json.load(f)
        os.kill(st["pid"], 0)
        return st
    except Exception:
        return None


def free_bytes(path):
    v = os.statvfs(path)
    return v.f_bavail * v.f_frsize


def received():
    out = []
    if not os.path.isdir(STAGE):
        return out
    for n in sorted(os.listdir(STAGE), reverse=True):   # newest first
        if not n.endswith(".jpg"):
            continue
        p = os.path.join(STAGE, n)
        try:
            wh = size(p)
        except Exception:
            wh = None
        if wh:
            out.append({"name": n[14:-4] or "phone", "url": "cache/phone/" + n, "w": wh[0], "h": wh[1]})
    return out


def qr_svg(text):
    from qrcodegen import QrCode
    q = QrCode.encode_text(text, QrCode.Ecc.MEDIUM)
    n, b = q.get_size(), 2
    path = "".join("M%d,%dh1v1h-1z" % (x + b, y + b) for y in range(n) for x in range(n) if q.get_module(x, y))
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" shape-rendering="crispEdges">'
            '<rect width="100%%" height="100%%" fill="#fff"/><path d="%s" fill="#000"/></svg>') % (n + 2 * b, n + 2 * b, path)


TEXT = {
    "en": {"title": "Pictures to TV Home", "pick": "Choose pictures", "sub": "They appear on the TV, where you crop and add them.",
           "sending": "Sending …", "sent": "On the TV", "failed": "Failed", "full": "The TV is full", "many": "Too many pictures waiting on the TV"},
    "de": {"title": "Bilder an TV Home", "pick": "Bilder wählen", "sub": "Sie erscheinen am Fernseher, dort zuschneiden und hinzufügen.",
           "sending": "Wird gesendet …", "sent": "Am Fernseher", "failed": "Fehlgeschlagen", "full": "Der Fernseher ist voll", "many": "Zu viele Bilder warten am Fernseher"},
}

PAGE = """<!doctype html><html lang="%(lang)s"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>%(title)s</title>
<style>
body{margin:0;background:#0d0d0f;color:#fff;font:17px -apple-system,system-ui,sans-serif;padding:32px 20px}
h1{font-size:26px;margin:0 0 8px}p{color:#aaa;margin:0 0 28px}
label{display:block;text-align:center;background:#fff;color:#000;font-weight:600;border-radius:14px;padding:16px}
input{display:none}ul{list-style:none;padding:0;margin:24px 0 0}
li{display:flex;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid #222}
li img{width:64px;height:36px;object-fit:cover;border-radius:4px;background:#222}
li span{margin-left:auto;color:#aaa;font-size:15px}li.ok span{color:#30d158}li.err span{color:#ff453a}
</style></head><body><h1>%(title)s</h1><p>%(sub)s</p>
<label>%(pick)s<input type="file" accept="image/*" multiple></label><ul></ul>
<script>
var T=%(json)s, MAX=18e6, queue=Promise.resolve();
document.querySelector('input').onchange=function(e){
  [].slice.call(e.target.files).forEach(function(f){
    var li=document.createElement('li'), url=URL.createObjectURL(f);
    li.innerHTML='<img><b></b><span></span>';
    li.querySelector('img').src=url; li.querySelector('b').textContent=f.name.replace(/\\.[^.]+$/,'').slice(0,24);
    li.querySelector('span').textContent=T.sending;
    document.querySelector('ul').appendChild(li);
    queue=queue.then(function(){return send(f,url,li);});
  });
  e.target.value='';
};
function send(f,url,li){
  return new Promise(function(done){
    var img=new Image();
    img.onload=function(){
      var W=img.naturalWidth,H=img.naturalHeight,s=Math.min(1,Math.sqrt(MAX/(W*H))),c=document.createElement('canvas');
      c.width=Math.round(W*s);c.height=Math.round(H*s);c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      c.toBlob(function(b){
        fetch(location.pathname.replace(/\\/$/,'')+'/upload?name='+encodeURIComponent(f.name.replace(/\\.[^.]+$/,'')),{method:'POST',body:b,headers:{'Content-Type':'image/jpeg'}})
          .then(function(r){return r.text().then(function(t){mark(li,r.ok?'ok':'err',r.ok?T.sent:(T[t]||T.failed));});},
                function(){mark(li,'err',T.failed);}).then(done);
      },'image/jpeg',0.9);
    };
    img.onerror=function(){mark(li,'err',T.failed);done();};
    img.src=url;
  });
}
function mark(li,c,t){li.className=c;li.querySelector('span').textContent=t;}
</script></body></html>"""


def serve(lang):
    os.makedirs(STAGE, exist_ok=True)
    token = secrets.token_urlsafe(8)
    text = TEXT.get(lang, TEXT["en"])
    page = (PAGE % dict(text, lang=lang, json=json.dumps(text))).encode()
    last = [time.time()]

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def ok_token(self):
            parts = self.path.split("?")[0].strip("/").split("/")
            if not parts or not hmac.compare_digest(parts[0].encode(), token.encode()):
                self.reply(404, b"")
                return None
            last[0] = time.time()
            return parts[1:]

        def reply(self, code, body, ctype="text/plain; charset=utf-8"):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            rest = self.ok_token()
            if rest == []:
                self.reply(200, page, "text/html; charset=utf-8")
            elif rest is not None:
                self.reply(404, b"")

        def do_POST(self):
            rest = self.ok_token()
            if rest != ["upload"]:
                if rest is not None:
                    self.reply(404, b"")
                return
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > MAX_BYTES:
                self.reply(413, b"failed")
                return
            if len(received()) >= MAX_FILES:
                self.reply(507, b"many")
                return
            if min(free_bytes(STAGE), free_bytes("/var")) - n < MIN_FREE:
                self.reply(507, b"full")
                return
            data = self.rfile.read(n)
            if data[:2] != b"\xff\xd8":
                self.reply(415, b"failed")
                return
            q = self.path.split("?", 1)[1] if "?" in self.path else ""
            m = re.search(r"(?:^|&)name=([^&]*)", q)
            from urllib.parse import unquote
            name = re.sub(r"[^A-Za-z0-9_-]", "", unquote(m.group(1)) if m else "")[:30] or "phone"
            fn = "%013d%s.jpg" % (int(time.time() * 1000) % 10 ** 13, "-" + name)
            tmp = os.path.join(STAGE, "." + fn)
            with open(tmp, "wb") as f:
                f.write(data)
            os.rename(tmp, os.path.join(STAGE, fn))   # list never sees half a file
            self.reply(200, b"ok")

    class Server(ThreadingHTTPServer):
        daemon_threads = True

        def server_bind(self):   # HTTPServer's own looks up the host name (getfqdn): up to 5 s
            import socketserver
            socketserver.TCPServer.server_bind(self)
            self.server_name, self.server_port = "tv", self.server_address[1]

    srv = None
    for port in PORTS:
        try:
            srv = Server(("0.0.0.0", port), H)
            break
        except OSError:
            continue
    if not srv:
        return
    srv.timeout = 5
    url = "http://%s:%d/%s" % (lan_ip(), port, token)
    with open(os.path.join(STAGE, "qr.svg"), "w") as f:
        f.write(qr_svg(url))
    with open(STATE + ".tmp", "w") as f:
        json.dump({"pid": os.getpid(), "url": url}, f)
    os.rename(STATE + ".tmp", STATE)
    born = time.time()
    signal.signal(signal.SIGTERM, lambda *a: sys.exit(0))
    try:
        while time.time() - last[0] < IDLE and time.time() - born < LIFE:
            srv.handle_request()
    finally:
        try:
            os.remove(STATE)
        except OSError:
            pass


def start(lang):
    st = running()
    if not st:
        # A new session: pictures left from the last one are gone.
        if os.path.isdir(STAGE):
            for n in os.listdir(STAGE):
                try:
                    os.remove(os.path.join(STAGE, n))
                except OSError:
                    pass
        try:
            os.remove(STATE)
        except OSError:
            pass
        subprocess.Popen([sys.executable, os.path.abspath(__file__), "serve", lang], start_new_session=True,
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            time.sleep(0.1)
            st = running()
            if st:
                break
    print(json.dumps({"url": st["url"], "qr": "cache/phone/qr.svg"} if st else {}))


cmd = sys.argv[1] if len(sys.argv) > 1 else ""
if cmd == "start":
    start(sys.argv[2] if len(sys.argv) > 2 else "en")
elif cmd == "serve":
    serve(sys.argv[2] if len(sys.argv) > 2 else "en")
elif cmd == "list":
    print(json.dumps(received()))
elif cmd == "remove":   # a picture added to the library
    n = os.path.basename(sys.argv[2]) if len(sys.argv) > 2 else ""
    if re.match(r"^[0-9]{13}-[A-Za-z0-9_-]+\.jpg$", n):
        try:
            os.remove(os.path.join(STAGE, n))
        except OSError:
            pass
elif cmd == "stop":
    st = running()
    if st:
        os.kill(st["pid"], signal.SIGTERM)
