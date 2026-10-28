// Picture frame decoder (Web Worker). Decodes a picture once and sends it
// back as RGB strips, so the main thread only copies finished pixels to the
// GPU and the motion on screen never waits for decoding.
//   in:  {id, blob, maxTex, rows, W, H, cw} (screen size, crop width: see texScale in app.js)
//   out: {id, type: 'size', w, h} | {id, type: 'strip', y, h, data} |
//        {id, type: 'done'} | {id, type: 'fail'}
// Same as texScale in app.js: no more pixels than the screen can show.
function texScale(nw, nh, W, H, cw, maxTex) {
  var need = Math.max(W / nw, H / nh);
  if (cw) need = Math.max(need, W / (cw * nw));
  return Math.min(1, maxTex / Math.max(nw, nh), need);
}

self.onmessage = function (e) {
  var d = e.data;
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') {
    self.postMessage({ id: d.id, type: 'fail' });
    return;
  }
  createImageBitmap(d.blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'none' })
    .then(function (bm) {
      var nw = bm.width, nh = bm.height, s = texScale(nw, nh, d.W, d.H, d.cw, d.maxTex);
      var w = Math.floor(nw * s), h = Math.floor(nh * s);
      self.postMessage({ id: d.id, type: 'size', w: w, h: h });
      var c = new OffscreenCanvas(w, d.rows);
      var ctx = c.getContext('2d', { willReadFrequently: true });
      for (var y = 0; y < h; y += d.rows) {
        var hh = Math.min(d.rows, h - y);
        ctx.clearRect(0, 0, w, d.rows);
        ctx.drawImage(bm, 0, y / s, nw, hh / s, 0, 0, w, hh);
        var px = ctx.getImageData(0, 0, w, hh).data, rgb = new Uint8Array(w * hh * 3);
        for (var i = 0, j = 0; i < px.length; i += 4) {
          rgb[j++] = px[i]; rgb[j++] = px[i + 1]; rgb[j++] = px[i + 2];
        }
        self.postMessage({ id: d.id, type: 'strip', y: y, h: hh, data: rgb.buffer }, [rgb.buffer]);
      }
      bm.close();
      self.postMessage({ id: d.id, type: 'done' });
    }, function () { self.postMessage({ id: d.id, type: 'fail' }); });
};
