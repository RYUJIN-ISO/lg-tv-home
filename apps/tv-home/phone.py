# Pictures from a phone for TV Home (run as root via exec).
#   python3 phone.py start <en|de>  start the upload server (or reuse the running
#                                   one); print {url, qr} and return at once
#   python3 phone.py list           print the pictures added in this session [names]
#   python3 phone.py stop           stop the server
#   python3 phone.py serve <lang>   the server itself (started by start)
#
# The phone opens http://<tv>:<port>/<token>, picks pictures, leaves out any it
# doesn't want and sends the rest, each as a JPEG (scaled to IMPORT_MAX and
# turned upright by the phone's browser) plus a 640x360 preview of its centre.
# They go straight into the library (wallpapers data dir), uncropped; the page
# also shows the pictures already on the TV, so nothing is sent twice.
# Only the random token in the address lets a phone in; the server stops by
# itself after IDLE seconds without a request and after at most LIFE seconds.
import hmac, json, os, re, secrets, signal, socket, struct, subprocess, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

APP = os.path.dirname(os.path.abspath(__file__))
STAGE = os.path.join(APP, "cache", "phone")          # qr.svg + added.json
WALLS = "/var/lib/webosbrew/atvhome/wallpapers"      # the library, as in usb.py
THUMBS = os.path.join(WALLS, "thumbs")
BUNDLED = os.path.join(APP, "wallpapers")
ADDED = os.path.join(STAGE, "added.json")
TAKEN = os.path.join(WALLS, "taken.json")   # {file: ms} the phone read from EXIF (cache.js sorts by it)
PRINTS = os.path.join(WALLS, "prints.json")  # {file: fingerprint} (the phone's, or TV Home's: usb.py fp)
META = os.path.join(WALLS, "meta.json")      # cache.js: {file: {a: added, t: taken}}


def load_json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}


def put_json(path, name, value):
    """One entry of a {file: value} file, dropping pictures that are gone."""
    d = {k: v for k, v in load_json(path).items() if os.path.exists(os.path.join(WALLS, k))}
    d[name] = value
    with open(path + ".tmp", "w") as f:
        json.dump(d, f)
    os.rename(path + ".tmp", path)
PIC = re.compile(r"^[^./][^/]*\.(jpe?g|png|webp)$", re.I)
STATE = "/tmp/atvhome-phone.json"
PORTS = range(8765, 8776)
IDLE, LIFE = 15 * 60, 60 * 60
MAX_FILES, MAX_BYTES = 100, 40 * 1024 * 1024   # per session, per picture
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


def added():
    """File names added in this session, newest first."""
    try:
        with open(ADDED) as f:
            return json.load(f)
    except Exception:
        return []


def on_tv():
    """The library as the phone sees it: [{name, file, key}], newest first.
    key: the name a picture was imported under, without the -12345 that
    imports add, so the phone can find pictures sent before (same name)."""
    out, prints, taken, meta = [], load_json(PRINTS), load_json(TAKEN), load_json(META)
    for d, bundled in ((WALLS, False), (BUNDLED, True)):
        try:
            names = [n for n in os.listdir(d) if PIC.match(n) and os.path.isfile(os.path.join(d, n))]
        except OSError:
            continue
        names.sort(key=lambda n: os.path.getmtime(os.path.join(d, n)), reverse=True)
        for n in names:
            base = re.sub(r"\.[a-z]+$", "", n, flags=re.I)
            p = {"name": base, "file": ("app/" if bundled else "") + n, "key": key(re.sub(r"(.)-[0-9]{5}$", r"\1", base))}
            if not bundled:
                p["fp"] = prints.get(n, "")
                p["taken"] = taken.get(n) or (meta.get(n) or {}).get("t") or 0
            out.append(p)
    return out


def preview(file):
    """Path of a library picture's preview (its own file when it has none)."""
    if file.startswith("app/"):
        p = os.path.join(BUNDLED, os.path.basename(file[4:]))
    else:
        n = os.path.basename(file)
        p = os.path.join(THUMBS, n)
        if not os.path.isfile(p):
            p = os.path.join(WALLS, n)
    return p if PIC.match(os.path.basename(p)) and os.path.isfile(p) else None


def safe(s):
    return re.sub(r"[^A-Za-z0-9_-]", "", s)[:30] or "phone"


def key(s):   # what two names have in common when they are the same picture (the page does the same)
    return safe(s).lower()


def qr_svg(text):
    from qrcodegen import QrCode
    q = QrCode.encode_text(text, QrCode.Ecc.MEDIUM)
    n, b = q.get_size(), 2
    path = "".join("M%d,%dh1v1h-1z" % (x + b, y + b) for y in range(n) for x in range(n) if q.get_module(x, y))
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" shape-rendering="crispEdges">'
            '<rect width="100%%" height="100%%" fill="#fff"/><path d="%s" fill="#000"/></svg>') % (n + 2 * b, n + 2 * b, path)


TEXT = {
    "en": {"title": "Pictures to TV Home", "pick": "Choose pictures", "sub": "They go straight into All Pictures on the TV. When one looks like a picture already on the TV, that one is shown next to it and the new one is left out; tap to add it anyway.",
           "new": "New", "ontv": "On the TV", "same": "Same name on the TV", "send": "Add {0} to the TV", "none": "Nothing to add", "out": "Left out",
           "ready": "Ready", "sending": "Sending …", "sent": "Added", "failed": "Failed", "full": "The TV is full", "many": "Enough for one go: open From Phone on the TV again",
           "format": "This phone can't open this format (RAW?). Save it as JPEG first."},
    "de": {"title": "Bilder an TV Home", "pick": "Bilder wählen", "sub": "Sie kommen direkt in Alle Bilder am Fernseher. Sieht eins wie ein Bild am Fernseher aus, steht jenes daneben und das neue wird weggelassen; antippen, um es trotzdem hinzuzufügen.",
           "new": "Neu", "ontv": "Am Fernseher", "same": "Gleicher Name am Fernseher", "send": "{0} zum Fernseher hinzufügen", "none": "Nichts hinzuzufügen", "out": "Weggelassen",
           "ready": "Bereit", "sending": "Wird gesendet …", "sent": "Hinzugefügt", "failed": "Fehlgeschlagen", "full": "Der Fernseher ist voll", "many": "Genug für einmal: Vom Handy am Fernseher neu öffnen",
           "format": "Dieses Format kann das Handy nicht öffnen (RAW?). Erst als JPEG speichern."},
}

PAGE = """<!doctype html><html lang="%(lang)s"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>%(title)s</title>
<style>
body{margin:0;background:#0d0d0f;color:#fff;font:17px -apple-system,system-ui,sans-serif;padding:32px 20px 120px}
h1{font-size:26px;margin:0 0 8px}p{color:#aaa;margin:0 0 28px}
h2{font-size:15px;font-weight:600;color:#aaa;text-transform:uppercase;letter-spacing:.04em;margin:28px 0 10px}
h2 b{color:#666;font-weight:600}
.btn{display:block;width:100%%;box-sizing:border-box;text-align:center;border:0;font:inherit;font-weight:600;border-radius:14px;padding:16px}
label.btn{background:#fff;color:#000}input{display:none}
#send{position:fixed;left:20px;right:20px;bottom:24px;width:auto;background:#0a84ff;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.6)}
#send:disabled{background:#333;color:#888}#send.hide{display:none}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px}
.row{display:flex;gap:10px;align-items:stretch;padding:10px 0;border-bottom:1px solid #222;cursor:pointer}
.row>.pic{flex:1}.row .tvs{flex:1;display:flex;flex-direction:column;gap:6px}
.row .tvs:empty{display:none}.row .tvs .pic{outline:2px solid #ff9f0a;outline-offset:-2px}
.row .tvs .pic i{color:#ff9f0a}
.pic{position:relative;aspect-ratio:16/9;border-radius:6px;overflow:hidden;background:#222}
.pic img{width:100%%;height:100%%;object-fit:cover;display:block}
.pic i{position:absolute;left:0;right:0;bottom:0;font:600 12px system-ui;font-style:normal;padding:14px 6px 4px;
  background:linear-gradient(transparent,rgba(0,0,0,.8));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pic.out img{opacity:.25}.pic.out i{color:#ff9f0a}
.pic.ok i{color:#30d158}.pic.err i{color:#ff453a;white-space:normal}.pic.busy i{color:#ffd60a}
#new{display:none}#new.has{display:block}
</style></head><body><h1>%(title)s</h1><p>%(sub)s</p>
<label class="btn">%(pick)s<input type="file" accept="image/*" multiple></label>
<div id="new"><h2>%(new)s</h2><div class="rows"></div></div>
<button id="send" class="btn hide" disabled></button>
<script>
var T=%(json)s, MAX=18e6, BASE=location.pathname.replace(/\\/$/,''), items=[], busy=false, tv=null;
function $(q){return document.querySelector(q);}
function tile(src,name){var d=document.createElement('div');d.className='pic';d.innerHTML='<img loading="lazy" alt=""><i></i>';
  d.querySelector('img').src=src;d.querySelector('i').textContent=name;return d;}
function label(it,c,t){it.el.className='pic'+(c?' '+c:'');it.el.querySelector('i').textContent=t;}
function sendable(){return items.filter(function(it){return !it.out&&!it.done;});}
function update(){
  var n=sendable().length,b=$('#send');
  $('#new').classList.toggle('has',items.length>0);
  b.classList.toggle('hide',!items.length);b.disabled=busy||!n;
  b.textContent=busy?T.sending:(n?T.send.replace('{0}',n):T.none);
}
function key(n){return n.replace(/[^A-Za-z0-9_-]/g,'').slice(0,30).toLowerCase()||'phone';}
// A picture's fingerprint (to spot the same photo under another name): 64
// bits as 16 hex digits, from its 640x360 preview of the centre (c: canvas).
// Each bit: is a cell of a 9x8 grey grid brighter than the one to its right.
function fingerprint(c) {
  var s = document.createElement('canvas');
  s.width = 144; s.height = 64;
  var g = s.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, 0, 0, 144, 64);
  var d = g.getImageData(0, 0, 144, 64).data, cell = [], x, y, i, j;
  for (y = 0; y < 8; y++) for (x = 0; x < 9; x++) {
    var sum = 0;
    for (j = 0; j < 8; j++) for (i = 0; i < 16; i++) {
      var o = ((y * 8 + j) * 144 + x * 16 + i) * 4;
      sum += d[o] * 3 + d[o + 1] * 6 + d[o + 2];
    }
    cell.push(sum);
  }
  var hex = '';
  for (y = 0; y < 8; y++) {
    var v = 0;
    for (x = 0; x < 8; x++) v = v * 2 + (cell[y * 9 + x] > cell[y * 9 + x + 1] ? 1 : 0);
    hex += (v < 16 ? '0' : '') + v.toString(16);
  }
  return hex;
}
// How many of the 64 bits differ (a few: the same photo).
function fpDistance(a, b) {
  var n = 0;
  for (var i = 0; i < 16; i += 2) {
    var v = parseInt(a.substr(i, 2), 16) ^ parseInt(b.substr(i, 2), 16);
    while (v) { n += v & 1; v >>= 1; }
  }
  return n;
}
// The same photo on the TV: the same name (without the -12345 imports add),
// the same fingerprint (give or take a few bits) or taken at the same second.
// Android's picker gives most photos a number for a name, so the name
// alone misses them. The TV's pictures are shown next to the new one, which
// then starts left out.
function twins(it){
  var box=it.row.querySelector('.tvs'),same=(tv||[]).filter(function(p){
    return p.key===key(it.name)||(it.fp&&p.fp&&fpDistance(it.fp,p.fp)<=4)||(it.taken&&p.taken===it.taken);
  });
  box.innerHTML='';
  same.slice(0,3).forEach(function(p){box.appendChild(tile(BASE+'/preview/'+encodeURIComponent(p.file),T.ontv+' · '+p.name));});
  if(same.length&&!it.seen&&!it.done){it.seen=true;it.out=true;label(it,'out',T.out);update();}
}
// Picked: decoded once, one at a time, for its preview, fingerprint and date.
var checking=Promise.resolve();
function check(it){
  it.ready=checking=checking.then(function(){return new Promise(function(done){
    var img=new Image();
    img.onload=function(){
      var W=img.naturalWidth,H=img.naturalHeight;
      // the preview: the centre 16:9, like an uncropped picture on the TV
      var fw=Math.min(W,H*16/9),fh=fw*9/16,th=document.createElement('canvas');th.width=640;th.height=360;
      var tg=th.getContext('2d');tg.fillStyle='#0d0d0f';tg.fillRect(0,0,640,360);tg.drawImage(img,(W-fw)/2,(H-fh)/2,fw,fh,0,0,640,360);
      try{it.fp=fingerprint(th);}catch(e){}
      Promise.all([blob(th,0.85),takenOf(it.f)]).then(function(r){it.thumb=r[0];it.taken=r[1];twins(it);done();});
    };
    img.onerror=function(){it.bad=true;it.out=true;label(it,'err',T.format);update();done();};
    img.src=it.url;
  });});
}
$('input').onchange=function(e){
  [].slice.call(e.target.files).forEach(function(f){
    var it={f:f,url:URL.createObjectURL(f),name:f.name.replace(/\\.[^.]+$/,'')};
    it.el=tile(it.url,it.name);label(it,'',T.ready);
    it.row=document.createElement('div');it.row.className='row';it.row.appendChild(it.el);
    it.row.insertAdjacentHTML('beforeend','<div class="tvs"></div>');
    it.row.onclick=function(){if(busy||it.done||it.bad)return;it.out=!it.out;label(it,it.out?'out':'',it.out?T.out:T.ready);update();};
    $('.rows').appendChild(it.row);items.push(it);twins(it);check(it);
  });
  e.target.value='';update();
};
$('#send').onclick=function(){
  var todo=sendable();if(!todo.length||busy)return;busy=true;update();
  (function next(i){
    if(i>=todo.length){busy=false;update();loadTv();return;}
    label(todo[i],'busy',T.sending);send(todo[i]).then(function(){next(i+1);});
  })(0);
};
// When a photo was taken, as ms (EXIF time read as UTC; only for sorting),
// from the start of a JPEG (b: bytes, 128 KB are plenty), or 0.
function exifDate(b) {
  if (b[0] !== 0xFF || b[1] !== 0xD8) return 0;
  for (var p = 2; p + 4 < b.length && b[p] === 0xFF;) {
    var m = b[p + 1], len = b[p + 2] << 8 | b[p + 3];
    if (m === 0xE1 && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66) return tiffDate(b, p + 10);
    if (m === 0xDA) return 0;
    p += 2 + len;
  }
  return 0;
}
function tiffDate(b, t) {
  var le = b[t] === 0x49;
  function u16(o) { o += t; return le ? b[o] | b[o + 1] << 8 : b[o] << 8 | b[o + 1]; }
  function u32(o) { return le ? u16(o) + u16(o + 2) * 65536 : u16(o) * 65536 + u16(o + 2); }
  function tags(ifd) {   // {tag: value offset}
    var out = {}, n = u16(ifd);
    if (t + ifd + 2 + n * 12 > b.length) return out;
    for (var i = 0; i < n; i++) { var e = ifd + 2 + i * 12; out[u16(e)] = u32(e + 8); }
    return out;
  }
  function date(o) {
    if (!o || t + o + 19 > b.length) return 0;
    var s = '';
    for (var i = 0; i < 19; i++) s += String.fromCharCode(b[t + o + i]);
    var d = /^(\\d{4}):(\\d\\d):(\\d\\d) (\\d\\d):(\\d\\d):(\\d\\d)$/.exec(s);
    return d && +d[1] > 1900 ? Date.UTC(+d[1], d[2] - 1, +d[3], +d[4], +d[5], +d[6]) : 0;
  }
  var ifd0 = tags(u32(4)), ex = ifd0[0x8769] ? tags(ifd0[0x8769]) : {};
  return date(ex[0x9003]) || date(ex[0x9004]) || date(ifd0[0x0132]);
}
// A date in a file name (20230222_212654, IMG-20230222-WA0001, 2023-02-22 …), or 0.
function nameDate(n) {
  var d = /(?:^|[^0-9])((?:19|20)\\d\\d)[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\\d|3[01])(?:[-_ T.]?([01]\\d|2[0-3])[-_.]?([0-5]\\d)[-_.]?([0-5]\\d))?/.exec(n);
  return d ? Date.UTC(+d[1], d[2] - 1, +d[3], +(d[4] || 0), +(d[5] || 0), +(d[6] || 0)) : 0;
}
// The date the photo was taken, read before the canvas drops the EXIF.
function takenOf(f){
  return new Promise(function(ok){
    var r=new FileReader();
    r.onload=function(){var t=0;try{t=exifDate(new Uint8Array(r.result));}catch(e){}ok(t||nameDate(f.name));};
    r.onerror=function(){ok(nameDate(f.name));};
    r.readAsArrayBuffer(f.slice(0,131072));
  });
}
function blob(c,q){return new Promise(function(ok){c.toBlob(ok,'image/jpeg',q);});}
function post(path,b){return fetch(BASE+path,{method:'POST',body:b,headers:{'Content-Type':'image/jpeg'}})
  .then(function(r){return r.text().then(function(t){if(!r.ok)throw new Error(t);return t;});});}
function send(it){
  return it.ready.then(function(){return new Promise(function(done){
    var img=new Image();
    img.onload=function(){
      var W=img.naturalWidth,H=img.naturalHeight,s=Math.min(1,Math.sqrt(MAX/(W*H))),c=document.createElement('canvas');
      c.width=Math.round(W*s);c.height=Math.round(H*s);var g=c.getContext('2d');g.fillStyle='#0d0d0f';g.fillRect(0,0,c.width,c.height);g.drawImage(img,0,0,c.width,c.height);
      blob(c,0.9).then(function(full){
        return post('/upload?name='+encodeURIComponent(it.name)+'&taken='+(it.taken||0)+'&fp='+(it.fp||''),full)
          .then(function(file){return post('/thumb?file='+encodeURIComponent(file),it.thumb);});
      }).then(function(){it.done=true;label(it,'ok',T.sent);},
              function(e){label(it,'err',T[e.message]||T.failed);}).then(done);
    };
    img.onerror=function(){label(it,'err',T.format);done();};
    img.src=it.url;
  });});
}
function loadTv(){
  fetch(BASE+'/pictures').then(function(r){return r.json();}).then(function(list){
    tv=list;items.forEach(function(it){if(!it.done)twins(it);});update();
  },function(){});
}
loadTv();
</script></body></html>"""


def serve(lang):
    import threading
    os.makedirs(STAGE, exist_ok=True)
    os.makedirs(WALLS, exist_ok=True)
    lock = threading.Lock()
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

        def query(self, key):
            from urllib.parse import unquote
            q = self.path.split("?", 1)[1] if "?" in self.path else ""
            m = re.search(r"(?:^|&)" + key + r"=([^&]*)", q)
            return unquote(m.group(1)) if m else ""

        def do_GET(self):
            rest = self.ok_token()
            if rest is None:
                return
            if rest == []:
                self.reply(200, page, "text/html; charset=utf-8")
            elif rest == ["pictures"]:
                self.reply(200, json.dumps(on_tv()).encode(), "application/json")
            elif len(rest) == 2 and rest[0] == "preview":
                from urllib.parse import unquote
                p = preview(unquote(rest[1]))
                if not p:
                    self.reply(404, b"")
                    return
                with open(p, "rb") as f:
                    body = f.read()
                ext = p.rsplit(".", 1)[-1].lower()
                self.reply(200, body, {"png": "image/png", "webp": "image/webp"}.get(ext, "image/jpeg"))
            else:
                self.reply(404, b"")

        def body(self):
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > MAX_BYTES:
                self.reply(413, b"failed")
                return None
            if free_bytes(WALLS) - n < MIN_FREE:
                self.reply(507, b"full")
                return None
            data = self.rfile.read(n)
            if data[:2] != b"\xff\xd8":
                self.reply(415, b"failed")
                return None
            return data

        def do_POST(self):
            rest = self.ok_token()
            if rest is None:
                return
            if rest == ["upload"]:
                # A new picture: into the library under a free name, uncropped.
                with lock:
                    if len(added()) >= MAX_FILES:
                        self.reply(507, b"many")
                        return
                data = self.body()
                if data is None:
                    return
                with lock:
                    base = safe(self.query("name"))
                    fn = "%s-%s.jpg" % (base, str(int(time.time() * 1000))[-5:])
                    while os.path.exists(os.path.join(WALLS, fn)):
                        fn = "%s-%05d.jpg" % (base, secrets.randbelow(10 ** 5))
                    tmp = os.path.join(WALLS, "." + fn + ".part")   # TV Home never lists half a file
                    with open(tmp, "wb") as f:
                        f.write(data)
                    os.rename(tmp, os.path.join(WALLS, fn))
                    t = self.query("taken")
                    if re.match(r"^[1-9][0-9]{8,13}$", t):
                        put_json(TAKEN, fn, int(t))
                    fp = self.query("fp")
                    if re.match(r"^[0-9a-f]{16}$", fp):
                        put_json(PRINTS, fn, fp)
                    done = added()
                    done.insert(0, fn)
                    with open(ADDED + ".tmp", "w") as f:
                        json.dump(done, f)
                    os.rename(ADDED + ".tmp", ADDED)
                self.reply(200, fn.encode())
            elif rest == ["thumb"]:
                # Its preview, only for a picture this session added.
                fn = os.path.basename(self.query("file"))
                if fn not in added():
                    self.reply(404, b"failed")
                    return
                data = self.body()
                if data is None:
                    return
                os.makedirs(THUMBS, exist_ok=True)
                tmp = os.path.join(THUMBS, "." + fn + ".part")
                with open(tmp, "wb") as f:
                    f.write(data)
                os.rename(tmp, os.path.join(THUMBS, fn))
                self.reply(200, b"ok")
            else:
                self.reply(404, b"")

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
        # A new session: the QR code and the list of added pictures start afresh.
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
    print(json.dumps(added()))
elif cmd == "stop":
    st = running()
    if st:
        os.kill(st["pid"], signal.SIGTERM)
