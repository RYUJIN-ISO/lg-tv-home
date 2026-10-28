// Picture Frame for TV Home: the wallpapers full screen and dimmable, like a
// framed picture, as a card on the home screen and under Settings > Look.
// Optionally it replaces LG's screensaver (framesaver.py, started at boot by
// tv/init.d/87-frame-saver). keepawake.py holds LG's screensaver off while it
// runs; frameworker.js decodes pictures off the main thread. Those three files
// are copied next to app.js by install.sh with this module.
(function () {
  // The frame as an app on the home screen: moves, goes into folders and off
  // the home screen like any app.
  var FRAME_KEY = '__frame';
  var FRAME_ICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="136" height="136" viewBox="0 0 24 24" fill="#fff"><path d="M21 3H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H3V5h18v14zM5 17l3.5-4.5 2.5 3 3.5-4.5L19 17H5z"/></svg>');
  // Hidden: another app took over, so the frame ends. But LG's screensaver
  // can cover the frame for a moment until framesaver.py closes it again, so
  // wait a few seconds before ending it.
  var hiddenTimer = null;

  // ---------------------------------------------------------------- picture frame

  // Wallpapers full screen and dimmed, like a framed picture. Any key ends it.
  // LG's screensaver is held off by keepawake.py (see AWAKE_*); LG's own auto
  // power off still applies. Against OLED burn-in the picture drifts a few pixels now and then.
  var FRAME_EVERY = [1, 5, 15, 30, 60];   // minutes
  // keepawake.py answers tvpowerd's screensaver requests with "no" while the
  // heartbeat file is fresh; the idle timer restart covers surface-manager.
  var AWAKE_BEAT = "touch /tmp/atvhome-awake.beat; luna-send -n 1 luna://com.webos.surfacemanager.screenSaver/restartUserActivityTimer '{}' > /dev/null";
  var AWAKE_START = AWAKE_BEAT + "; setsid python3 " + APP_DIR + "keepawake.py > /dev/null 2>&1 < /dev/null &";
  var SAVER_START = 'setsid python3 ' + APP_DIR + 'framesaver.py > /dev/null 2>&1 < /dev/null &';
  var AWAKE_STOP = "rm -f /tmp/atvhome-awake.beat; [ -f /tmp/atvhome-awake.pid ] && kill $(cat /tmp/atvhome-awake.pid) 2>/dev/null; true";
  var frameView = null;
  // App to return to when the frame replaced LG's screensaver over it (set by
  // framesaver.py in the launch params); only a key press goes back there.
  var frameBack = '';

  function frameCfg() {
    var c = cfg();
    if (!c.frame) c.frame = clone(DEFAULT_CONFIG.frame);
    return c.frame;
  }

  function framePictures() {
    var list = folderPics(pictureFolder(frameCfg().show));
    return list.length ? list : state.wallpapers;
  }

  // The picture library opened for the frame: ✓ on its folder, OK on a
  // picture starts the frame there with that folder.
  var FRAME_USE = {
    title: function () { return t('frame'); },
    hint: 'frameHere',
    albumOn: function (e) { return e.type === 'album' && e.key === (pictureFolder(frameCfg().show) ? frameCfg().show : 'all'); },
    pick: function (fo, e) {
      frameCfg().show = fo ? fo.id : 'all';
      saveConfig();
      closeAll();
      startFrame(e.key);
    }
  };

  function everyLabel(m) { return m < 60 ? t('minutes', m) : t('hour'); }

  function openFrameSettings() {
    function step(list, v, d) { var i = list.indexOf(v); return list[(i + d + list.length) % list.length]; }
    menu({
      title: function () { return t('frame'); },
      info: 'frameSettings',
      rows: function () {
        var f = frameCfg(), n = framePictures().length;
        var rows = [
          { label: t('frameStart'), action: startFrame },
          { label: t('framePictures'), value: pictureFolder(f.show) ? pictureFolder(f.show).name : t('allPictures'),
            chevron: true, action: function () { openPictures(FRAME_USE); } }
        ];
        if (n > 1) rows.push({ label: t('frameEvery'), value: '‹ ' + everyLabel(f.every) + ' ›',
          adjust: function (d) { f.every = step(FRAME_EVERY, f.every, d); saveConfig(); refreshTop(); },
          action: function () { f.every = step(FRAME_EVERY, f.every, 1); saveConfig(); refreshTop(); } });
        function motion() { f.pan = f.pan === false; saveConfig(); refreshTop(); }
        rows.push({ label: t('frameMotion'), value: f.pan === false ? t('still') : t('pan'),
          action: motion, adjust: motion });
        rows.push({ label: t('brightness'), value: '‹ ' + f.bri + '% ›',
          adjust: function (d) { f.bri = Math.max(20, Math.min(100, f.bri + d * 10)); saveConfig(); refreshTop(); },
          action: function () { f.bri = f.bri >= 100 ? 20 : f.bri + 10; saveConfig(); refreshTop(); } });
        rows.push({ label: t('frameSaver'), value: f.saver ? t('on') : t('off'), action: function () {
          f.saver = !f.saver; saveConfig(); exec(SAVER_START); refreshTop();
        } });
        rows.push({ info: true, label: t('frameHow') });
        return rows;
      }
    });
  }

  // start: name of the picture to begin with (optional).
  function startFrame(start) {
    var pics = framePictures();
    if (!pics.length) { showHint(t('frameNone')); setTimeout(function () { showHint(''); }, 3000); return; }
    if (frameView) return;
    // Shuffled order; what was shown is kept so CH- can go back.
    var order = [], shown = 0, history = [], at = -1;
    function shuffled() {
      if (shown >= order.length) {
        order = pics.slice();
        for (var i = order.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1)), x = order[i];
          order[i] = order[j]; order[j] = x;
        }
        shown = 0;
      }
      return order[shown++];
    }
    function nextPic() {
      if (at < history.length - 1) return history[++at];
      history.push(shuffled());
      return history[at = history.length - 1];
    }
    function prevPic() { return at > 0 ? history[--at] : null; }
    var first = pics.filter(function (w) { return w.name === start; })[0];
    if (first) history.push(first);
    // The picture nextPic() will return, without moving on (for preloading).
    function peekNext() {
      if (at >= history.length - 1) history.push(shuffled());
      return history[at + 1];
    }
    var el = layer('frame');
    var view = { el: el, timers: [], stop: null };
    view.end = function (why) {
      exec('echo "$(date +%T) frame ended: ' + (why || 'ok') + '" >> /tmp/atvhome-events.log');
      view.byUser = true;
      pop();
    };
    view.key = view.end;
    view.ok = view.end;
    // CH+/CH- change the picture, arrows move through it; other keys end it.
    var lastSkip = 0;
    view.control = function (code) {
      if (code === 33 || code === 34) {
        if (Date.now() - lastSkip > 400 && view.skip) { lastSkip = Date.now(); view.skip(code === 33 ? 1 : -1); }
        return true;
      }
      if (code >= 37 && code <= 40) {
        if (view.move) view.move(code === 37 ? -1 : code === 39 ? 1 : 0, code === 38 ? -1 : code === 40 ? 1 : 0);
        return true;
      }
      return false;
    };
    view.onClose = function () {
      view.timers.forEach(clearInterval);
      exec(AWAKE_STOP);
      if (view.stop) view.stop();
      frameView = null;
      document.body.classList.remove('framing');
      var back = frameBack;
      frameBack = '';
      if (view.byUser && back) launch({ id: back, params: {} });
    };
    el.addEventListener('click', function () { if (frameView === view) view.end('click'); });
    frameView = view;
    document.body.classList.add('framing');
    push(view);
    if (!glFrame(view, nextPic, prevPic, peekNext, pics.length)) cssFrame(view, nextPic, prevPic, pics.length);
    exec(AWAKE_START);
    view.timers.push(setInterval(function () { exec(AWAKE_BEAT); }, 60000));
  }

  // WebGL renderer: every picture is one GPU texture, drawn each frame at a
  // slowly moving offset. Pictures bigger than the screen (or not 16:9) pan
  // across their whole area and turn round gently; 16:9 pictures only drift a
  // few pixels (OLED care). Uploads go in strips, a few per frame, so a new
  // picture never stalls the motion.
  // Shared with frameworker.js (keep the two in step).
  function texScale(nw, nh, W, H, cw, maxTex) {
    var need = Math.max(W / nw, H / nh);
    if (cw) need = Math.max(need, W / (cw * nw));
    return Math.min(1, maxTex / Math.max(nw, nh), need);
  }

  var PAN_SPEED = 7;          // screen pixels per second, on average
  var FADE_MS = 700;

  function glFrame(view, nextPic, prevPic, peekNext, count) {
    var canvas = document.createElement('canvas');
    var dpr = window.devicePixelRatio || 1;
    var W = Math.round(1920 * dpr), H = Math.round(1080 * dpr);
    canvas.width = W; canvas.height = H;
    canvas.className = 'fgl';
    var gl = null;
    try {
      gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false,
        powerPreference: 'high-performance' });
    } catch (e) {}
    if (!gl) return false;
    view.el.appendChild(canvas);

    function shader(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      return s;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER,
      'attribute vec2 p; varying vec2 uv; uniform vec2 off; uniform vec2 span;' +
      'void main() { uv = off + (p * vec2(0.5, -0.5) + 0.5) * span; gl_Position = vec4(p, 0.0, 1.0); }'));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER,
      // highp: texture coordinates near 1.0 (the lower part of the picture)
      // have too few steps in mediump, so that part moved in visible jumps.
      '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
      'varying vec2 uv; uniform sampler2D tex; uniform float alpha; uniform float bri;' +
      'void main() { float m = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);' +
      ' gl_FragColor = vec4(texture2D(tex, uv).rgb * bri * m, alpha); }'));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { view.el.removeChild(canvas); return false; }
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var U = {};
    ['off', 'span', 'alpha', 'bri', 'tex'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    gl.uniform1f(U.bri, frameCfg().bri / 100);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);   // RGB strips from the worker are tightly packed
    var maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
    // Texture size: no more pixels than the screen can show of the picture
    // (filling the screen, or its crop if that zooms in further). Bigger
    // textures look the same but fill the TV's memory, and swapping makes
    // the pan stutter. cw = crop width as a fraction of the picture.
    function cropW(pic) { var r = cropOf(pic.name); return r ? r.w : 0; }

    var cur = null, prev = null, fadeStart = 0, raf = 0, stopped = false, loading = false, queued = null, timer = 0;
    var ready = null, busyPic = null, showWhenDone = false;   // ready = preloaded next picture
    var strip = document.createElement('canvas');
    var sctx = strip.getContext('2d', { willReadFrequently: true });
    var times = [], last = 0;

    // A view into the picture: top-left x, y and width v, in picture pixels
    // (the height follows from the screen's 16:9).
    function view_(x, y, v) { return { x: x, y: y, v: v }; }
    function ease(f) { return (1 - Math.cos(Math.PI * f)) / 2; }
    function mix(a, b, e) { return view_(a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e, a.v + (b.v - a.v) * e); }
    // Back and forth within 2% around a view (OLED care).
    function drift(at) {
      var v2 = at.v / 1.02;
      return { a: view_(at.x, at.y, v2), b: view_(at.x + at.v - v2, at.y + (at.v - v2) * H / W, v2), leg: 600000 };
    }

    // How the picture moves. Still: its crop (or the centre, zoomed to fill)
    // with a slight drift. Pan with a crop: from the far side of the picture
    // towards the crop, zooming in, arriving before the next picture; then it
    // rests there. Pan without a crop: corner to corner and back.
    function plan(w, h, name) {
      var rect = cropOf(name);
      var k = Math.max(W / w, H / h), cv = W / k, chh = H / k;
      var crop = rect ? view_(rect.x * w, rect.y * h, rect.w * w) : null;
      var centre = view_((w - cv) / 2, (h - chh) / 2, cv);
      if (frameCfg().pan === false) return drift(crop || centre);
      var tx = w - cv, ty = h - chh;
      if (crop) {
        var far = [[0, 0], [tx, 0], [0, ty], [tx, ty]].map(function (c) {
          var dx = c[0] + cv / 2 - (crop.x + crop.v / 2), dy = c[1] + chh / 2 - (crop.y + crop.v * H / W / 2);
          return { c: c, d: dx * dx + dy * dy };
        }).sort(function (p, q) { return q.d - p.d; })[0].c;
        var from = view_(far[0], far[1], cv);
        var dist = (Math.hypot(from.x - crop.x, from.y - crop.y) + Math.abs(cv - crop.v) / 2) * k;   // screen px
        var leg = Math.max(20000, dist / PAN_SPEED * 1000);
        var budget = count > 1 ? frameCfg().every * 60000 * 0.85 : Infinity;
        if (leg > budget) { from = mix(crop, from, budget / leg); leg = budget; }
        return { a: from, b: crop, leg: leg, once: true, rest: drift(crop) };
      }
      if (tx * k < 40 && ty * k < 40) return drift(centre);
      var x0 = Math.random() < 0.5 ? 0 : tx, y0 = Math.random() < 0.5 ? 0 : ty;
      return { a: view_(x0, y0, cv), b: view_(tx - x0, ty - y0, cv),
               leg: Math.max(60, Math.hypot(tx, ty) * k / PAN_SPEED) * 1000 };
    }


    // Pictures arrive in 64-row strips, so a new picture never stalls the
    // motion. The file is read as a blob and decoded ONCE, off the main thread
    // (createImageBitmap); strips are then cheap crops of that decoded copy.
    // (Cropping straight from an <img> re-decodes the whole JPEG per strip on
    // the TV.) Without blob decoding a 2D canvas cuts the strips instead.
    var SH = 64, BM_OPTS = { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'none' };
    var stats = { loads: 0, alloc: 0, upload: 0, slowLoading: 0, loadMs: 0, mode: '' };

    function fetchBlob(url, done) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.responseType = 'blob';
      xhr.onload = function () { done(xhr.response && xhr.response.size ? xhr.response : null); };
      xhr.onerror = function () { done(null); };
      xhr.send();
    }

    // Best path: frameworker.js decodes and cuts RGB strips in a worker thread;
    // the main thread only copies them to the texture (4 ms per frame at most).
    var worker = null, jobs = {}, jobId = 0;
    try { if (window.Worker) worker = new Worker('frameworker.js'); } catch (e) {}
    if (worker) {
      worker.onmessage = function (e) { var j = jobs[e.data.id]; if (j) j(e.data); };
      // A worker that fails to start sends every waiting picture down the fallback.
      worker.onerror = function () {
        Object.keys(jobs).forEach(function (id) { if (jobs[id]) jobs[id]({ id: +id, type: 'fail' }); });
        worker = null;
      };
    }

    function viaWorker(pic, blob, t0, fallback) {
      var id = ++jobId, tex = null, w = 0, h = 0, queue = [], finished = false, done = 0;
      jobs[id] = function (m) {
        if (stopped) return;
        if (m.type === 'fail') { delete jobs[id]; if (tex) gl.deleteTexture(tex); worker = null; fallback(); return; }
        if (m.type === 'size') {
          w = m.w; h = m.h;
          tex = newTexture(w, h);
          stats.mode = 'worker';
          requestAnimationFrame(upload);
        } else if (m.type === 'strip') queue.push(m);
        else if (m.type === 'done') finished = true;
      };
      worker.postMessage({ id: id, blob: blob, maxTex: maxTex, rows: SH, W: W, H: H, cw: cropW(pic) });
      function upload() {
        if (stopped) { delete jobs[id]; return; }
        var begin = performance.now();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        while (queue.length && performance.now() - begin < 4) {
          var m = queue.shift(), t1 = performance.now();
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, m.y, w, m.h, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array(m.data));
          stats.upload = Math.max(stats.upload, performance.now() - t1);
          done += m.h;
        }
        if (!(finished && !queue.length && done >= h)) { requestAnimationFrame(upload); return; }
        delete jobs[id];
        stats.loadMs = Math.max(stats.loadMs, performance.now() - t0);
        loaded({ tex: tex, w: w, h: h, pic: pic });
      }
    }

    function newTexture(w, h) {
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      var ta = performance.now();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, w, h, 0, gl.RGB, gl.UNSIGNED_BYTE, null);
      stats.alloc = Math.max(stats.alloc, performance.now() - ta);
      stats.loads++;
      stats.size = w + 'x' + h;
      return tex;
    }

    function decodeOnce(blob, done) {
      if (!blob || typeof createImageBitmap !== 'function') { done(null); return; }
      createImageBitmap(blob, BM_OPTS).then(done, function () { done(null); });
    }

    function load(pic, show) {
      loading = true; busyPic = pic; showWhenDone = show;
      var t0 = performance.now();
      fetchBlob(pic.url, function (blob) {
        if (stopped) return;
        if (blob && worker) viaWorker(pic, blob, t0, function () { slowLoad(pic, blob, t0); });
        else slowLoad(pic, blob, t0);
      });
    }

    // Fallbacks: decode on this thread (blob), or an <img> cut by a canvas.
    function slowLoad(pic, blob, t0) {
      decodeOnce(blob, function (full) {
        if (stopped) { if (full) full.close(); return; }
        if (full) { build(pic, full, null, t0); return; }
        var img = new Image();
        img.src = pic.url;
        var ready = img.decode ? img.decode() : new Promise(function (ok, bad) { img.onload = ok; img.onerror = bad; });
        ready.then(function () { if (!stopped) build(pic, null, img, t0); }, function () { loading = false; });
      });
    }

    function build(pic, full, img, t0) {
      var nw = full ? full.width : img.naturalWidth, nh = full ? full.height : img.naturalHeight;
      var s = texScale(nw, nh, W, H, cropW(pic), maxTex);
      var w = Math.floor(nw * s), h = Math.floor(nh * s);
      stats.mode = full ? 'blob' : 'canvas';
      var tex = newTexture(w, h);
      var n = Math.ceil(h / SH), parts = [], asked = 0, done = 0;
      function rows(i) { return Math.min(SH, h - i * SH); }
      function ask() {
        while (asked < n && asked - done < 4) {
          (function (i) {
            if (!full) { parts[i] = 'canvas'; return; }
            var sy = Math.floor(i * SH / s), sh = Math.min(nh - sy, Math.ceil(rows(i) / s));
            var opts = { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'none' };
            if (s < 1) { opts.resizeWidth = w; opts.resizeHeight = rows(i); opts.resizeQuality = 'medium'; }
            createImageBitmap(full, 0, sy, nw, sh, opts).then(function (bm) { parts[i] = bm; }, function () { parts[i] = 'canvas'; });
          })(asked++);
        }
      }
      function canvasStrip(i) {
        var hh = rows(i), src = full || img;
        if (strip.width !== w) { strip.width = w; strip.height = SH; }
        sctx.clearRect(0, 0, w, SH);
        sctx.drawImage(src, 0, i * SH / s, nw, hh / s, 0, 0, w, hh);
        return hh === SH ? strip : sctx.getImageData(0, 0, w, hh);
      }
      (function upload() {
        if (stopped) {
          parts.forEach(function (p) { if (p && p.close) p.close(); });
          if (full) full.close();
          return;
        }
        ask();
        // As many ready strips as fit in 4 ms of this frame.
        var begin = performance.now();
        while (done < n && parts[done] !== undefined && performance.now() - begin < 4) {
          var part = parts[done], t1 = performance.now();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, done * SH, gl.RGB, gl.UNSIGNED_BYTE,
            part === 'canvas' ? canvasStrip(done) : part);
          stats.upload = Math.max(stats.upload, performance.now() - t1);
          if (part.close) part.close();
          parts[done++] = null;
          ask();
        }
        if (done < n) { requestAnimationFrame(upload); return; }
        if (full) full.close();
        if (img) img.src = '';
        stats.loadMs = Math.max(stats.loadMs, performance.now() - t0);
        loaded({ tex: tex, w: w, h: h, pic: pic });
      })();
    }



    // Where the plan is now: a one-way trip (then its rest), or back and forth
    // with an eased turn at each end.
    function auto(o, now) {
      var p = o.p, t = (now - o.start) / p.leg;
      if (p.once) {
        if (t < 1) return mix(p.a, p.b, ease(t));
        t = (t - 1) * p.leg / p.rest.leg;
        p = p.rest;
      }
      var lap = Math.floor(t), e = ease(t - lap);
      return mix(p.a, p.b, lap % 2 ? 1 - e : e);
    }

    function place(o, now) {
      var q;
      if (o.man) {
        // Moved by hand: glide towards the target, frame-rate independent.
        var a = 1 - Math.exp(-(now - o.man.t) / 160);
        o.man.t = now;
        o.man.x += (o.man.tx - o.man.x) * a; o.man.y += (o.man.ty - o.man.y) * a;
        q = o.man;
      } else q = auto(o, now);
      gl.uniform2f(U.off, q.x / o.w, q.y / o.h);
      gl.uniform2f(U.span, q.v / o.w, q.v * H / W / o.h);
      gl.bindTexture(gl.TEXTURE_2D, o.tex);
    }

    function draw(now) {
      if (stopped) return;
      raf = requestAnimationFrame(draw);
      if (last) { times.push(now - last); if (loading && now - last > 25) stats.slowLoading++; }
      last = now;
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!cur) return;
      // Fade the new picture in over the old one (or over black at the start).
      var a = Math.min(1, (now - fadeStart) / FADE_MS);
      gl.disable(gl.BLEND);
      if (prev && a < 1) {
        gl.uniform1f(U.alpha, 1);
        place(prev, now);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else if (prev) { gl.deleteTexture(prev.tex); prev = null; }
      if (a < 1) gl.enable(gl.BLEND);
      gl.uniform1f(U.alpha, a);
      place(cur, now);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function loaded(o) {
      loading = false; busyPic = null;
      if (showWhenDone) show(o);
      else { if (ready) gl.deleteTexture(ready.tex); ready = o; }
      if (queued) { var q = queued; queued = null; go(q); } else preload();
    }
    function show(o) {
      if (prev) gl.deleteTexture(prev.tex);
      prev = cur;
      o.p = plan(o.w, o.h, o.pic.name);
      o.start = fadeStart = performance.now();
      cur = o;
    }
    // Show a picture: instantly when it is the preloaded one.
    function go(pic) {
      if (ready && ready.pic === pic) { var o = ready; ready = null; show(o); preload(); return; }
      if (loading && busyPic === pic) { showWhenDone = true; return; }
      if (loading) { queued = pic; return; }
      load(pic, true);
    }
    function preload() {
      if (loading || stopped) return;
      var pic = peekNext();
      if (!ready || ready.pic !== pic) load(pic, false);
    }
    function change() { go(nextPic()); }
    function restartTimer() {
      clearInterval(timer);
      if (count > 1) timer = setInterval(change, frameCfg().every * 60000);
    }
    view.skip = function (d) {
      var pic = d > 0 ? nextPic() : prevPic();
      if (!pic) return;
      go(pic);
      restartTimer();
    };
    // Arrows: stop the auto pan and move the visible area by 15% of the screen.
    view.move = function (dx, dy) {
      var o = cur;
      if (!o) return;
      var now = performance.now();
      if (!o.man) { var q = auto(o, now); o.man = { x: q.x, y: q.y, v: q.v, tx: q.x, ty: q.y, t: now }; }
      var vw = o.man.v, vh = vw * H / W;
      o.man.tx = Math.max(0, Math.min(o.w - vw, o.man.tx + dx * vw * 0.15));
      o.man.ty = Math.max(0, Math.min(o.h - vh, o.man.ty + dy * vh * 0.15));
    };

    load(nextPic(), true);
    raf = requestAnimationFrame(draw);
    restartTimer();

    // Frame times go to /tmp/atvhome-frame.txt when the frame ends.
    view.stop = function () {
      stopped = true;
      clearInterval(timer);
      cancelAnimationFrame(raf);
      if (times.length > 60) {
        var sorted = times.slice().sort(function (a, b) { return a - b; });
        var total = times.reduce(function (a, b) { return a + b; }, 0);
        var slow = times.filter(function (x) { return x > 25; }).length;
        exec('echo "v' + VERSION + ' webgl frames=' + times.length + ' fps=' + (times.length / total * 1000).toFixed(1) +
          ' p99=' + sorted[Math.floor(sorted.length * 0.99)].toFixed(1) + 'ms max=' + sorted[sorted.length - 1].toFixed(1) +
          'ms over25ms=' + slow + ' whileLoading=' + stats.slowLoading + ' loads=' + stats.loads +
          ' alloc=' + stats.alloc.toFixed(0) + 'ms strip=' + stats.upload.toFixed(1) + 'ms load=' + stats.loadMs.toFixed(0) +
          'ms via=' + stats.mode +
          ' pan=' + (frameCfg().pan !== false) + ' tex=' + maxTex + ' last=' + stats.size + ' highp=' + ((gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT) || {}).precision || 0) + '" >> /tmp/atvhome-frame.txt');
      }
      [cur, prev, ready].forEach(function (o) { if (o) gl.deleteTexture(o.tex); });
      if (worker) worker.terminate();
      var lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    };
    return true;
  }

  // Fallback without WebGL: two images crossfade, 16:9 only (cover).
  function cssFrame(view, nextPic, prevPic, count) {
    var el = view.el, front = 1;
    el.insertAdjacentHTML('beforeend', '<div class="fimg"></div><div class="fimg"></div><div class="fdim"></div>');
    var imgs = el.querySelectorAll('.fimg');
    el.querySelector('.fdim').style.opacity = (1 - frameCfg().bri / 100).toFixed(2);
    function drift(img) {
      var dx = Math.round(Math.random() * 24 - 12), dy = Math.round(Math.random() * 24 - 12);
      img.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(1.02)';
    }
    view.skip = function (d) { var pic = d > 0 ? nextPic() : prevPic(); if (pic) show(pic); };
    function show(chosen) {
      var pic = chosen || nextPic();
      var pre = new Image();
      pre.onload = pre.onerror = function () {
        if (frameView !== view) return;
        var next = imgs[1 - front];
        next.style.backgroundImage = 'url("' + pic.url + '")';
        drift(next);
        next.classList.add('on');
        imgs[front].classList.remove('on');
        front = 1 - front;
      };
      pre.src = pic.url;
    }
    show();
    if (count > 1) view.timers.push(setInterval(show, frameCfg().every * 60000));
    else view.timers.push(setInterval(function () { drift(imgs[front]); }, 10 * 60000));
  }

  INFO.pictures.lines.unshift({ en: 'Shared by Wallpaper and Picture Frame', de: 'Gemeinsam für Hintergrund und Bilderrahmen' });

  addModule({
    id: 'frame',
    title: { en: 'Picture Frame', de: 'Bilderrahmen' },
    strings: {
      en: {
        frame: 'Picture Frame', frameStart: 'Start', framePictures: 'Pictures', frameAll: 'All',
        frameEvery: 'Change every', frameHow: 'Running: {ch} picture · {arrows} look around · {ok} end',
        frameHere: '{ok} start here · {hold} ★, crop, folders', frameMotion: 'Motion', pan: 'Pan', still: 'Still',
        frameNone: 'Add a wallpaper first.', minutes: '{0} min', hour: '1 hour', frameSaver: 'Instead of Screensaver'
      },
      de: {
        frame: 'Bilderrahmen', frameStart: 'Starten', framePictures: 'Bilder', frameAll: 'Alle',
        frameEvery: 'Wechsel alle', frameHow: 'Läuft: {ch} Bild · {arrows} umschauen · {ok} Ende',
        frameHere: '{ok} hier starten · {hold} ★, Ausschnitt, Ordner', frameMotion: 'Bewegung', pan: 'Schwenken', still: 'Still',
        frameNone: 'Zuerst ein Hintergrundbild hinzufügen.', minutes: '{0} Min.', hour: '1 Stunde', frameSaver: 'Statt Bildschirmschoner'
      }
    },
    info: {
      frameSettings: { title: { en: 'Picture Frame', de: 'Bilderrahmen' }, lines: [
        { en: 'Pan: glides to the crop · Still: crop, no motion', de: 'Schwenken: gleitet zum Ausschnitt · Still: Ausschnitt, ruhig' },
        { en: '{ch} picture · {arrows} look around · {ok} end', de: '{ch} Bild · {arrows} umschauen · {ok} Ende' },
        { en: 'Instead of Screensaver: a key returns to your app', de: 'Statt Bildschirmschoner: eine Taste kehrt zur App zurück' }
      ] }
    },
    // show: 'all' or a picture folder id; saver: Instead of Screensaver.
    defaults: { frame: { every: 5, bri: 60, pan: true, show: 'all', saver: false } },
    apps: function () {
      return [{ type: 'app', key: FRAME_KEY, id: APP_ID, params: { frame: true }, lp: true, removable: false, virtual: true,
                title: t('frame'), icon: FRAME_ICON, tile: '', color: '#3a3a3c' }];
    },
    launch: function (app) {
      if (app.key !== FRAME_KEY) return false;
      closeAll(); frameBack = ''; startFrame();
      return true;
    },
    lookPictures: function () { return [{ label: t('frame'), chevron: true, action: openFrameSettings }]; },
    remoteActions: function () { return [{ id: APP_ID, params: { frame: true }, title: t('frame') }]; },
    pictureFolderDeleted: function (id) { if (frameCfg().show === id) frameCfg().show = 'all'; },
    // While the frame runs, every key is its own: CH+/CH- and the arrows
    // control it, anything else ends it (OK too, without reaching the tile
    // behind). 1536/1537: the Magic Remote's pointer appearing or hiding,
    // which webOS also sends when another window takes and gives back the
    // focus: not a key.
    keydown: function (e, v) {
      if (!frameView || v !== frameView) return false;
      if (e.keyCode === 1536 || e.keyCode === 1537 || !e.keyCode) return true;
      if (!frameView.control(e.keyCode)) frameView.end('key ' + e.keyCode);
      return true;
    },
    // A frame launch while the frame runs (framesaver.py after closing LG's
    // screensaver over it): keep it, don't let the hidden timer end it.
    relaunch: function (p) {
      if (!p.frame) return false;
      clearTimeout(hiddenTimer);
      if (!frameView) { closeAll(); frameBack = p.back || ''; startFrame(); }
      return true;
    },
    visibility: function (shown) {
      clearTimeout(hiddenTimer);
      if (shown || !frameView) return;
      hiddenTimer = setTimeout(function () {
        if (!document.hidden || !frameView) return;
        exec('echo "$(date +%T) frame ended: still hidden after 5 s" >> /tmp/atvhome-events.log');
        closeAll();
      }, 5000);
    },
    start: function (p) {
      exec(SAVER_START);
      if (p.frame) setTimeout(function () { frameBack = p.back || ''; startFrame(); }, 300);
    },
    // framesaver.py reads the switch from the config itself.
    toggled: function (on) { if (on) exec(SAVER_START); }
  });
})();
