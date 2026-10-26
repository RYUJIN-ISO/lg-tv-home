// Usage: node cache.js <launchpoints.json> [<listApps.json>]
// The web runtime won't load images from outside this app's folder, so:
//  - copy each launch point's icon into cache/ and set `_icon` to the copy,
//  - copy user wallpapers from the data dir into cache/,
//  - read the launcher config from the data dir.
//  - list the visible installed apps (with cached icons and whether they
//    can be uninstalled), for adding apps LG never put on its home.
//  - tile-art overrides: tiles/<appId>.png|jpg in this app or in the data dir
//    (sharp 640x384 artwork replacing a low-res icon) -> `_tile`.
// Prints {launchPoints, installed, wallpapers, config} as JSON.
var fs = require('fs');
var path = require('path');

var CACHE = path.join(__dirname, 'cache');
var BUNDLED_WP = path.join(__dirname, 'wallpapers');
var DATA = '/var/lib/webosbrew/atvhome';
var IMAGE = /\.(jpe?g|png|webp)$/i;

var data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
var keep = {};

try { fs.mkdirSync(CACHE); } catch (e) {}

function copy(src, dst) {
  var s = fs.statSync(src);
  var d = null;
  try { d = fs.statSync(dst); } catch (e) {}
  if (!d || d.size !== s.size || d.mtime < s.mtime) fs.writeFileSync(dst, fs.readFileSync(src));
  keep[path.basename(dst)] = true;
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

(data.launchPoints || []).forEach(function (lp) {
  lp._tile = tiles[lp.id] || '';
  var key = (lp.launchPointId || lp.id).replace(/[^A-Za-z0-9._-]/g, '_');
  lp._icon = cached(lp.extraLargeIcon || lp.largeIcon || lp.icon, key + '.icon');
});

var installed = [];
try {
  JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).apps.forEach(function (a) {
    if (!a.visible) return;
    var dir = a.folderPath || '';
    var icon = a.extraLargeIcon || a.largeIcon || a.icon || '';
    if (icon && icon.charAt(0) !== '/' && !/^[a-z]+:/i.test(icon)) icon = path.join(dir, icon);
    installed.push({
      id: a.id, title: a.title || a.id, iconColor: a.iconColor || '', bgColor: a.bgColor || '',
      removable: !!a.removable && !a.systemApp,
      dev: dir.indexOf('/media/developer/') === 0,
      _icon: cached(icon, a.id.replace(/[^A-Za-z0-9._-]/g, '_') + '.app'),
      _tile: tiles[a.id] || ''
    });
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
var wallpapers = list(BUNDLED_WP).map(function (f) {
  return { name: f, url: 'wallpapers/' + f, bundled: true };
});
list(path.join(DATA, 'wallpapers')).forEach(function (f) {
  try {
    var src = path.join(DATA, 'wallpapers', f);
    wallpapers.push({ name: f, url: copy(src, path.join(CACHE, 'wp-' + f)) + ver(src),
                      orig: originals[f.replace(/\.[a-z]+$/i, '')] || '', thumb: thumbs[f] || '' });
  } catch (e) {}
});

var config = null;
try { config = JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8')); } catch (e) {}

// Drop copies of apps / wallpapers that are gone.
fs.readdirSync(CACHE).forEach(function (f) {
  if (!keep[f]) try { fs.unlinkSync(path.join(CACHE, f)); } catch (e) {}
});

process.stdout.write(JSON.stringify({
  launchPoints: data.launchPoints || [], installed: installed, wallpapers: wallpapers, config: config
}));
