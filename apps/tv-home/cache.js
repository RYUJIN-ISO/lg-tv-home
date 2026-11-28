// Usage: node cache.js <launchpoints.json> [<listApps.json>]
// The web runtime won't load images from outside this app's folder, so:
//  - copy each launch point's icon into cache/ and set `_icon` to the copy,
//  - copy user wallpapers from the data dir into cache/,
//  - read the launcher config from the data dir.
//  - list the visible installed apps (with cached icons and whether they
//    can be uninstalled), for adding apps LG never put on its home.
//  - tile-art overrides: tiles/<appId>.png|jpg in this app or in the data dir
//    (sharp 640x384 artwork replacing a low-res icon) -> `_tile`.
//  - sharp logos: LG's icons are at most 192 px, but most apps' splash
//    screens show the logo large. The page cuts it out once (splashLogo in
//    app.js) and autotile.py saves it as autotiles/<app>.<sig>.png in the data dir
//    (<sig>: the splash's size and time, so a new splash is cut again; .none
//    when there was no logo to find). Here: `_logo` when it exists, else the
//    splash as `_splash` with `_sig` for the page to work on.
// Prints {launchPoints, installed, wallpapers, config, glass, versions} as JSON.
var fs = require('fs');
var path = require('path');

var CACHE = path.join(__dirname, 'cache');
var BUNDLED_WP = path.join(__dirname, 'wallpapers');
var DATA = '/var/lib/webosbrew/atvhome';
var IMAGE = /\.(jpe?g|png|webp)$/i;

var data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
var keep = {};
var versions = {};   // copied file -> its source's size and time (keys the saved Glass logos)

try { fs.mkdirSync(CACHE); } catch (e) {}

function copy(src, dst) {
  var s = fs.statSync(src);
  var d = null;
  try { d = fs.statSync(dst); } catch (e) {}
  if (!d || d.size !== s.size || d.mtime < s.mtime) fs.writeFileSync(dst, fs.readFileSync(src));
  keep[path.basename(dst)] = true;
  versions['cache/' + path.basename(dst)] = s.size + '-' + Math.floor(s.mtime.getTime() / 1000);
  return 'cache/' + path.basename(dst);
}

function cached(src, name) {
  if (!src || /^[a-z]+:/i.test(src)) return src || '';
  try {
    return copy(src, path.join(CACHE, name + path.extname(src).toLowerCase()));
  } catch (e) {
    return '';
  }
}

function list(dir) {
  try { return fs.readdirSync(dir).filter(function (f) { return IMAGE.test(f); }).sort(); } catch (e) { return []; }
}

// Tile art: data dir wins over the bundled set.
var tiles = {};
list(path.join(__dirname, 'tiles')).forEach(function (f) {
  tiles[f.replace(/\.[a-z]+$/i, '')] = 'tiles/' + f;
});
list(path.join(DATA, 'tiles')).forEach(function (f) {
  try { tiles[f.replace(/\.[a-z]+$/i, '')] = copy(path.join(DATA, 'tiles', f), path.join(CACHE, 'tile-' + f)); } catch (e) {}
});

var appList = [];
try { appList = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).apps || []; } catch (e) {}

var AUTO = path.join(DATA, 'autotiles');
var logos = {};
appList.forEach(function (a) {
  if (!a.splashBackground || tiles[a.id]) return;
  var src = a.splashBackground;
  if (src.charAt(0) !== '/') src = path.join(a.folderPath || '', src);
  var st;
  try { st = fs.statSync(src); } catch (e) { return; }
  var base = a.id.replace(/[^A-Za-z0-9._-]/g, '_'), sig = st.size + '-' + Math.floor(st.mtime.getTime() / 1000);
  var done = path.join(AUTO, base + '.' + sig);
  try {
    var made = 0;
    try { made = fs.statSync(done + '.png').size; } catch (e) {}
    if (made > 0) logos[a.id] = { _logo: copy(done + '.png', path.join(CACHE, 'logo-' + base + '.png')) };
    else if (!fs.existsSync(done + '.none')) logos[a.id] = { _splash: cached(src, 'splash-' + base), _sig: sig };
  } catch (e) {}
});
function withLogo(o, id) {
  var l = logos[id] || {};
  o._logo = l._logo || ''; o._splash = l._splash || ''; o._sig = l._sig || '';
  return o;
}

(data.launchPoints || []).forEach(function (lp) {
  lp._tile = tiles[lp.id] || '';
  withLogo(lp, lp.id);
  var key = (lp.launchPointId || lp.id).replace(/[^A-Za-z0-9._-]/g, '_');
  lp._icon = cached(lp.extraLargeIcon || lp.largeIcon || lp.icon, key + '.icon');
});

var installed = [];
try {
  appList.forEach(function (a) {
    if (!a.visible) return;
    var dir = a.folderPath || '';
    var icon = a.extraLargeIcon || a.largeIcon || a.icon || '';
    if (icon && icon.charAt(0) !== '/' && !/^[a-z]+:/i.test(icon)) icon = path.join(dir, icon);
    installed.push(withLogo({
      id: a.id, title: a.title || a.id, iconColor: a.iconColor || '', bgColor: a.bgColor || '',
      removable: !!a.removable && !a.systemApp,
      dev: dir.indexOf('/media/developer/') === 0,
      _icon: cached(icon, a.id.replace(/[^A-Za-z0-9._-]/g, '_') + '.app'),
      _tile: tiles[a.id] || ''
    }, a.id));
  });
} catch (e) {}

// Wallpapers: bundled + user ones. `orig` = full-size original kept for
// re-cropping (data dir wallpapers/originals/<same base name>.*). URLs carry
// ?v=<mtime> so a re-cropped file isn't shown from the web view's cache.
function ver(p) { try { return '?v=' + Math.floor(fs.statSync(p).mtime.getTime() / 1000); } catch (e) { return ''; } }
var ORIG = path.join(DATA, 'wallpapers', 'originals');
var originals = {};
list(ORIG).forEach(function (f) {
  try { originals[f.replace(/\.[a-z]+$/i, '')] = copy(path.join(ORIG, f), path.join(CACHE, 'orig-' + f)) + ver(path.join(ORIG, f)); } catch (e) {}
});
// Small previews for the pickers (wallpapers/thumbs/<same name>), so a grid
// of cards doesn't decode every full-size picture.
var THUMBS = path.join(DATA, 'wallpapers', 'thumbs');
var thumbs = {};
list(THUMBS).forEach(function (f) {
  try { thumbs[f] = copy(path.join(THUMBS, f), path.join(CACHE, 'th-' + f)) + ver(path.join(THUMBS, f)); } catch (e) {}
});
// Dates for sorting the library (All Pictures, ⇅): added = when it came to
// the TV, taken = when the photo was taken (0: unknown). Kept in
// wallpapers/meta.json, so turning or cutting a picture (a new file) keeps
// them; taken.json holds the dates the phone read before it scaled a picture
// (phone.py), which lose their EXIF on the way.
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
    var d = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)$/.exec(s);
    return d && +d[1] > 1900 ? Date.UTC(+d[1], d[2] - 1, +d[3], +d[4], +d[5], +d[6]) : 0;
  }
  var ifd0 = tags(u32(4)), ex = ifd0[0x8769] ? tags(ifd0[0x8769]) : {};
  return date(ex[0x9003]) || date(ex[0x9004]) || date(ifd0[0x0132]);
}
// A date in a file name (20230222_212654, IMG-20230222-WA0001, 2023-02-22 …), or 0.
function nameDate(n) {
  var d = /(?:^|[^0-9])((?:19|20)\d\d)[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?:[-_ T.]?([01]\d|2[0-3])[-_.]?([0-5]\d)[-_.]?([0-5]\d))?/.exec(n);
  return d ? Date.UTC(+d[1], d[2] - 1, +d[3], +(d[4] || 0), +(d[5] || 0), +(d[6] || 0)) : 0;
}

var META = path.join(DATA, 'wallpapers', 'meta.json'), meta = {}, taken = {}, metaOut = {}, metaChanged = false;
try { meta = JSON.parse(fs.readFileSync(META, 'utf8')); } catch (e) {}
try { taken = JSON.parse(fs.readFileSync(path.join(DATA, 'wallpapers', 'taken.json'), 'utf8')); } catch (e) {}
function dates(src, f) {
  var m = meta[f];
  if (!m) {
    var b = Buffer.alloc(131072), fd = fs.openSync(src, 'r');
    try { b = b.slice(0, fs.readSync(fd, b, 0, b.length, 0)); } finally { fs.closeSync(fd); }
    m = { a: fs.statSync(src).mtime.getTime(), t: exifDate(b) || nameDate(f) };
    metaChanged = true;
  }
  metaOut[f] = m;
  return { added: m.a, taken: taken[f] || m.t };
}

var wallpapers = list(BUNDLED_WP).map(function (f) {
  return { name: f, url: 'wallpapers/' + f, bundled: true, added: 0, taken: 0 };
});
list(path.join(DATA, 'wallpapers')).forEach(function (f) {
  try {
    var src = path.join(DATA, 'wallpapers', f), d = { added: 0, taken: 0 };
    try { d = dates(src, f); } catch (e) {}
    wallpapers.push({ name: f, url: copy(src, path.join(CACHE, 'wp-' + f)) + ver(src),
                      orig: originals[f.replace(/\.[a-z]+$/i, '')] || '', thumb: thumbs[f] || '',
                      added: d.added, taken: d.taken });
  } catch (e) {}
});
if (metaChanged || Object.keys(meta).length !== Object.keys(metaOut).length) {
  try { fs.writeFileSync(META + '.tmp', JSON.stringify(metaOut)); fs.renameSync(META + '.tmp', META); } catch (e) {}
}

var config = null;
try { config = JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8')); } catch (e) {}

// Glass logos made before (logoInto in app.js, saved by autotile.py glass):
// glass/<key>.<b|n>.png, b = the icon fills the card height.
var glass = {};
list(path.join(DATA, 'glass')).forEach(function (f) {
  var m = /^([0-9a-f]+)\.([bn])\.png$/.exec(f);
  if (!m) return;
  try { glass[m[1]] = { url: copy(path.join(DATA, 'glass', f), path.join(CACHE, 'glass-' + f)), bleed: m[2] === 'b' }; } catch (e) {}
});

// Drop copies of apps / wallpapers that are gone.
fs.readdirSync(CACHE).forEach(function (f) {
  if (!keep[f]) try { fs.unlinkSync(path.join(CACHE, f)); } catch (e) {}
});

process.stdout.write(JSON.stringify({
  launchPoints: data.launchPoints || [], installed: installed, wallpapers: wallpapers, config: config,
  glass: glass, versions: versions
}));
