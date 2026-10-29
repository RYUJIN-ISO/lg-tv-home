// TV Home: an Apple TV style home screen for rooted LG webOS TVs
// (com.iso.atvhome, the TV's default "home" app).
//
// Data comes from launchpoints.sh, run as root through Homebrew Channel's
// exec service: LG's launch points (order, icons, HDMI device names), the
// installed apps, the wallpapers and the saved config. The config lives in
// /var/lib/webosbrew/atvhome/config.json (written by config.sh), so it
// survives reinstalls; localStorage only caches it for a fast first paint.
//
// Remote: arrows, OK, Back. Hold OK on a tile for its options. Up from the
// first row reaches the top-left buttons: Settings, Organize Apps (edit mode)
// and the ones modules add (Light, AV receiver). The Magic Remote works too: hover, click, click and hold, wheel.

var APP_ID = 'com.iso.atvhome';
var APP_DIR = '/media/developer/apps/usr/palm/applications/' + APP_ID + '/';
var VERSION = '0.32.6';
var COLS = 5;
// Home rows: the card plus the gap from Settings > Row spacing (and room for
// the app name under the focused card when App names is on); set by applyGrid().
// Pickers always show names and keep PICK_ROW_H (= --row-h in index.html).
var TILE_H = 192;               // = --tile-h in index.html
var PICK_ROW_H = 300;
var ROW_GAPS = { compact: 32, even: 44, roomy: 72, wide: 108 };   // even = the gap between columns
var ROW_GAP_ORDER = ['compact', 'even', 'roomy', 'wide'];
var NAME_GAP = 84;
// Settings > Focus bar colours (Apple's system colours).
var BAR_COLORS = { white: '#ffffff', blue: '#0a84ff', green: '#30d158', yellow: '#ffd60a', orange: '#ff9f0a',
                   red: '#ff453a', pink: '#ff375f', purple: '#bf5af2' };
var BAR_ORDER = ['white', 'blue', 'green', 'yellow', 'orange', 'red', 'pink', 'purple'];              // the name (26 + 8 + 31 px) and some air above the next row
var ROW_H = TILE_H + ROW_GAPS.even;
var GRID_TOP = 640;
var LONG_PRESS_MS = 600;
var CACHE_KEY = 'atvhome.state';
var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461 };
var NEVER_SHOW = [APP_ID, 'com.webos.app.home'];
var DEFAULT_CONFIG = {
  version: 1,
  language: 'en',
  wallpaper: 'default.jpg',
  clock: true,
  modules: {},    // Settings > Features: module id -> false while switched off
  cards: 'glass', // Settings > Look > App cards: 'glass' (dark glass, the default) or 'color' (brand colour)
  order: [],      // top-level keys: app keys and folder ids, in display order
  folders: {},    // id -> { name, items: [app keys] }
  hidden: [],     // keys of LG launch points taken off the home screen
  added: [],      // keys of installed apps without a launch point, put on it
  names: false,      // app name under the focused card on the home screen and in folders
  rowGap: 'even',    // Settings > Row spacing: a key of ROW_GAPS
  bar: { on: true, color: 'white', bri: 80 },   // Settings > Focus bar (under the focused card while names are off)
  crops: {},           // picture name -> 16:9 crop {x, y, w, r} (see library())
  pictureFolders: [],  // [{id, name, items: [picture names]}]
  favourites: []       // picture names; the built-in Favourites folder (id 'fav')
};
// Modules add their own defaults (addModule).
// Never offered for uninstall: losing these loses root / the launcher itself.
var PROTECTED = /^(com\.iso\.|org\.webosbrew\.)/;

var state = { launchPoints: [], installed: [], wallpapers: [], config: null, glass: {}, versions: {} };
var editMode = false;
var topFocus = -1;      // focused top-left button, -1 = focus is in the grid
var apps = {};          // key -> app item
var appOrder = [];      // keys in LG's order
var stack = [];         // open overlay views, top = last
var mainGrid;
var bridges = [];

// ---------------------------------------------------------------- services

function luna(uri, params, cb) {
  var b = new PalmServiceBridge();
  bridges.push(b);
  b.onservicecallback = function (raw) {
    bridges.splice(bridges.indexOf(b), 1);
    var res;
    try { res = JSON.parse(raw); } catch (e) { res = { returnValue: false, errorText: raw }; }
    if (cb) cb(res);
  };
  b.call(uri, JSON.stringify(params));
}

function exec(command, cb) {
  luna('luna://org.webosbrew.hbchannel.service/exec', { command: command }, cb);
}

function launch(app) {
  if (claim('launch', app)) return;
  luna('luna://com.webos.applicationManager/launch', { id: app.id, params: app.params }, function (res) {
    if (res.returnValue === false) {
      exec("luna-send -n 1 luna://com.webos.applicationManager/launch '" +
        JSON.stringify({ id: app.id, params: app.params }).replace(/'/g, "'\\''") + "'");
    }
  });
}

// ---------------------------------------------------------------- config

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function cfg() { return state.config; }

// While a save is pending or in flight, a reload must not adopt the (older)
// config from disk. The local copy is written with the disk save too, not on
// every step: serialising the whole state per Left/Right press is slow.
var saveTimer = null, savesInFlight = 0;
function saveConfig() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushConfig, 400);
}

function flushConfig() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  persistLocal();
  var json = JSON.stringify(state.config);
  var b64 = btoa(unescape(encodeURIComponent(json)));
  savesInFlight++;
  exec('sh ' + APP_DIR + 'config.sh save ' + b64, function () { savesInFlight--; });
}

// The Magic Remote can deliver a click and an OK key for the same press;
// one press must only act once.
var lastAction = 0;
function once() {
  var now = Date.now();
  if (now - lastAction < 400) return false;
  lastAction = now;
  return true;
}

function persistLocal() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); } catch (e) {}
}

// Keys the defaults don't know stay: they belong to a module that is not
// installed right now and get used again once it is.
function normalizeConfig(c) {
  var out = clone(DEFAULT_CONFIG);
  if (c && typeof c === 'object') {
    for (var k in c) if (c[k] !== undefined) out[k] = c[k];
  }
  return out;
}

// ---------------------------------------------------------------- modules

// The features beyond the home screen itself (Picture Frame, Plex, Hue,
// Remote Buttons, AV receiver, App Store) are modules: modules/<id>/<id>.js
// (+ .css), bundled into modules.js by install.sh with only the ones chosen
// there. A module calls addModule({...}) with its texts, defaults and hooks;
// the core calls those hooks at fixed points (see modules/README.md). A
// module that is installed can still be switched off in Settings > Features:
// then none of its hooks run.
var MODULES = [];

function addModule(m) {
  MODULES.push(m);
  ['en', 'de'].forEach(function (l) {
    var s = m.strings && (m.strings[l] || m.strings.en);
    for (var k in s) STRINGS[l][k] = s[k];
  });
  for (var i in m.info) INFO[i] = m.info[i];
  for (var d in m.defaults) DEFAULT_CONFIG[d] = clone(m.defaults[d]);
}

// A module can keep its on/off itself (isOn / setOn: the AV receiver button
// has always been a setting); otherwise config.modules says.
function moduleOn(m) {
  if (m.available && !m.available()) return false;
  if (m.isOn) return !!state.config && m.isOn();
  return !(state.config && (state.config.modules || {})[m.id] === false);
}

// Calls hook `name` of every module that is on; returns their results
// (arrays are joined, undefined dropped).
function hook(name) {
  var args = [].slice.call(arguments, 1), out = [];
  MODULES.forEach(function (m) {
    if (typeof m[name] !== 'function' || !moduleOn(m)) return;
    var r = m[name].apply(m, args);
    if (r !== undefined) out = out.concat(r);
  });
  return out;
}

// The first module whose hook returns true has handled it.
function claim(name) {
  var args = [].slice.call(arguments, 1);
  for (var i = 0; i < MODULES.length; i++) {
    var m = MODULES[i];
    if (typeof m[name] === 'function' && moduleOn(m) && m[name].apply(m, args) === true) return true;
  }
  return false;
}

// ---------------------------------------------------------------- i18n

// English is the default; German is selectable in the settings.
var STRINGS = {
  en: {
    settings: 'Settings', settingsTitle: 'Home Screen', language: 'Language',
    wallpaper: 'Wallpaper',
    none: 'None',
    newFolder: 'New Folder',
    editHome: 'Organize Apps', addApps: 'Add Apps', homeAppsTitle: 'Apps on the home screen', editHint: '{ok} options · {back} done',
    removeFromHome: 'Remove from Home Screen',
    uninstall: 'Uninstall', uninstallApps: 'Uninstall Apps', uninstallSub: 'Apps that can be removed from the TV.',
    uninstallQ: 'Uninstall {0}?', uninstallNQ: 'Uninstall {0} apps?', uninstallYes: 'Uninstall',
    uninstallWarn: 'The app and its data are removed. To reinstall it, unlock App-Updates and use the LG Content Store.',
    uninstalling: 'Uninstalling {0} …', uninstalled: '{0} was uninstalled.', uninstallFailed: 'Could not uninstall {0}.',
    noUninstall: 'No apps can be uninstalled.',
    showClock: 'Show Clock', on: 'On', off: 'Off',
    features: 'Features', featuresSub: 'Switched off, a feature is hidden and does nothing. To remove one from the TV, run install.sh again.',
    cards: 'App cards', cardsColor: 'Colour', cardsGlass: 'Glass',
    rowSpacing: 'Row spacing',
    gapCompact: 'Compact', gapEven: 'Even', gapRoomy: 'Roomy', gapWide: 'Wide',
    look: 'Look', selectedApp: 'Selected app', selBar: 'Bar', selName: 'Name', selNone: 'Nothing',
    barColor: 'Bar colour', barBri: 'Bar brightness',
    col_white: 'White', col_blue: 'Blue', col_green: 'Green', col_yellow: 'Yellow', col_orange: 'Orange',
    col_red: 'Red', col_pink: 'Pink', col_purple: 'Purple',
    reset: 'Reset Layout', resetQ: 'Reset layout?',
    resetSub: 'Folders, order and the app selection are reset. The wallpaper stays.', resetYes: 'Reset',
    tip: 'Organize Apps (top left): arrange, group, uninstall',
    move: 'Move', rename: 'Rename', open: 'Open', cancel: 'Cancel',
    toFolder: 'Add to Folder', toOtherFolder: 'Move to Another Folder', removeFromFolder: 'Remove from Folder',
    chooseApps: 'Choose Apps', checkHint: '{ok} check / uncheck',
    dissolve: 'Remove Folder', dissolveQ: 'Remove folder?', dissolveSub: 'Its apps go back to the home screen.', dissolveYes: 'Remove',
    renameFolder: 'Rename Folder', nApps: '{0} apps', emptySuffix: '(empty)',
    folderEmpty: 'This folder is empty. Hold OK on an app and choose "Add to Folder".',
    inputHint: 'Enter a name, then OK / Enter. Back cancels.',
    moveHint: '{arrows} move · {ok} drop',
    loadFailed: 'Could not load apps. Press OK to retry.',
    fromUsb: 'From USB …', usbLoading: 'Looking for pictures on USB …', usbNone: 'No pictures (JPG/PNG) found on a USB stick.',
    cropHint: 'Picture {0} · best: 3840×2160 (16:9)', cropKeysFrame: '{arrows} move · {ok} save · {back} cancel',
    cropKeysBar: '{up} crop · {back} close', save: 'Save', saving: 'Saving wallpaper …', saveFailed: 'Could not save the wallpaper.',
    libHint: '{ok} open · {hold} options', wpUseHint: '{ok} wallpaper · {hold} ★, crop, folders',
    usbHint: '{ok} crop and add',
    crop: 'Crop', cropSet: 'Set', inFolders: 'In folders', noFolders: 'No folders yet',
    allPictures: 'All pictures', selection: 'Selection', choosePictures: 'Choose Pictures',
    deleteFolder: 'Delete Folder', deleteFolderQ: 'Delete folder?', deleteFolderSub: 'The pictures stay.',
    wholePicture: 'Reset', upscaled: 'Upscaled {0}%',
    framePickHint: '{ok} in / out · {hold} crop',
    brightness: 'Brightness',
    favourites: 'Favourites', favourite: 'Favourite', cutQ: 'Crop permanently?', cutSub: 'Everything outside the frame is deleted from the TV. This can\'t be undone.', cutYes: 'Crop Permanently', cutting: 'Cropping the picture …', deletePicture: 'Delete Picture', deletePictureQ: 'Delete picture?', deletePictureSub: 'It is removed from the TV and from all folders. This can\'t be undone.', deleteYes: 'Delete', deleteFailed: 'Could not delete the picture.'
  },
  de: {
    settings: 'Einstellungen', settingsTitle: 'Startbildschirm', language: 'Sprache',
    wallpaper: 'Hintergrundbild',
    none: 'Keines',
    newFolder: 'Neuer Ordner',
    editHome: 'Apps organisieren', addApps: 'Apps hinzufügen', homeAppsTitle: 'Apps auf dem Startbildschirm', editHint: '{ok} Optionen · {back} fertig',
    removeFromHome: 'Vom Startbildschirm entfernen',
    uninstall: 'Deinstallieren', uninstallApps: 'Apps deinstallieren', uninstallSub: 'Apps, die vom Fernseher entfernt werden können.',
    uninstallQ: '{0} deinstallieren?', uninstallNQ: '{0} Apps deinstallieren?', uninstallYes: 'Deinstallieren',
    uninstallWarn: 'Die App und ihre Daten werden entfernt. Zum Neu-Installieren App-Updates entsperren und den LG Content Store nutzen.',
    uninstalling: '{0} wird deinstalliert …', uninstalled: '{0} wurde deinstalliert.', uninstallFailed: '{0} konnte nicht deinstalliert werden.',
    noUninstall: 'Keine Apps können deinstalliert werden.',
    showClock: 'Uhr anzeigen', on: 'An', off: 'Aus',
    features: 'Funktionen', featuresSub: 'Ausgeschaltet ist eine Funktion versteckt und tut nichts. Um eine vom Fernseher zu entfernen, install.sh nochmal ausführen.',
    cards: 'App-Karten', cardsColor: 'Farbe', cardsGlass: 'Glas',
    rowSpacing: 'Reihenabstand',
    gapCompact: 'Eng', gapEven: 'Gleichmäßig', gapRoomy: 'Luftig', gapWide: 'Weit',
    look: 'Aussehen', selectedApp: 'Ausgewählte App', selBar: 'Balken', selName: 'Name', selNone: 'Nichts',
    barColor: 'Balkenfarbe', barBri: 'Balkenhelligkeit',
    col_white: 'Weiß', col_blue: 'Blau', col_green: 'Grün', col_yellow: 'Gelb', col_orange: 'Orange',
    col_red: 'Rot', col_pink: 'Pink', col_purple: 'Lila',
    reset: 'Anordnung zurücksetzen', resetQ: 'Anordnung zurücksetzen?',
    resetSub: 'Ordner, Reihenfolge und App-Auswahl werden zurückgesetzt. Das Hintergrundbild bleibt.', resetYes: 'Zurücksetzen',
    tip: 'Apps organisieren (oben links): anordnen, gruppieren, deinstallieren',
    move: 'Verschieben', rename: 'Umbenennen', open: 'Öffnen', cancel: 'Abbrechen',
    toFolder: 'In Ordner legen', toOtherFolder: 'In anderen Ordner legen', removeFromFolder: 'Aus Ordner nehmen',
    chooseApps: 'Apps auswählen', checkHint: '{ok} an / ab',
    dissolve: 'Ordner auflösen', dissolveQ: 'Ordner auflösen?', dissolveSub: 'Die Apps kommen zurück auf den Startbildschirm.', dissolveYes: 'Auflösen',
    renameFolder: 'Ordner umbenennen', nApps: '{0} Apps', emptySuffix: '(leer)',
    folderEmpty: 'Dieser Ordner ist leer. Lange OK auf einer App drücken → „In Ordner legen“.',
    inputHint: 'Namen eingeben, dann OK / Enter. Zurück bricht ab.',
    moveHint: '{arrows} verschieben · {ok} ablegen',
    loadFailed: 'Apps konnten nicht geladen werden. OK drücken zum Wiederholen.',
    fromUsb: 'Von USB …', usbLoading: 'Suche Bilder auf USB …', usbNone: 'Keine Bilder (JPG/PNG) auf einem USB-Stick gefunden.',
    cropHint: 'Bild {0} · ideal: 3840×2160 (16:9)', cropKeysFrame: '{arrows} verschieben · {ok} speichern · {back} abbrechen',
    cropKeysBar: '{up} zuschneiden · {back} schließen', save: 'Speichern', saving: 'Hintergrund wird gespeichert …', saveFailed: 'Hintergrund konnte nicht gespeichert werden.',
    libHint: '{ok} öffnen · {hold} Optionen', wpUseHint: '{ok} Hintergrund · {hold} ★, Ausschnitt, Ordner',
    usbHint: '{ok} zuschneiden und hinzufügen',
    crop: 'Ausschnitt', cropSet: 'Gesetzt', inFolders: 'In Ordnern', noFolders: 'Noch keine Ordner',
    allPictures: 'Alle Bilder', selection: 'Auswahl', choosePictures: 'Bilder auswählen',
    deleteFolder: 'Ordner löschen', deleteFolderQ: 'Ordner löschen?', deleteFolderSub: 'Die Bilder bleiben.',
    wholePicture: 'Zurücksetzen', upscaled: 'Hochskaliert {0} %',
    framePickHint: '{ok} rein / raus · {hold} Ausschnitt',
    brightness: 'Helligkeit',
    favourites: 'Favoriten', favourite: 'Favorit', cutQ: 'Endgültig zuschneiden?', cutSub: 'Alles außerhalb des Rahmens wird vom Fernseher gelöscht. Das lässt sich nicht rückgängig machen.', cutYes: 'Endgültig zuschneiden', cutting: 'Bild wird zugeschnitten …', deletePicture: 'Bild löschen', deletePictureQ: 'Bild löschen?', deletePictureSub: 'Es wird vom Fernseher und aus allen Ordnern entfernt. Das lässt sich nicht rückgängig machen.', deleteYes: 'Löschen', deleteFailed: 'Das Bild konnte nicht gelöscht werden.'
  }
};
var LANG_NAMES = { en: 'English', de: 'Deutsch' };

function lang() {
  var l = state.config && state.config.language;
  return STRINGS[l] ? l : 'en';
}

function t(key, arg) {
  var s = STRINGS[lang()][key] || STRINGS.en[key] || key;
  return arg === undefined ? s : s.replace('{0}', arg);
}

function chooseLanguage() {
  menu({
    title: function () { return t('language'); },
    rows: function () {
      return Object.keys(LANG_NAMES).map(function (l) {
        return { label: LANG_NAMES[l], check: lang() === l, action: function () {
          cfg().language = l;
          document.documentElement.lang = l;
          saveConfig();
          refreshMain();
          // Re-render every open menu in the new language.
          stack.forEach(function (v) { if (v.refresh) v.refresh(); });
        } };
      });
    }
  });
}

// ---------------------------------------------------------------- model

// White/near-white brand colors make the icon float on a blank card; use a
// dark card for those instead.
function cardColor(lp) {
  var c = (lp.bgColor || lp.iconColor || '').trim();
  var m = /^#?([0-9a-f]{6})$/i.exec(c);
  if (!m) return '#2a2a2e';
  var n = parseInt(m[1], 16);
  var lum = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum > 0.85 ? '#1f1f22' : '#' + m[1];
}

// Apps = LG's launch points (on the home screen unless removed) plus installed
// apps LG has no launch point for (only shown once added).
function buildApps() {
  apps = {};
  appOrder = [];
  var inst = {};
  state.installed.forEach(function (a) { inst[a.id] = a; });
  function uninstallInfo(app) {
    var a = inst[app.id];
    app.removable = !!(a && a.removable && !PROTECTED.test(app.id));
    app.dev = !!(a && a.dev);
    return app;
  }
  var lpIds = {};
  state.launchPoints.forEach(function (lp) {
    lpIds[lp.id] = true;
    if (NEVER_SHOW.indexOf(lp.id) >= 0) return;
    var key = lp.launchPointId || lp.id;
    // Launch points LG has hidden (e.g. the Homebrew apps) are treated like
    // installed apps without one: off the home screen until added.
    apps[key] = uninstallInfo({
      type: 'app', key: key, id: lp.id, params: lp.params || {}, lp: !lp.hidden,
      title: lp.title || lp.id, icon: lp._icon || '', tile: lp._tile || '', color: cardColor(lp),
      logo: lp._logo || '', splash: lp._splash || '', sig: lp._sig || ''
    });
    appOrder.push(key);
  });
  state.installed.filter(function (a) { return !lpIds[a.id] && NEVER_SHOW.indexOf(a.id) < 0; })
    .sort(function (a, b) { return a.title.localeCompare(b.title); })
    .forEach(function (a) {
      var key = a.id + '_default';
      if (apps[key]) return;
      apps[key] = uninstallInfo({
        type: 'app', key: key, id: a.id, params: {}, lp: false,
        title: a.title, icon: a._icon || '', tile: a._tile || '', color: cardColor(a),
        logo: a._logo || '', splash: a._splash || '', sig: a._sig || ''
      });
      appOrder.push(key);
    });
  // Cards modules put on the home screen (the Picture Frame): they move, go
  // into folders and off the home screen like any app. virtual: not a real
  // app (no remote button can open it as one).
  hook('apps').forEach(function (a) {
    apps[a.key] = a;
    appOrder.push(a.key);
  });
}

function folderOf(key) {
  var f = cfg().folders;
  for (var id in f) if (f[id].items.indexOf(key) >= 0) return id;
  return null;
}

function onHome(key) {
  var a = apps[key];
  if (!a) return false;
  return a.lp ? cfg().hidden.indexOf(key) < 0 : cfg().added.indexOf(key) >= 0;
}

// Taking an app off the home screen also takes it out of its folder.
function setOnHome(key, show) {
  var c = cfg(), a = apps[key];
  if (!a) return;
  function toggle(list, on) {
    var i = list.indexOf(key);
    if (on && i < 0) list.push(key);
    if (!on && i >= 0) list.splice(i, 1);
  }
  if (a.lp) toggle(c.hidden, !show); else toggle(c.added, show);
  if (!show) {
    var f = folderOf(key);
    if (f) c.folders[f].items.splice(c.folders[f].items.indexOf(key), 1);
    var i = c.order.indexOf(key);
    if (i >= 0) c.order.splice(i, 1);
  }
  saveConfig();
}

function folderItems(id) {
  return cfg().folders[id].items.filter(function (k) { return onHome(k); })
    .map(function (k) { return apps[k]; });
}

// Top-level entries in display order: saved order first, then new apps in
// LG's order, then the settings card.
function mainEntries() {
  var c = cfg();
  var out = [];
  var seen = {};
  function add(key) {
    if (seen[key]) return;
    if (c.folders[key]) {
      seen[key] = true;
      out.push({ type: 'folder', key: key, name: c.folders[key].name, items: folderItems(key) });
    } else if (onHome(key) && !folderOf(key)) {
      seen[key] = true;
      out.push(apps[key]);
    }
  }
  c.order.forEach(add);
  Object.keys(c.folders).forEach(add);
  appOrder.forEach(add);
  // Fixed cards at the end (move mode never swaps with these).
  if (editMode) {
    out.push({ type: 'special', key: '__add', icon: 'plus', title: t('addApps') });
    out.push({ type: 'special', key: '__newfolder', icon: 'folder', title: t('newFolder') });
    out.push({ type: 'special', key: '__uninstall', icon: 'trash', title: t('uninstallApps') });
    out.push({ type: 'special', key: '__reset', icon: 'reset', title: t('reset') });
  }
  return out;
}

function saveOrderFrom(entries) {
  cfg().order = entries.filter(function (e) { return e.type !== 'special'; })
    .map(function (e) { return e.key; });
  saveConfig();
}

// ---------------------------------------------------------------- tiles

// If an icon is an opaque square (most LG app icons are), paint its card in
// the icon's corner color and let it fill the tile height (full-bleed look).
var sampler = document.createElement('canvas');
sampler.width = sampler.height = 8;
function bleed(card, img) {
  try {
    var ctx = sampler.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, 8, 8);
    ctx.drawImage(img, 0, 0, 8, 8);
    var px = ctx.getImageData(0, 0, 8, 8).data;
    var corners = [0, 7, 56, 63].map(function (p) { return px.slice(p * 4, p * 4 + 4); });
    if (corners.some(function (c) { return c[3] < 240; })) return;
    var c = corners[0];
    card.style.setProperty('--c', 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')');
    card.classList.add('bleed');
  } catch (e) {}
}

// A sharp logo from the app's splash (see makeLogos) goes on the colour of
// the icon's background; without one, the icon itself.
function iconInto(el, app) {
  el.style.setProperty('--c', app.color);
  if (!app.icon && !app.logo) return;
  var img = document.createElement('img');
  img.alt = '';
  img.onerror = function () { img.style.display = 'none'; };
  el.insertBefore(img, el.firstChild);
  if (!app.logo) { logoInto(el, img, app.icon, app.color, true); return; }
  el.classList.add('haslogo');
  function draw(c) {
    if (c) el.style.setProperty('--c', c);
    if (glassOn()) logoInto(el, img, app.logo, c || app.color, false);
    else readableOn(img, app.logo, hexRgb(c || app.color));
  }
  if (iconColor(app.icon) !== undefined) { draw(iconColor(app.icon)); return; }
  var probe = new Image();
  probe.onload = function () { draw(rememberIconColor(app.icon, cornerColor(probe))); };
  probe.onerror = function () { draw(rememberIconColor(app.icon, null)); };
  track(probe).src = app.icon;
}
// icon -> its background colour; kept in localStorage, so a start needs no
// probe before the logo (a changed icon file has a new ?v= version key).
var ICON_COLORS_KEY = 'atvhome.iconColors';
var iconColors = {};
try { iconColors = JSON.parse(localStorage.getItem(ICON_COLORS_KEY) || '{}') || {}; } catch (e) {}
var iconColorsTimer = null;
function rememberIconColor(icon, c) {
  if (Object.keys(iconColors).length > 400) iconColors = {};   // old versions pile up otherwise
  iconColors[icon + '|' + (state.versions[icon] || '')] = c;
  clearTimeout(iconColorsTimer);
  iconColorsTimer = setTimeout(function () {
    try { localStorage.setItem(ICON_COLORS_KEY, JSON.stringify(iconColors)); } catch (e) {}
  }, 2000);
  return c;
}
function iconColor(icon) { return iconColors[icon + '|' + (state.versions[icon] || '')]; }

// Colour cards: a logo in about the card's own colour (arte's red splash
// logo on its red card) is drawn white instead, as the icon had it.
var onCard = {};
function readableOn(img, src, bg) {
  var key = src + '|' + bg;
  function use(cv) { onCard[key] = cv; if (cv) showCanvas(img, cv); else img.src = src; }
  if (onCard[key] !== undefined) { use(onCard[key]); return; }
  if (!bg) { img.src = src; return; }
  var probe = new Image();
  probe.onload = function () {
    var w = probe.naturalWidth, h = probe.naturalHeight, c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(probe, 0, 0);
    var d, n = 0, sum = [0, 0, 0];
    try { d = ctx.getImageData(0, 0, w, h); } catch (e) { use(null); return; }
    var px = d.data, i;
    for (i = 0; i < px.length; i += 4) if (px[i + 3] > 200) { n++; sum[0] += px[i]; sum[1] += px[i + 1]; sum[2] += px[i + 2]; }
    var near = n && Math.max(Math.abs(sum[0] / n - bg[0]), Math.abs(sum[1] / n - bg[1]), Math.abs(sum[2] / n - bg[2])) < 90;
    if (!near) { use(null); return; }
    for (i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = 255;
    ctx.putImageData(d, 0, 0);
    use(c);
  };
  probe.onerror = function () { img.src = src; };
  track(probe).src = src;
}

// The colour of an opaque icon's corners ('rgb(...)'), or null.
function cornerColor(img) {
  try {
    var ctx = sampler.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, 8, 8);
    ctx.drawImage(img, 0, 0, 8, 8);
    var c = ctx.getImageData(0, 0, 1, 1).data;
    return c[3] >= 240 ? 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')' : null;
  } catch (e) { return null; }
}

// Settings > Look > App cards: Glass. The card is dark glass (like the
// top-left buttons) and the logo stands on it: the icon's flat background
// colour is keyed out, and a white logo takes that colour (the brand's), so
// Prime Video's logo is blue on glass. Logos with their own colours keep
// them; dark brand colours keep a white logo. Done once per icon on a canvas
// (a few ms), then kept for the session; cards get a copy of that canvas
// (no PNG encoding: cheap to redraw, and the TV's encoder writes broken rows
// at times).
var glassLogos = {};
// Made once, then saved on the TV (autotile.py glass, raw pixels like the
// sharp logos) and handed over by cache.js as state.glass: later starts and
// boots show the PNG at once instead of keying every logo again (0.5 s of
// work on an idle TV, several seconds at boot). The key covers the picture
// (its file's size and time), the colour and GLASS_V; change GLASS_V when
// glassLogo() changes so all logos are made again.
var GLASS_V = 'g1';
var glassSaves = [], glassSaving = false;

function glassKey(src, color) {
  var str = src + '|' + (state.versions[src] || '') + '|' + color + '|' + GLASS_V, a = 0x811c9dc5, b = 0x01000193;
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x811c9dc5) >>> 0;
  }
  return ('0000000' + a.toString(16)).slice(-8) + ('0000000' + b.toString(16)).slice(-8);
}

// One at a time, and only once the first screen is shown.
function saveGlass(key, r) {
  if (!r.canvas || glassSaves.some(function (q) { return q.key === key; })) return;
  glassSaves.push({ key: key, r: r });
  nextGlassSave();
}

function nextGlassSave() {
  if (glassSaving || !glassSaves.length) return;
  if (!revealed) { setTimeout(nextGlassSave, 1000); return; }
  glassSaving = true;
  var q = glassSaves.shift(), cv = q.r.canvas, w = cv.width, h = cv.height;
  var name = q.key + (q.r.bleed ? '.b' : '.n') + '.png';
  var px = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data, bin = '';
  for (var i = 0; i < px.length; i += 8192) bin += String.fromCharCode.apply(null, px.subarray(i, i + 8192));
  var b64 = btoa(bin), CH = 100000, parts = [];   // one exec argument < 128 KiB
  for (i = 0; i < b64.length; i += CH) parts.push(b64.slice(i, i + CH));
  function done() { glassSaving = false; setTimeout(nextGlassSave, 300); }
  (function send(i) {
    if (i < parts.length) { exec(AUTOTILE + 'part ' + name + ' ' + parts[i], function () { send(i + 1); }); return; }
    exec(AUTOTILE + 'glass ' + name + ' ' + w + ' ' + h, done);
  })(0);
}

function glassOn() { return !!state.config && state.config.cards !== 'color'; }

// img shows src: as it is, or (Glass) as the keyed logo. withBleed: an icon
// (not full-card art), which fills the card height when it is a full square.
function logoInto(card, img, src, color, withBleed) {
  if (!glassOn()) {
    if (withBleed) img.onload = function () { bleed(card, img); };
    img.src = src;
    return;
  }
  function use(r) {
    if (withBleed && r.bleed) card.classList.add('bleed');
    if (r.canvas) showCanvas(img, r.canvas); else img.src = src;
  }
  if (glassLogos[src]) { use(glassLogos[src]); return; }
  var key = glassKey(src, color), saved = state.glass[key];
  if (saved) {
    if (withBleed && saved.bleed) card.classList.add('bleed');
    img.src = saved.url;
    return;
  }
  var probe = new Image();
  probe.onload = function () {
    var r = glassLogos[src] = glassLogo(probe, color);
    use(r);
    saveGlass(key, r);
  };
  probe.onerror = function () { img.src = src; };
  track(probe).src = src;
}

// Puts a copy of canvas src where img is (same place, same CSS as an img).
function showCanvas(img, src) {
  var cv = document.createElement('canvas');
  cv.width = src.width; cv.height = src.height;
  cv.getContext('2d').drawImage(src, 0, 0);
  if (img.parentNode) img.parentNode.replaceChild(cv, img);
}

function hexRgb(c) {
  var r = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(c || '');
  if (r) return [+r[1], +r[2], +r[3]];
  var m = /^#?([0-9a-f]{6})$/i.exec(c || '');
  if (!m) return null;
  var n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

// The colour with its lightness raised to at least 0.6 (same hue and
// saturation); null for greys and blacks.
function readable(rgb) {
  if (!rgb) return null;
  var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
  var hi = Math.max(r, g, b), lo = Math.min(r, g, b), l = (hi + lo) / 2, d = hi - lo;
  if (d < 0.12) return null;
  var sat = d / (1 - Math.abs(2 * l - 1));
  var h = hi === r ? ((g - b) / d + 6) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
  l = Math.max(l, 0.6);
  var c = (1 - Math.abs(2 * l - 1)) * Math.min(1, sat), x = c * (1 - Math.abs(h % 2 - 1)), m = l - c / 2;
  var f = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h) % 6];
  return f.map(function (v) { return Math.round((v + m) * 255); });
}

function glassLogo(img, color) {
  var W = img.naturalWidth, H = img.naturalHeight, k = Math.min(1, 640 / Math.max(W, H));
  var w = Math.max(4, Math.round(W * k)), h = Math.max(4, Math.round(H * k));
  var c = document.createElement('canvas');
  c.width = w; c.height = h;
  var ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  var d;
  try { d = ctx.getImageData(0, 0, w, h); } catch (e) { return { bleed: false }; }
  var px = d.data;
  function at(x, y) { var i = (y * w + x) * 4; return [px[i], px[i + 1], px[i + 2], px[i + 3]]; }
  var corners = [at(1, 1), at(w - 2, 1), at(1, h - 2), at(w - 2, h - 2)], bg = corners[0];
  var opaque = corners.every(function (q) { return q[3] >= 240; });
  var flat = opaque && corners.every(function (q) {
    return Math.abs(q[0] - bg[0]) + Math.abs(q[1] - bg[1]) + Math.abs(q[2] - bg[2]) < 40;
  });
  var i, a, white = 0, logo = 0;
  for (i = 0; i < px.length; i += 4) {
    if (flat) {
      // How far from the background: 0 = background, 1 = logo; edges in
      // between get their own colour back (unmixed from the background).
      var dist = Math.max(Math.abs(px[i] - bg[0]), Math.abs(px[i + 1] - bg[1]), Math.abs(px[i + 2] - bg[2]));
      a = Math.max(0, Math.min(1, (dist - 16) / 48));
      if (a > 0 && a < 1) for (var j = 0; j < 3; j++) px[i + j] = Math.max(0, Math.min(255, bg[j] + (px[i + j] - bg[j]) / a));
      px[i + 3] = Math.round(px[i + 3] * a);
    }
    if (px[i + 3] > 230) {               // solid pixels only: thin letters are mostly edges
      logo++;
      if (Math.min(px[i], px[i + 1], px[i + 2]) > 160) white++;   // light in every channel (edges are tinted)
    }
  }
  // A white logo takes the brand colour, if that is a colour (not grey or
  // black), lightened where needed to read on the dark glass (WOW's dark
  // teal becomes a brighter teal).
  var brand = readable(flat ? bg : hexRgb(color));
  if (brand && logo && white / logo > 0.8) {
    for (i = 0; i < px.length; i += 4) { px[i] = brand[0]; px[i + 1] = brand[1]; px[i + 2] = brand[2]; }
  }
  ctx.putImageData(d, 0, 0);
  return { canvas: c, bleed: opaque };
}

var ICONS = {
  pen: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M20 6h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zm-1 8h-3v3h-2v-3h-3v-2h3V9h2v3h3v2z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
  reset: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/></svg>',
  none: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 0 1 6.3 12.9L7.1 5.7A8 8 0 0 1 12 4zM4 12a8 8 0 0 1 1.7-4.9l11.2 11.2A8 8 0 0 1 4 12z"/></svg>',
  usb: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M15 7v4h1v2h-3V5h2l-3-4-3 4h2v8H8v-2.07A1.98 1.98 0 0 0 9 9.2 2 2 0 1 0 6 11v2a2 2 0 0 0 2 2h3v3.05a2.5 2.5 0 1 0 2 0V15h3a2 2 0 0 0 2-2v-2h1V7h-4z"/></svg>',
  apps: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>',
};
var GEAR = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>';

function renderTile(entry) {
  var tile = document.createElement('div');
  tile.className = 'tile';
  var card = document.createElement('div');
  card.className = 'card';
  var label = document.createElement('div');
  label.className = 'label';

  // Card types of modules (Hue rooms): tile(entry, card, label) fills the card.
  if (claim('tile', entry, card, label)) {
  } else if (entry.type === 'album') {
    card.classList.add('album');
    var mos = '<div class="mos n' + Math.min(entry.pics.length, 4) + '">';
    entry.pics.slice(0, 4).forEach(function (w) { mos += '<div style="background-image:url(\'' + picThumb(w) + '\')"></div>'; });
    card.innerHTML = mos + '</div><div class="count">' + entry.pics.length + '</div><div class="gloss"></div>';
    label.textContent = entry.title;
  } else if (entry.type === 'image') {
    card.classList.add('art');
    card.innerHTML = '<img alt=""><div class="gloss"></div>';
    card.querySelector('img').src = entry.url;
    label.textContent = entry.title;
  } else if (entry.type === 'app' && entry.tile) {
    // Sharp full-card artwork (tiles/<appId>.png) instead of the LG icon.
    card.classList.add('art', 'app');
    card.innerHTML = '<img alt=""><div class="gloss"></div>';
    logoInto(card, card.querySelector('img'), entry.tile, entry.color, false);
    label.textContent = entry.title;
  } else if (entry.type === 'app') {
    card.classList.add('app');
    card.innerHTML = '<div class="shade"></div><div class="gloss"></div>';
    iconInto(card, entry);
    label.textContent = entry.title;
  } else if (entry.type === 'folder') {
    card.classList.add('folder');
    var minis = document.createElement('div');
    minis.className = 'minis';
    entry.items.slice(0, 6).forEach(function (app) {
      var m = document.createElement('div');
      m.className = 'mini';
      if (app.tile) {
        m.classList.add('art');
        m.innerHTML = '<img alt="">';
        logoInto(m, m.querySelector('img'), app.tile, app.color, false);
      } else {
        iconInto(m, app);
      }
      minis.appendChild(m);
    });
    card.appendChild(minis);
    card.insertAdjacentHTML('beforeend', '<div class="gloss"></div>');
    label.textContent = entry.name + (entry.items.length ? '' : ' ' + t('emptySuffix'));
  } else {
    card.classList.add('settings');
    card.innerHTML = (entry.icon === 'gear' ? GEAR : ICONS[entry.icon]) + '<div class="gloss"></div>';
    label.textContent = entry.title;
  }
  tile.appendChild(card);
  tile.appendChild(label);
  return tile;
}


// ---------------------------------------------------------------- sharp logos

// LG's icons are at most 192 px, drawn at 384 on the 4K screen, so they look
// soft. Most apps' splash screens (1920x1080) show the logo large: cut out
// once here, saved on the TV by autotile.py, it replaces the icon (cache.js
// hands over `_logo` from then on). One app at a time while TV Home sits
// still: about 100 ms each, a first run only.
var logoQueue = [], logoBusy = false, logoTried = {}, logoMade = 0, lastKeyAt = 0;
var AUTOTILE = 'python3 ' + APP_DIR + 'autotile.py ';
var LOGO_W = 480, LOGO_H = 200;   // about twice what a card shows of a logo

// Called after every reload: adds what is new (the queue itself stays).
function makeLogos() {
  var was = logoQueue.length;
  // Tried shortly before: its result is on the way (once saved, cache.js no
  // longer hands over the splash). Much later: its logo file was deleted to
  // have it cut again (docs/LOGOS.md).
  appOrder.forEach(function (k) {
    var a = apps[k];
    if (!a || !a.splash || a.logo || Date.now() - (logoTried[a.id] || 0) < 120000) return;
    if (logoQueue.some(function (q) { return q.id === a.id; })) return;
    logoTried[a.id] = Date.now();
    logoQueue.push(a);
  });
  if (logoQueue.length && !was && !logoBusy) setTimeout(nextLogo, 3000);
}

function nextLogo() {
  if (logoBusy) return;
  // Not while someone is moving around or a menu / the frame is open.
  if (document.hidden || stack.length || Date.now() - lastKeyAt < 3000) { setTimeout(nextLogo, 3000); return; }
  var a = logoQueue.shift();
  if (!a) { if (logoMade) { logoMade = 0; load(); } return; }   // all done: reload to show them
  logoBusy = true;
  var base = a.id.replace(/[^A-Za-z0-9._-]/g, '_'), name = base + '.' + a.sig;
  function done() { logoBusy = false; setTimeout(nextLogo, 800); }
  var img = new Image();
  img.onload = function () {
    var r = null;
    try { r = splashLogo(img); } catch (e) {}
    img.src = '';
    if (!r) { exec(AUTOTILE + 'none ' + base + ' ' + name + '.none', done); return; }
    // Raw pixels go to the TV, which writes the PNG: the TV browser's own PNG
    // encoder (toDataURL) sometimes writes broken rows.
    var k = Math.min(1, LOGO_W / r.width, LOGO_H / r.height);
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(r.width * k)); c.height = Math.max(1, Math.round(r.height * k));
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(r, 0, 0, c.width, c.height);
    var px = ctx.getImageData(0, 0, c.width, c.height).data, bin = '';
    for (var i = 0; i < px.length; i += 8192) bin += String.fromCharCode.apply(null, px.subarray(i, i + 8192));
    var b64 = btoa(bin), CH = 100000, parts = [];   // one exec argument < 128 KiB
    for (i = 0; i < b64.length; i += CH) parts.push(b64.slice(i, i + CH));
    (function send(i) {
      if (i < parts.length) { exec(AUTOTILE + 'part ' + name + '.png ' + parts[i], function () { send(i + 1); }); return; }
      exec(AUTOTILE + 'save ' + base + ' ' + name + '.png ' + c.width + ' ' + c.height, function () { logoMade++; done(); });
    })(0);
  };
  img.onerror = done;
  img.src = a.splash;
}

// The logo in an app's splash screen, cut out with a transparent background
// (a canvas), or null when there is none to find (a generic splash, a busy picture).
// The background is modelled per row from the left and right edges, which
// also covers vertical gradients; everything that differs from it is logo.
function splashLogo(img) {
  var W = img.naturalWidth, H = img.naturalHeight;
  if (W < 640 || H < 360) return null;
  var c = document.createElement('canvas');
  c.width = W; c.height = H;
  var ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  var px;
  try { px = ctx.getImageData(0, 0, W, H).data; } catch (e) { return null; }
  var E = 8, x, y, i, j;
  // Edge colours per row (average of E pixels on each side).
  var L = new Float32Array(H * 3), R = new Float32Array(H * 3);
  for (y = 0; y < H; y++) {
    for (j = 0; j < 3; j++) {
      var l = 0, r = 0;
      for (x = 0; x < E; x++) { l += px[(y * W + x) * 4 + j]; r += px[(y * W + W - 1 - x) * 4 + j]; }
      L[y * 3 + j] = l / E; R[y * 3 + j] = r / E;
    }
  }
  function dist(x, y) {
    var f = x / (W - 1), i = (y * W + x) * 4, m = 0;
    for (var j = 0; j < 3; j++) {
      var b = L[y * 3 + j] + (R[y * 3 + j] - L[y * 3 + j]) * f, d = Math.abs(px[i + j] - b);
      if (d > m) m = d;
    }
    return m;
  }
  // Foreground: what differs from the background by more than T. The logo
  // is the band of rows around the centre (gaps under 2% of the height),
  // then the columns in that band; a glow at the bottom (Joyn) stays out.
  // Too big (a light burst behind the logo, WOW): again with a higher T, so
  // only the bright logo counts.
  function band(a, len, from, gap) {
    var lo = from, hi = from, g;
    if (a[from] < 2) {             // the centre itself is empty: the nearest busy line
      for (var d = 1; d < len / 4; d++) {
        if (a[from - d] >= 2) { lo = hi = from - d; break; }
        if (a[from + d] >= 2) { lo = hi = from + d; break; }
      }
      if (a[lo] < 2) return null;
    }
    for (g = 0; lo > 0 && g <= gap; ) { if (a[lo - 1] >= 2) { lo--; g = 0; } else if (g++ < gap) lo--; else break; }
    for (g = 0; hi < len - 1 && g <= gap; ) { if (a[hi + 1] >= 2) { hi++; g = 0; } else if (g++ < gap) hi++; else break; }
    while (a[lo] < 2) lo++;
    while (a[hi] < 2) hi--;
    return [lo, hi];
  }
  var T, sx, sy, n, bw, bh, why;
  for (var pass = 0; pass < 2; pass++) {
    T = pass ? 110 : 40;
    var rows = new Uint32Array(H);
    for (y = 0; y < H; y++) for (x = E; x < W - E; x++) if (dist(x, y) > T) rows[y]++;
    sy = band(rows, H, H >> 1, Math.round(H * 0.02));
    if (!sy) return null;
    var cols = new Uint32Array(W);
    n = 0;
    for (y = sy[0]; y <= sy[1]; y++) for (x = E; x < W - E; x++) if (dist(x, y) > T) { cols[x]++; n++; }
    sx = band(cols, W, W >> 1, Math.round(W * 0.03));
    if (!sx) return null;
    bw = sx[1] - sx[0] + 1; bh = sy[1] - sy[0] + 1;
    var cx = (sx[0] + sx[1]) / 2 / W, cy = (sy[0] + sy[1]) / 2 / H;
    // A logo: near the centre, not tiny, not most of the screen, not sparse.
    why = Math.abs(cx - 0.5) > 0.12 || Math.abs(cy - 0.5) > 0.15 ? 'off centre' :
      bw < W * 0.04 || bh < H * 0.03 ? 'too small' : bw > W * 0.6 || bh > H * 0.4 ? 'too big' :
      n / (bw * bh) < 0.05 ? 'too sparse' : '';
      if (why !== 'too big') break;
  }
  if (why) return null;
  // Cut it out with a margin; alpha from the distance to the background,
  // colours unmixed from it at the soft edges.
  var pad = Math.round(Math.max(bw, bh) * 0.04);
  var x0 = Math.max(0, sx[0] - pad), y0 = Math.max(0, sy[0] - pad);
  var x1 = Math.min(W - 1, sx[1] + pad), y1 = Math.min(H - 1, sy[1] + pad);
  var ow = x1 - x0 + 1, oh = y1 - y0 + 1;
  var o = document.createElement('canvas');
  o.width = ow; o.height = oh;
  var octx = o.getContext('2d');
  var out = octx.createImageData(ow, oh), q = out.data;
  for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) {
    // (The stricter pass also cuts harder, so the glow behind stays out.)
    var a = Math.max(0, Math.min(1, (dist(x, y) - T * (pass ? 0.9 : 0.4)) / (T * 1.2)));
    i = (y * W + x) * 4; var k = ((y - y0) * ow + x - x0) * 4, f = x / (W - 1);
    for (j = 0; j < 3; j++) {
      var b = L[y * 3 + j] + (R[y * 3 + j] - L[y * 3 + j]) * f;
      q[k + j] = a > 0 ? Math.max(0, Math.min(255, b + (px[i + j] - b) / a)) : 0;
    }
    q[k + 3] = Math.round(a * 255);
  }
  octx.putImageData(out, 0, 0);
  return o;
}

// ---------------------------------------------------------------- grid

// A focusable tile grid. opts: container, onActivate(entry, i),
// onLongPress(entry, i), onRow(row), onMove(entries) (move mode finished).
function Grid(opts) {
  this.o = opts;
  this.entries = [];
  this.focus = 0;
  this.moving = -1;
}

Grid.prototype.set = function (entries, keepKey) {
  var prevKey = keepKey || (this.entries[this.focus] && this.entries[this.focus].key);
  this.entries = entries;
  var idx = -1;
  for (var i = 0; i < entries.length; i++) if (entries[i].key === prevKey) idx = i;
  this.focus = idx >= 0 ? idx : Math.min(this.focus, entries.length - 1);
  this.render();
};

Grid.prototype.render = function () {
  var self = this;
  var c = this.o.container;
  c.innerHTML = '';
  this.entries.forEach(function (e, i) {
    var tile = renderTile(e);
    if (self.o.decorate) self.o.decorate(tile, e, i);
    tile.addEventListener('mouseenter', function () { if (self.moving < 0) self.setFocus(i); });
    pressable(tile, function () { self.activate(i); }, function () { self.longPress(i); });
    c.appendChild(tile);
  });
  this.setFocus(Math.max(0, this.focus), true);
};

Grid.prototype.tiles = function () { return this.o.container.children; };
Grid.prototype.cols = function () { return this.o.cols || COLS; };

Grid.prototype.setFocus = function (i, force) {
  if (!this.entries.length) return;
  i = Math.max(0, Math.min(this.entries.length - 1, i));
  if (i === this.focus && !force) return;
  var tiles = this.tiles();
  if (tiles[this.focus]) tiles[this.focus].classList.remove('focus');
  this.focus = i;
  tiles[i].classList.add('focus');
  if (this.o.onRow) this.o.onRow(Math.floor(i / this.cols()));
};

Grid.prototype.target = function (keyCode) {
  var C = this.cols(), f = this.focus, n = this.entries.length, row = Math.floor(f / C);
  switch (keyCode) {
    case KEY.LEFT:  return f % C > 0 ? f - 1 : f;
    case KEY.RIGHT: return f % C < C - 1 && f + 1 < n ? f + 1 : f;
    case KEY.UP:    return row > 0 ? f - C : f;
    case KEY.DOWN:  return f + C < n ? f + C : (row < Math.floor((n - 1) / C) ? n - 1 : f);
  }
  return f;
};

Grid.prototype.key = function (e) {
  var k = e.keyCode;
  if (this.moving >= 0) {
    if (k === KEY.OK || k === KEY.BACK) { this.endMove(); return true; }
    var to = this.target(k);
    // The fixed cards always stay at the end.
    if (to !== this.focus && this.entries[to].type !== 'special') this.swap(this.focus, to);
    return true;
  }
  if (k >= 37 && k <= 40) { this.setFocus(this.target(k)); return true; }
  return false;
};

Grid.prototype.activate = function (i) {
  if (!once()) return;
  if (this.moving >= 0) { this.endMove(); return; }
  this.setFocus(i);
  this.o.onActivate(this.entries[i], i);
};

Grid.prototype.longPress = function (i) {
  if (this.moving >= 0 || !once()) return;
  this.setFocus(i);
  if (this.o.onLongPress) this.o.onLongPress(this.entries[i], i);
};

Grid.prototype.startMove = function (i) {
  if (!this.entries[i] || this.entries[i].type === 'special') return;
  this.moving = i;
  this.setFocus(i, true);
  this.tiles()[i].classList.add('moving');
  showHint(t('moveHint'));
};

Grid.prototype.swap = function (a, b) {
  var e = this.entries;
  var tmp = e[a]; e[a] = e[b]; e[b] = tmp;
  this.focus = b;
  this.moving = b;
  this.render();
  this.tiles()[b].classList.add('moving');
};

Grid.prototype.endMove = function () {
  var tiles = this.tiles();
  if (tiles[this.moving]) tiles[this.moving].classList.remove('moving');
  this.moving = -1;
  showHint(editMode ? t('editHint') : '');
  if (this.o.onMove) this.o.onMove(this.entries);
};

// OK / pointer press that distinguishes a tap from a long hold.
function pressable(el, onTap, onLong) {
  var timer = null, fired = false;
  el.addEventListener('mousedown', function () {
    fired = false;
    timer = setTimeout(function () { fired = true; timer = null; onLong(); }, LONG_PRESS_MS);
  });
  el.addEventListener('mouseup', function () {
    if (timer) { clearTimeout(timer); timer = null; onTap(); }
  });
  el.addEventListener('mouseleave', function () {
    if (timer) { clearTimeout(timer); timer = null; }
  });
}

// ---------------------------------------------------------------- main view

// Scroll so the focused row sits near the top, but never past the point where
// the last row reaches the bottom edge (no empty space under the last row).
var BOTTOM_PAD = 40;
function scrollMain(row) {
  var rows = Math.ceil(mainGrid.entries.length / COLS);
  var maxScroll = Math.max(0, GRID_TOP + rows * ROW_H - 1080 + BOTTOM_PAD);
  var want = row === 0 ? 0 : GRID_TOP + row * ROW_H - 260;
  var y = -Math.min(want, maxScroll);
  document.getElementById('page').style.transform = 'translateY(' + y + 'px)';
  document.body.classList.toggle('scrolled', row > 0);
}

function refreshMain(keepKey) {
  applyGrid();                      // row height first: scrolling and the Plex rows use it
  buildApps();
  // keep: a module's own focus (a Plex card) survives the new grid.
  var kept = {};
  MODULES.forEach(function (m) { if (m.keep && moduleOn(m)) kept[m.id] = m.keep(); });
  mainGrid.set(mainEntries(), keepKey);
  MODULES.forEach(function (m) { if (m.refresh && moduleOn(m)) m.refresh(kept[m.id]); });
  renderTop();
  applyLook();
}

// ---------------------------------------------------------------- top buttons

// Modules add buttons: {icon, title, action, longAction, cls() -> extra classes}.
function topButtons() {
  return [
    { icon: GEAR, title: t('settings'), action: openSettings },
    { icon: ICONS.apps, title: t('editHome'), action: function () { setEditMode(!editMode); } }
  ].concat(hook('topButtons'));
}

function renderTop() {
  var bar = document.getElementById('topbar');
  var buttons = topButtons();
  bar.innerHTML = '';
  buttons.forEach(function (btn, i) {
    var el = document.createElement('div');
    el.className = 'tbtn' + (i === topFocus ? ' focus' : '') + (i === 1 && editMode ? ' on' : '') +
      (btn.cls ? ' ' + btn.cls() : '');
    el.innerHTML = btn.icon + '<div class="tlabel"></div>';
    el.querySelector('.tlabel').textContent = btn.title;
    el.addEventListener('mouseenter', function () { focusTop(i); });
    pressable(el, function () { focusTop(i); if (once()) btn.action(); },
      function () { focusTop(i); if (btn.longAction && once()) btn.longAction(); });
    bar.appendChild(el);
  });
  if (topFocus >= buttons.length) topFocus = buttons.length - 1;
}


function focusTop(i) {
  hook('leave');
  var tiles = mainGrid.tiles();
  if (tiles[mainGrid.focus]) tiles[mainGrid.focus].classList.remove('focus');
  topFocus = i;
  var els = document.getElementById('topbar').children;
  for (var j = 0; j < els.length; j++) els[j].classList.toggle('focus', j === i);
  scrollMain(0);
}

function leaveTop() {
  topFocus = -1;
  var els = document.getElementById('topbar').children;
  for (var j = 0; j < els.length; j++) els[j].classList.remove('focus');
  mainGrid.setFocus(mainGrid.focus, true);
}

// Row spacing and app names (Settings) on the home grid and in folders.
function applyGrid() {
  var c = cfg();
  ROW_H = TILE_H + Math.max(ROW_GAPS[c.rowGap] || ROW_GAPS.even, c.names ? NAME_GAP : 0);
  document.getElementById('grid').style.setProperty('--row-h', ROW_H + 'px');
  document.body.classList.toggle('names', !!c.names);
  document.body.classList.toggle('glass', c.cards !== 'color');
  document.body.classList.toggle('bar', barCfg().on);
  var views = document.querySelectorAll('#page, .folderView:not(.picker)');
  for (var i = 0; i < views.length; i++) paintBar(views[i]);
}

// The bar's colour and brightness live on the views with tiles, not on
// body: a variable on body restyles the whole page, menus included.
function paintBar(el) {
  var bar = barCfg();
  el.style.setProperty('--bar', BAR_COLORS[bar.color]);
  el.style.setProperty('--bar-o', (bar.bri / 100).toFixed(2));
}

function barCfg() {
  var b = cfg().bar || {};
  return { on: b.on !== false, color: BAR_COLORS[b.color] ? b.color : 'white',
           bri: Math.max(20, Math.min(100, +b.bri || 80)) };
}

// Settings > Look: how the home screen looks. "Selected app" is one setting
// for the name and the focus bar (only one of them shows at a time); the
// bar's colour and brightness appear with Bar. Modules may add rows at the
// end (lookRows); their own settings live under Settings > Features.
var CARD_STYLES = ['glass', 'color'];
function openLook() {
  var SEL = ['bar', 'name', 'none'];
  menu({
    title: function () { return t('look'); },
    rows: function () {
      var c = cfg(), b = barCfg();
      var sel = c.names ? 'name' : b.on ? 'bar' : 'none';
      function setBar(key, value) { c.bar = barCfg(); c.bar[key] = value; saveConfig(); applyGrid(); refreshTop(); }
      var rows = [
        { label: t('wallpaper'), value: wallpaperLabel(), chevron: true, action: function () { openPictures(WALLPAPER); } }
      ].concat([
        stepRow(t('cards'), t(c.cards === 'color' ? 'cardsColor' : 'cardsGlass'), function (d) {
          var i = CARD_STYLES.indexOf(c.cards === 'color' ? 'color' : 'glass') + d;
          if (i < 0 || i >= CARD_STYLES.length) return;
          c.cards = CARD_STYLES[i]; saveConfig(); refreshMain(); refreshTop();
        }),
        stepRow(t('rowSpacing'), t('gap' + c.rowGap.charAt(0).toUpperCase() + c.rowGap.slice(1)), function (d) {
          var i = ROW_GAP_ORDER.indexOf(c.rowGap) + d;
          if (i < 0 || i >= ROW_GAP_ORDER.length) return;
          c.rowGap = ROW_GAP_ORDER[i]; saveConfig(); refreshMain(); refreshTop();
        }),
        stepRow(t('selectedApp'), t({ bar: 'selBar', name: 'selName', none: 'selNone' }[sel]), function (d) {
          var i = SEL.indexOf(sel) + d;
          if (i < 0 || i >= SEL.length) return;
          c.names = SEL[i] === 'name';
          c.bar = barCfg(); c.bar.on = SEL[i] === 'bar';
          saveConfig(); refreshMain(); refreshTop();
        })
      ]);
      if (sel === 'bar') rows.push(
        stepRow(t('barColor'), t('col_' + b.color), function (d) {
          var i = BAR_ORDER.indexOf(b.color) + d;
          if (i >= 0 && i < BAR_ORDER.length) setBar('color', BAR_ORDER[i]);
        }),
        stepRow(t('barBri'), b.bri + '%', function (d) {
          var v = Math.max(20, Math.min(100, b.bri + d * 10));
          if (v !== b.bri) setBar('bri', v);
        }));
      rows.push(
        stepRow(t('showClock'), c.clock ? t('on') : t('off'), function () {
          c.clock = !c.clock; saveConfig(); refreshTop();
          document.getElementById('clock').classList.toggle('off', !c.clock);
        }));
      return rows.concat(hook('lookRows'));
    }
  });
}

// Settings rows changed with Left/Right between small arrows.
function stepRow(label, value, adjust) {
  return { label: label, value: '‹ ' + value + ' ›', adjust: adjust };
}

function applyLook() {
  var c = cfg();
  applyGrid();
  var wall = document.getElementById('wall');
  var wp = null;
  state.wallpapers.forEach(function (w) { if (w.name === c.wallpaper) wp = w; });
  if (!wp && c.wallpaper !== 'none' && state.wallpapers.length) wp = state.wallpapers[0];
  wall.classList.toggle('none', !wp);
  // The picture's crop, if it has one (else cover, centred).
  var crop = wp && cropOf(wp.name);
  if (crop && !crop.r) {                // older crops: learn the picture's shape once
    var probe = new Image();
    probe.onload = function () { crop.r = probe.naturalWidth / probe.naturalHeight; saveConfig(); applyLook(); };
    probe.src = wp.url;
  }
  showWallpaper(wall, wp ? wp.url : '', function (img) {
    if (crop && crop.r) {
      var cw = 1920 / crop.w, chh = cw / crop.r;
      img.style.cssText = 'width:' + cw + 'px;height:' + chh + 'px;left:' + (-crop.x * cw) + 'px;top:' + (-crop.y * chh) + 'px';
    } else img.style.cssText = 'width:1920px;height:1080px;object-fit:cover';
  });
  document.getElementById('clock').classList.toggle('off', !c.clock);
  document.documentElement.lang = lang();
}

// The wallpaper is an <img> in #wall, decoded before it is shown. As a CSS
// background the TV decoded it while painting, on the page's own thread: a
// 4K picture froze TV Home for 2-3 s. img.decode() works in the background,
// and the old picture stays until the new one is ready. place(img) sizes it.
function showWallpaper(wall, url, place) {
  var img = wall.querySelector('img');
  wall.wantUrl = url;
  if (img && img.getAttribute('data-url') === url) { place(img); return; }
  if (!url) { if (img) wall.removeChild(img); return; }
  var next = new Image(), counted = !revealed;
  if (counted) pendingImages++;          // the cover waits for it
  next.setAttribute('data-url', url);
  next.src = url;
  function show() {
    if (counted) { counted = false; pendingImages--; }
    if (wall.wantUrl !== url) return;     // another wallpaper was chosen meanwhile
    place(next);
    var old = wall.querySelector('img');
    if (old) wall.replaceChild(next, old); else wall.appendChild(next);
  }
  (next.decode ? next.decode() : Promise.resolve()).then(show, show);
}

function onMainActivate(entry, i) {
  if (entry.type === 'special') {
    if (entry.key === '__settings') openSettings();
    else if (entry.key === '__edit') setEditMode(true);
    else if (entry.key === '__add') chooseAddApps();
    else if (entry.key === '__newfolder') newFolderFlow();
    else if (entry.key === '__uninstall') chooseUninstall();
    else if (entry.key === '__reset') resetLayout();
  } else if (editMode) {
    onMainLongPress(entry, i);
  } else if (entry.type === 'app') launch(entry);
  else if (entry.type === 'folder') openFolder(entry.key);
}

function setEditMode(on) {
  editMode = on;
  hideLegend();
  document.body.classList.toggle('editing', on);
  showHint(on ? t('editHint') : '');
  refreshMain();
}

function newFolderFlow() {
  askText(t('newFolder'), '', function (name) {
    var id = createFolder(name);
    refreshMain(id);
    chooseFolderApps(id);
  });
}

function onMainLongPress(entry, i) {
  if (entry.type === 'app') appOptions(entry, null, mainGrid, i);
  else if (entry.type === 'folder') folderOptions(entry.key, mainGrid, i);
}

// ---------------------------------------------------------------- overlays

function layer(cls) {
  var el = document.createElement('div');
  el.className = 'layer ' + (cls || '');
  document.body.appendChild(el);
  return el;
}

// Only the top layer is visible; the ones below are hidden until it closes.
function push(view) {
  hideLegend();
  var below = stack[stack.length - 1];
  if (below && below.el && !view.float) below.el.style.visibility = 'hidden';
  stack.push(view);
  document.body.classList.add('overlay');
  hook('stack');
}

function pop() {
  hideLegend();
  var v = stack.pop();
  if (v) {
    v.el.parentNode.removeChild(v.el);
    if (v.onClose) v.onClose();
  }
  if (!stack.length) document.body.classList.remove('overlay');
  var top = stack[stack.length - 1];
  if (top && top.el) top.el.style.visibility = '';
  hook('stack');
  if (top && top.refresh) top.refresh();
}

function closeAll() { while (stack.length) pop(); }

// Folder overlay: its own grid of the folder's apps.
function openFolder(id) {
  var el = layer('folderView');
  el.style.setProperty('--row-h', ROW_H + 'px');
  paintBar(el);
  el.innerHTML = '<div class="inner"><div class="title"></div><div class="grid"></div><div class="empty"></div></div>';
  var inner = el.querySelector('.inner');
  var view = { el: el };
  var grid = new Grid({
    container: el.querySelector('.grid'),
    onActivate: function (app) { launch(app); },
    onLongPress: function (app, i) { appOptions(app, id, grid, i); },
    onRow: function (row) { inner.style.transform = 'translateY(' + (row > 1 ? -(row - 1) * ROW_H : 0) + 'px)'; },
    onMove: function (entries) {
      cfg().folders[id].items = entries.map(function (e) { return e.key; });
      saveConfig();
      refreshMain();
    }
  });
  view.refresh = function () {
    var f = cfg().folders[id];
    if (!f) { pop(); return; }
    el.querySelector('.title').textContent = f.name;
    var items = folderItems(id);
    el.querySelector('.empty').textContent = items.length ? '' :
      t('folderEmpty');
    grid.set(items);
  };
  view.key = function (e) {
    if (grid.key(e)) return;
    if (e.keyCode === KEY.BACK) pop();
  };
  view.ok = function () { grid.activate(grid.focus); };
  view.longOk = function () { grid.longPress(grid.focus); };
  view.grid = grid;
  push(view);
  view.refresh();
}

// Generic list menu (settings panel or centered sheet).
// spec: { title, sub, sheet, info (INFO id for the small "i"), onFocus, onClose,
//         rows: function () -> [{label, value, chevron, check, danger, info, off, action}] }
// off: greyed out and skipped (a feature's settings while it is switched off).
function menu(spec) {
  var el = layer();
  var panel = document.createElement('div');
  panel.className = 'panel' + (spec.sheet ? ' sheet' : '');
  el.appendChild(panel);
  var view = { el: el, focus: 0, rows: [] };

  // A row's shape: what decides its element and listeners. When every row
  // keeps its shape (a Left/Right step), only the texts change in place;
  // rebuilding the whole panel per press is slow on the TV.
  function shape(r) {
    return [!!r.info, !!r.danger, !!r.off, r.value !== undefined || !!r.chevron, !!r.chevron].join();
  }
  function labelText(r) {
    return (r.check !== undefined ? (r.check ? '✓  ' : '     ') : '') + r.label;
  }

  view.refresh = function () {
    var old = view.rows;
    view.rows = spec.rows();
    var els = panel.querySelectorAll('.row');
    if (els.length && els.length === view.rows.length &&
        view.rows.every(function (r, i) { return shape(r) === shape(old[i]); })) {
      panel.querySelector('h1').textContent = typeof spec.title === 'function' ? spec.title() : spec.title;
      view.rows.forEach(function (r, i) {
        var lab = els[i].firstChild, v = els[i].querySelector('.val');
        if (r.info) { var h = hintHTML(r.label); if (lab.innerHTML !== h) lab.innerHTML = h; }
        else if (lab.textContent !== labelText(r)) lab.textContent = labelText(r);
        if (v && v.textContent !== (r.value || '')) v.textContent = r.value || '';
      });
      return;
    }
    panel.innerHTML = '<h1></h1>' + (spec.sub ? '<div class="sub"></div>' : '') + '<div class="rowsclip"><div class="rows"></div></div>';
    panel.querySelector('h1').textContent = typeof spec.title === 'function' ? spec.title() : spec.title;
    if (spec.sub) panel.querySelector('.sub').textContent = spec.sub;
    if (spec.info) {
      view.ibtn = document.createElement('div');
      view.ibtn.className = 'ibtn';
      view.ibtn.textContent = 'i';
      view.ibtn.addEventListener('mouseenter', function () { infoFocus(true); });
      view.ibtn.addEventListener('click', function () { if (once()) toggleLegend(spec.info); });
      panel.appendChild(view.ibtn);
    }
    var list = panel.querySelector('.rows');
    view.rows.forEach(function (r, i) {
      var row = document.createElement('div');
      row.className = 'row' + (r.info ? ' info' : '') + (r.danger ? ' danger' : '') + (r.off ? ' off' : '');
      var lab = document.createElement('span');
      if (r.info) lab.innerHTML = hintHTML(r.label);
      else lab.textContent = labelText(r);
      row.appendChild(lab);
      if (r.value !== undefined || r.chevron) {
        var v = document.createElement('span');
        v.className = 'val';
        v.textContent = r.value || '';
        row.appendChild(v);
      }
      if (r.chevron) row.insertAdjacentHTML('beforeend', '<span class="chev">›</span>');
      if (!r.info && !r.off) {
        row.addEventListener('mouseenter', function () { view.setFocus(i); });
        row.addEventListener('click', function () { view.setFocus(i); view.select(); });
      }
      list.appendChild(row);
    });
    var f = view.focus;
    if (!view.rows[f] || view.rows[f].info || view.rows[f].off) f = selectable(Math.min(f, view.rows.length - 1), -1);
    if (f < 0) f = selectable(0, 1);
    view.setFocus(f);
  };

  // The small "i" in the header: Up from the first row reaches it.
  function infoFocus(on) {
    view.infoFocus = on;
    if (view.ibtn) view.ibtn.classList.toggle('focus', on);
    var row = panel.querySelectorAll('.row')[view.focus];
    if (row) row.classList.toggle('focus', !on);
  }

  function selectable(from, dir) {
    for (var i = from; i >= 0 && i < view.rows.length; i += dir) if (!view.rows[i].info && !view.rows[i].off) return i;
    return -1;
  }
  function wrapSel(from, dir) {
    var i = selectable(from, dir);
    return i >= 0 ? i : selectable(dir > 0 ? 0 : view.rows.length - 1, dir);
  }

  view.setFocus = function (i) {
    if (i < 0) return;
    if (view.infoFocus) infoFocus(false);
    var rows = panel.querySelectorAll('.row');
    if (rows[view.focus]) rows[view.focus].classList.remove('focus');
    view.focus = i;
    if (rows[i]) rows[i].classList.add('focus');
    if (spec.onFocus) spec.onFocus(view.rows[i]);
    // Keep the focused row visible in long lists.
    // Keep the focused row centred in the clipped list area.
    var list = panel.querySelector('.rows');
    var clipH = list.parentNode.clientHeight;
    var row = rows[i];
    var y = row ? row.offsetTop + row.offsetHeight / 2 - clipH / 2 : 0;
    y = Math.max(0, Math.min(y, list.offsetHeight - clipH));
    list.style.transform = 'translateY(' + (-y) + 'px)';
  };

  view.select = function () {
    if (view.infoFocus) { if (once()) toggleLegend(spec.info); return; }
    var r = view.rows[view.focus];
    if (r && r.action && once()) r.action();
  };

  // Right goes one level deeper (only on rows that open a submenu, so a
  // sideways press can't flip a setting); Left goes back like Back.
  view.key = function (e) {
    if (view.infoFocus) {
      if (e.keyCode === KEY.DOWN) infoFocus(false);
      else if (e.keyCode === KEY.LEFT || e.keyCode === KEY.BACK) pop();
      return;
    }
    if (spec.info && e.keyCode === KEY.UP && selectable(view.focus - 1, -1) < 0) { infoFocus(true); return; }
    var r = view.rows[view.focus];
    // Rows with adjust(): Left/Right change the value instead of navigating.
    if (r && r.adjust && (e.keyCode === KEY.LEFT || e.keyCode === KEY.RIGHT)) {
      r.adjust(e.keyCode === KEY.LEFT ? -1 : 1);
      return;
    }
    // Lists wrap around: Up on the first row goes to the last and vice versa.
    if (e.keyCode === KEY.UP) view.setFocus(wrapSel(view.focus - 1, -1));
    else if (e.keyCode === KEY.DOWN) view.setFocus(wrapSel(view.focus + 1, 1));
    else if (e.keyCode === KEY.RIGHT) { if (r && r.chevron) view.select(); }
    else if (e.keyCode === KEY.LEFT || e.keyCode === KEY.BACK) pop();
  };
  view.ok = view.select;

  view.onClose = spec.onClose;
  push(view);
  view.refresh();
  return view;
}

// Text entry using the TV's on-screen keyboard.
function askText(title, initial, done) {
  var el = layer();
  el.innerHTML = '<div class="panel sheet inputBox"><h1></h1><input type="text" maxlength="30">' +
    '<div class="sub"></div></div>';
  el.querySelector('h1').textContent = title;
  el.querySelector('.sub').textContent = t('inputHint');
  var input = el.querySelector('input');
  input.value = initial || '';
  var view = { el: el };
  view.key = function (e) {
    if (e.keyCode === KEY.BACK) pop();
  };
  view.ok = function () {
    var v = input.value.trim();
    if (!v) return;
    pop();
    done(v);
  };
  input.addEventListener('keydown', function (e) {
    if (e.keyCode === KEY.OK) { e.preventDefault(); e.stopPropagation(); view.ok(); }
    else if (e.keyCode === KEY.BACK) { e.preventDefault(); e.stopPropagation(); pop(); }
  });
  push(view);
  setTimeout(function () { input.focus(); input.select(); }, 50);
}

function confirmSheet(title, sub, yesLabel, onYes) {
  menu({
    title: title, sub: sub, sheet: true,
    rows: function () {
      return [
        { label: yesLabel, danger: true, action: function () { pop(); onYes(); } },
        { label: t('cancel'), action: pop }
      ];
    }
  });
}

// ---------------------------------------------------------------- hints and legends

// Remote keys drawn as small key caps. Hint strings name them in braces:
// '{ok} open · {hold} options'. Symbols first, as few words as possible.
var KEY_LABELS = {
  ok: 'OK', back: { en: 'Back', de: 'Zurück' }, hold: { en: 'hold OK', de: 'OK halten' },
  arrows: '◀▲▼▶', lr: '◀ ▶', up: '▲', down: '▼', ch: 'CH+ / CH−',
  wheel: { en: 'wheel', de: 'Rad' }, pointer: { en: 'pointer', de: 'Zeiger' }
};

function local(v) { return typeof v === 'string' ? v : v[lang()] || v.en; }

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
}

function hintHTML(s) {
  return esc(s).replace(/\{([a-z]+)\}/g, function (m, k) {
    return KEY_LABELS[k] ? '<span class="kc">' + esc(local(KEY_LABELS[k])) + '</span>' : m;
  });
}

// What a screen's small "i" shows: a legend in a corner. It doesn't take
// the keys; "i" again or leaving the screen closes it.
var INFO = {
  pictures: { title: { en: 'Pictures', de: 'Bilder' }, lines: [
    { en: '{hold} folder: pictures, rename, delete', de: '{hold} Ordner: Bilder, umbenennen, löschen' },
    { en: '{hold} picture: ★ favourite, crop, folders', de: '{hold} Bild: ★ Favorit, Ausschnitt, Ordner' },
    { en: 'One crop per picture, used everywhere', de: 'Ein Ausschnitt pro Bild, gilt überall' }
  ] },
  crop: { title: { en: 'Crop', de: 'Ausschnitt' }, lines: [
    { en: '{up} crop: {arrows} move · {wheel} size', de: '{up} zuschneiden: {arrows} verschieben · {wheel} Größe' },
    { en: '{ok} save · {back} cancel', de: '{ok} speichern · {back} abbrechen' },
    { en: '4K sharp · Upscaled softer', de: '4K scharf · Hochskaliert weicher' },
    { en: 'The file stays whole · ✂ cuts it for good (asks first)', de: 'Die Datei bleibt ganz · ✂ schneidet sie endgültig (fragt vorher)' }
  ] },
  settings: { title: { en: 'TV Home', de: 'TV Home' }, lines: [
    { en: '{hold} on an app: options', de: '{hold} auf einer App: Optionen' },
    { en: '{up} from the first row: Settings, Organize Apps …', de: '{up} aus der ersten Reihe: Einstellungen, Apps organisieren …' },
    { en: '{back} first row', de: '{back} erste Reihe' }
  ] }
};

var legendEl = null, legendId = '';

function hideLegend() {
  if (legendEl) legendEl.parentNode.removeChild(legendEl);
  legendEl = null; legendId = '';
}

function toggleLegend(id, top) {
  if (legendId === id) { hideLegend(); return; }
  hideLegend();
  var info = INFO[id];
  legendEl = document.createElement('div');
  legendEl.className = 'legend' + (top ? ' top' : '');
  legendEl.innerHTML = '<div class="lt">' + esc(local(info.title)) + '</div>' + info.lines.map(function (l) {
    return '<div class="ll">' + hintHTML(l[lang()] || l.en) + '</div>';
  }).join('');
  document.body.appendChild(legendEl);
  legendId = id;
}

// A small "i" for a grid screen: Up from the top row reaches it, Down goes
// back to the cards.
function infoButton(view, host, id, grid) {
  var b = document.createElement('div');
  b.className = 'ibtn';
  b.textContent = 'i';
  host.appendChild(b);
  function focus(on) {
    view.infoFocus = on;
    b.classList.toggle('focus', on);
    var tile = grid.tiles()[grid.focus];
    if (tile) tile.classList.toggle('focus', !on);
  }
  b.addEventListener('mouseenter', function () { focus(true); });
  b.addEventListener('click', function () { if (once()) toggleLegend(id); });
  var key = view.key, ok = view.ok, longOk = view.longOk;
  view.key = function (e) {
    if (view.infoFocus) {
      focus(false);
      if (e.keyCode === KEY.BACK) key(e);
      return;
    }
    if (e.keyCode === KEY.UP && grid.moving < 0 && grid.focus < grid.cols()) { focus(true); return; }
    key(e);
  };
  view.ok = function () { if (view.infoFocus) { if (once()) toggleLegend(id); } else ok(); };
  if (longOk) view.longOk = function () { if (!view.infoFocus) longOk(); };
}

// ---------------------------------------------------------------- actions

function newFolderId() {
  var n = 1;
  while (cfg().folders['folder:' + n]) n++;
  return 'folder:' + n;
}

// New folder goes right after `afterKey` (the app it was created from), or last.
function createFolder(name, afterKey) {
  var id = newFolderId();
  var order = mainEntries().filter(function (e) { return e.type !== 'special'; }).map(function (e) { return e.key; });
  cfg().folders[id] = { name: name, items: [] };
  var at = afterKey ? order.indexOf(afterKey) : -1;
  order.splice(at >= 0 ? at : order.length, 0, id);
  cfg().order = order;
  saveConfig();
  return id;
}

function moveToFolder(key, id) {
  var c = cfg();
  if (!onHome(key)) setOnHome(key, true);
  var from = folderOf(key);
  if (from) c.folders[from].items.splice(c.folders[from].items.indexOf(key), 1);
  c.folders[id].items.push(key);
  var i = c.order.indexOf(key);
  if (i >= 0) c.order.splice(i, 1);
  saveConfig();
}

function removeFromFolder(key, id) {
  var c = cfg();
  var items = c.folders[id].items;
  items.splice(items.indexOf(key), 1);
  var at = c.order.indexOf(id);
  c.order.splice(at >= 0 ? at + 1 : c.order.length, 0, key);
  saveConfig();
}

function dissolveFolder(id) {
  var c = cfg();
  var at = c.order.indexOf(id);
  var items = c.folders[id].items;
  delete c.folders[id];
  if (at >= 0) c.order.splice.apply(c.order, [at, 1].concat(items));
  else c.order = c.order.concat(items);
  saveConfig();
}

// Forget an uninstalled app everywhere in the config.
function forgetApp(key) {
  var c = cfg();
  [c.order, c.hidden, c.added].forEach(function (list) {
    var i = list.indexOf(key);
    if (i >= 0) list.splice(i, 1);
  });
  var f = folderOf(key);
  if (f) c.folders[f].items.splice(c.folders[f].items.indexOf(key), 1);
  saveConfig();
}

function uninstall(app, done) {
  closeAll();
  showHint(t('uninstalling', app.title));
  var uri = app.dev ? 'luna://com.webos.appInstallService/dev/remove' : 'luna://com.webos.appInstallService/remove';
  var cmd = 'luna-send -n 1 -w 60000 ' + uri + " '" + JSON.stringify({ id: app.id }) + "' < /dev/null";
  exec(cmd, function (res) {
    var ok = res.returnValue !== false && /"returnValue":\s*true/.test(res.stdoutString || '');
    showHint(t(ok ? 'uninstalled' : 'uninstallFailed', app.title));
    if (ok) forgetApp(app.key);
    setTimeout(function () { showHint(editMode ? t('editHint') : ''); }, 4000);
    // The removal finishes in the background; reload once it has.
    setTimeout(load, 3000);
    if (done) done();
  });
}

function confirmUninstall(app) {
  confirmSheet(t('uninstallQ', app.title), t('uninstallWarn'), t('uninstallYes'), function () { uninstall(app); });
}

function folderNames() {
  var f = cfg().folders;
  return Object.keys(f).map(function (id) { return { id: id, name: f[id].name }; });
}

// Long-press menu for an app (on the home grid, or inside folder `inFolder`).
function appOptions(app, inFolder, grid, index) {
  menu({
    title: app.title, sheet: true,
    rows: function () {
      var rows = [{ label: t('move'), action: function () { pop(); grid.startMove(index); } }];
      rows.push({ label: inFolder ? t('toOtherFolder') : t('toFolder'), chevron: true,
        action: function () { pickFolderFor(app, inFolder); } });
      if (inFolder) rows.push({ label: t('removeFromFolder'), action: function () {
        pop(); removeFromFolder(app.key, inFolder); refreshMain(); refreshTop();
      } });
      rows.push({ label: t('removeFromHome'), action: function () {
        pop(); setOnHome(app.key, false); refreshMain(); refreshTop();
      } });
      // Uninstalling is only offered in edit mode (deliberate), and always confirmed.
      if (editMode && app.removable) rows.push({ label: t('uninstall'), danger: true, action: function () {
        confirmUninstall(app);
      } });
      return rows;
    }
  });
}

function pickFolderFor(app, currentFolder) {
  menu({
    title: t('toFolder'), sub: app.title, sheet: true,
    rows: function () {
      var rows = folderNames().filter(function (f) { return f.id !== currentFolder; }).map(function (f) {
        return { label: f.name, action: function () {
          closeAll(); moveToFolder(app.key, f.id); refreshMain(f.id);
        } };
      });
      rows.push({ label: '+ ' + t('newFolder') + ' …', action: function () {
        askText(t('newFolder'), '', function (name) {
          closeAll();
          var id = createFolder(name, currentFolder || app.key);
          moveToFolder(app.key, id);
          refreshMain(id);
        });
      } });
      return rows;
    }
  });
}

function folderOptions(id, grid, index) {
  menu({
    title: function () { return cfg().folders[id] ? cfg().folders[id].name : ''; }, sheet: true,
    rows: function () {
      return [
        { label: t('open'), action: function () { closeAll(); openFolder(id); } },
        { label: t('move'), action: function () { closeAll(); grid.startMove(indexOfKey(id)); } },
        { label: t('rename'), action: function () { renameFolder(id); } },
        { label: t('chooseApps'), chevron: true, action: function () { chooseFolderApps(id); } },
        { label: t('dissolve'), danger: true, action: function () {
          confirmSheet(t('dissolveQ'), t('dissolveSub'), t('dissolveYes'), function () {
            closeAll(); dissolveFolder(id); refreshMain();
          });
        } }
      ];
    }
  });
}

function renameFolder(id) {
  askText(t('renameFolder'), cfg().folders[id].name, function (name) {
    cfg().folders[id].name = name;
    saveConfig();
    refreshMain();
    refreshTop();
  });
}




function refreshTop() {
  var top = stack[stack.length - 1];
  if (top && top.refresh) top.refresh();
}

// ---------------------------------------------------------------- organize (pickers)

// Card picker: apps as home-screen tiles. Multi mode: OK toggles a badge
// (changes apply live via onToggle), Back is done. Single mode: OK picks and
// closes. tone 'remove' = red trash badges, unpicked cards stay bright.
function appPicker(o) {
  var el = layer('folderView picker' + (o.tone === 'remove' ? ' remove' : '') + (o.side ? ' side' : ''));
  el.innerHTML = '<div class="inner"><div class="title"></div><div class="grid"></div><div class="empty"></div></div>';
  el.querySelector('.title').textContent = o.title;
  var inner = el.querySelector('.inner');
  var picked = {};
  var entries = o.keys.filter(function (k) { return apps[k]; }).map(function (k) { return apps[k]; });
  entries.forEach(function (e) { if (o.isPicked && o.isPicked(e.key)) picked[e.key] = true; });
  el.querySelector('.empty').textContent = entries.length ? '' : (o.emptyText || '');
  var view = { el: el };
  var grid = new Grid({
    container: el.querySelector('.grid'),
    cols: o.side ? 3 : COLS,
    decorate: function (tile, e) {
      tile.insertAdjacentHTML('beforeend', '<div class="badge">' + (o.tone === 'remove' ? ICONS.trash : ICONS.check) + '</div>');
      tile.classList.toggle('picked', !!picked[e.key]);
      if (!o.single && o.tone !== 'remove') tile.classList.add('pickable');
    },
    onActivate: function (e, i) {
      if (o.single) { pop(); o.onDone([e.key]); return; }
      picked[e.key] = !picked[e.key];
      grid.tiles()[i].classList.toggle('picked', picked[e.key]);
      if (o.onToggle) o.onToggle(e.key, picked[e.key]);
    },
    onRow: function (row) { inner.style.transform = 'translateY(' + (row > 1 ? -(row - 1) * PICK_ROW_H : 0) + 'px)'; }
  });
  function finish() {
    pop();
    if (!o.single && o.onDone) o.onDone(Object.keys(picked).filter(function (k) { return picked[k]; }));
  }
  view.key = function (e) {
    if (grid.key(e)) return;
    if (e.keyCode === KEY.BACK) finish();
  };
  view.ok = function () { if (grid.entries.length) grid.activate(grid.focus); else finish(); };
  view.grid = grid;
  push(view);
  grid.set(entries);
  if (o.focusKey) for (var i = 0; i < entries.length; i++) if (entries[i].key === o.focusKey) grid.setFocus(i, true);
}

// Cards: ticked = in this folder.
function chooseFolderApps(id) {
  appPicker({
    title: cfg().folders[id].name,
    keys: appOrder,
    isPicked: function (k) { return cfg().folders[id].items.indexOf(k) >= 0; },
    onToggle: function (k, on) { if (on) moveToFolder(k, id); else removeFromFolder(k, id); },
    onDone: function () { refreshMain(id); refreshTop(); }
  });
}

// All installed apps as cards; ticked = on the home screen (add + remove in one place).
function chooseAddApps() {
  appPicker({
    title: t('homeAppsTitle'),
    keys: appOrder,
    isPicked: onHome,
    onToggle: function (k, on) { setOnHome(k, on); },
    onDone: function () { refreshMain(); }
  });
}

function resetLayout() {
  confirmSheet(t('resetQ'), t('resetSub'), t('resetYes'), function () {
    var c = cfg();
    c.order = []; c.folders = {}; c.hidden = []; c.added = [];
    saveConfig(); closeAll(); refreshMain();
  });
}

function chooseUninstall() {
  appPicker({
    title: t('uninstallApps'),
    tone: 'remove',
    keys: appOrder.filter(function (k) { return apps[k].removable; }),
    emptyText: t('noUninstall'),
    onDone: function (sel) {
      if (!sel.length) return;
      var list = sel.map(function (k) { return apps[k]; });
      var q = list.length === 1 ? t('uninstallQ', list[0].title) : t('uninstallNQ', list.length);
      confirmSheet(q, t('uninstallWarn'), t('uninstallYes'), function () { uninstallMany(list); });
    }
  });
}

function uninstallMany(list) {
  (function next(i) {
    if (i < list.length) uninstall(list[i], function () { next(i + 1); });
  })(0);
}

// ---------------------------------------------------------------- settings

function wallpaperLabel() {
  var c = cfg();
  if (c.wallpaper === 'none') return t('none');
  return c.wallpaper.replace(/\.[a-z]+$/i, '');
}


// Modules add their rows (settingsRows) and may refresh what those show when
// the settings open (settingsOpen).
function openSettings() {
  hook('settingsOpen');
  menu({
    title: function () { return t('settingsTitle'); },
    info: 'settings',
    rows: function () {
      return [
        { label: t('language'), value: LANG_NAMES[lang()], chevron: true, action: chooseLanguage },
        { label: t('look'), chevron: true, action: openLook }
      ].concat(MODULES.some(function (m) { return m.title; }) ? [{ label: t('features'), chevron: true, action: openFeatures }] : [],
        hook('settingsRows'), [
        { info: true, label: t('tip') },
        { info: true, label: 'TV Home ' + VERSION }
      ]);
    }
  });
}

// Settings > Features: every installed module with a title, On or Off. Each
// opens its own menu: the switch on top, the module's settings below it
// (greyed out while off). Off hides the feature and stops its hooks;
// setOn / toggled let it start or stop what runs on the TV. (Without a title
// it is part of something else: the App Store switch belongs to the privacy
// lock and only goes with it.)
function featureModules() {
  return MODULES.filter(function (m) { return m.title && (!m.available || m.available()); });
}

function openFeatures() {
  menu({
    title: function () { return t('features'); },
    sub: t('featuresSub'),
    rows: function () {
      return featureModules().map(function (m) {
        return { label: local(m.title), value: moduleOn(m) ? t('on') : t('off'), chevron: true,
                 action: function () { openFeature(m); } };
      });
    }
  });
}

function setModule(m, on) {
  var c = cfg();
  c.modules = c.modules || {};
  if (m.setOn) m.setOn(on);
  else if (on) delete c.modules[m.id];
  else c.modules[m.id] = false;
  saveConfig();
  if (m.toggled) m.toggled(on);
  refreshMain();
  refreshTop();
}

function openFeature(m) {
  if (m.featureOpen) m.featureOpen();
  menu({
    title: function () { return local(m.title); },
    info: m.legend,
    rows: function () {
      var on = moduleOn(m);
      function flip() { setModule(m, !on); }
      var rows = [{ label: local(m.title), value: '‹ ' + (on ? t('on') : t('off')) + ' ›', action: flip, adjust: flip }];
      if (m.about) rows.push({ info: true, label: local(m.about) });
      (m.settings ? m.settings() : []).forEach(function (r) {
        if (!on) { r = Object.create(r); r.off = true; }
        rows.push(r);
      });
      return rows;
    }
  });
}

function indexOfKey(key) {
  for (var i = 0; i < mainGrid.entries.length; i++) if (mainGrid.entries[i].key === key) return i;
  return 0;
}





// ---------------------------------------------------------------- picture library

// One library for Wallpaper and Picture Frame: the same folders, crops and
// screens. Only OK on a picture differs: Wallpaper uses it, Picture Frame
// starts the frame there. Config: crops {name: {x, y, w, r}} (16:9 crop as
// fractions of the picture, r = its width / height), pictureFolders
// [{id, name, items}]. A crop never changes the file.
function library() {
  var c = cfg(), f = c.frame || {};
  if (!c.crops) c.crops = {};
  if (!c.pictureFolders) c.pictureFolders = [];
  // Earlier versions kept these under the picture frame.
  if (f.focus) { for (var k in f.focus) if (!c.crops[k]) c.crops[k] = f.focus[k]; delete f.focus; saveConfig(); }
  if (f.folders) { c.pictureFolders = c.pictureFolders.concat(f.folders); delete f.folders; saveConfig(); }
  if (f.pictures) {
    c.pictureFolders.push({ id: 'p' + Date.now(), name: t('selection'), items: f.pictures });
    f.show = c.pictureFolders[c.pictureFolders.length - 1].id;
    delete f.pictures;
    saveConfig();
  }
  return c;
}

function pictureFolders() { return library().pictureFolders; }
function pictureFolder(id) {
  if (id === 'fav') return favFolder();
  return pictureFolders().filter(function (x) { return x.id === id; })[0] || null;
}
// Favourites: a built-in folder (can't be renamed or deleted); its items are
// the config's favourites list itself, so Choose Pictures edits it directly.
function favFolder() {
  var c = library();
  if (!c.favourites) c.favourites = [];
  return { id: 'fav', name: t('favourites'), items: c.favourites, fav: true };
}
function isFav(name) { return favFolder().items.indexOf(name) >= 0; }
function toggleFav(name) {
  var f = favFolder().items, at = f.indexOf(name);
  if (at >= 0) f.splice(at, 1); else f.push(name);
  saveConfig();
}
function cropOf(name) { return library().crops[name] || null; }
function picThumb(w) { return w ? w.thumb || w.url : ''; }
function folderPics(fo) {
  return state.wallpapers.filter(function (w) { return !fo || fo.items.indexOf(w.name) >= 0; });
}

function pickerLayer(title, hint) {
  var el = layer('folderView picker');
  el.innerHTML = '<div class="inner"><div class="title"></div><div class="pickhint"></div><div class="grid"></div></div>';
  el.querySelector('.title').textContent = title;
  el.querySelector('.pickhint').innerHTML = hintHTML(hint);
  return el;
}

function pickerView(el, grid) {
  var inner = el.querySelector('.inner');
  grid.o.onRow = function (row) { inner.style.transform = 'translateY(' + (row > 1 ? -(row - 1) * PICK_ROW_H : 0) + 'px)'; };
  var view = { el: el, grid: grid };
  view.key = function (e) { if (!grid.key(e) && e.keyCode === KEY.BACK) pop(); };
  view.ok = function () { grid.activate(grid.focus); };
  view.longOk = function () { grid.longPress(grid.focus); };
  return view;
}

// What the library is opened for: Wallpaper (here) or a module's (the
// Picture Frame's). title, hint (in a folder), none (offer None),
// wallpaper (a USB import becomes the wallpaper), albumOn(entry) (✓ on a
// folder), picOn(name) (✓ on a picture), pick(folder, entry, grid) (OK on a
// picture).
var WALLPAPER = {
  title: function () { return t('wallpaper'); },
  hint: 'wpUseHint', none: true, wallpaper: true,
  albumOn: function (e) { return e.key === 'none' && cfg().wallpaper === 'none'; },
  picOn: function (name) { return name === cfg().wallpaper; },
  pick: function (fo, e, grid) {
    cfg().wallpaper = e.key;
    saveConfig();
    applyLook();
    var tiles = grid.tiles();
    for (var i = 0; i < tiles.length; i++) tiles[i].classList.toggle('picked', grid.entries[i].key === e.key);
  }
};

// Top level, the same for every use: All pictures, the folders, New Folder,
// From USB (and None for the wallpaper). OK opens a folder; hold OK on a
// folder: Choose Pictures, Rename, Delete.
function openPictures(mode) {
  var el = pickerLayer(mode.title(), t('libHint'));
  function entries() {
    var list = [{ type: 'album', key: 'all', title: t('allPictures'), pics: folderPics(null) },
                { type: 'album', key: 'fav', title: t('favourites'), pics: folderPics(favFolder()) }];
    pictureFolders().forEach(function (fo) { list.push({ type: 'album', key: fo.id, title: fo.name, pics: folderPics(fo) }); });
    list.push({ type: 'special', key: '__new', icon: 'plus', title: t('newFolder') });
    list.push({ type: 'special', key: '__usb', icon: 'usb', title: t('fromUsb') });
    if (mode.none) list.push({ type: 'special', key: 'none', icon: 'none', title: t('none') });
    return list;
  }
  var grid = new Grid({
    container: el.querySelector('.grid'),
    decorate: function (tile, e) {
      // ✓ on what is in use (the frame's folder, or None as wallpaper).
      var on = mode.albumOn(e);
      tile.insertAdjacentHTML('beforeend', '<div class="badge">' + ICONS.check + '</div>');
      tile.classList.toggle('picked', on);
    },
    onActivate: function (e) {
      if (e.type === 'album') { openPictureFolder(pictureFolder(e.key), mode); return; }
      if (e.key === '__new') { newPictureFolder(); return; }
      if (e.key === '__usb') { chooseUsbPicture(mode); return; }
      if (e.key === 'none') { cfg().wallpaper = 'none'; saveConfig(); applyLook(); view.refresh(); }
    },
    onLongPress: function (e) { var fo = pictureFolder(e.key); if (fo) folderOptions_(fo); }
  });
  var view = pickerView(el, grid);
  view.refresh = function () { grid.set(entries(), grid.entries[grid.focus] && grid.entries[grid.focus].key); };
  infoButton(view, el.querySelector('.inner'), 'pictures', grid);
  push(view);
  grid.set(entries());
  catchUpThumbs();
}

function newPictureFolder() {
  askText(t('newFolder'), '', function (name) {
    var fo = { id: 'p' + Date.now(), name: name.trim() || t('newFolder'), items: [] };
    pictureFolders().push(fo);
    saveConfig();
    refreshTop();
    choosePictures(fo);
  });
}

function folderOptions_(fo) {
  menu({ title: fo.name, rows: function () {
    var pick = { label: t('choosePictures'), chevron: true, action: function () { pop(); choosePictures(fo); } };
    if (fo.fav) return [pick];
    return [
      pick,
      { label: t('rename'), action: function () {
        askText(t('rename'), fo.name, function (name) { if (name.trim()) fo.name = name.trim(); saveConfig(); pop(); });
      } },
      { label: t('deleteFolder'), danger: true, action: function () {
        confirmSheet(t('deleteFolderQ'), t('deleteFolderSub'), t('dissolveYes'), function () {
          cfg().pictureFolders = pictureFolders().filter(function (x) { return x !== fo; });
          hook('pictureFolderDeleted', fo.id);
          saveConfig();
          pop();                       // the folder's menu (the sheet closed itself)
        });
      } }
    ];
  } });
}

// A folder's pictures (fo = null: all). OK: mode.pick (use as wallpaper, ✓
// on the current one; or start the frame there). Hold OK: the picture's
// options (Crop, Folders).
function openPictureFolder(fo, mode) {
  var el = pickerLayer(fo ? fo.name : t('allPictures'), t(mode.hint));
  var grid = new Grid({
    container: el.querySelector('.grid'),
    decorate: function (tile, e) {
      if (e.wp && isFav(e.key)) tile.insertAdjacentHTML('beforeend', '<div class="fav">★</div>');
      if (!mode.picOn) return;
      tile.insertAdjacentHTML('beforeend', '<div class="badge">' + ICONS.check + '</div>');
      tile.classList.toggle('picked', mode.picOn(e.key));
    },
    onActivate: function (e) { mode.pick(fo, e, grid); },
    onLongPress: function (e) { if (e.wp) pictureOptions(e.wp); }
  });
  var view = pickerView(el, grid);
  view.refresh = function () { grid.set(entries(), grid.entries[grid.focus] && grid.entries[grid.focus].key); };
  infoButton(view, el.querySelector('.inner'), 'pictures', grid);
  function entries() {
    return folderPics(fo).map(function (w) {
      return { type: 'image', key: w.name, title: w.name.replace(/\.[a-z]+$/i, ''), url: picThumb(w), wp: w };
    });
  }
  push(view);
  var list = entries();
  grid.set(list);
  if (mode.picOn) for (var i = 0; i < list.length; i++) if (mode.picOn(list[i].key)) grid.setFocus(i, true);
}

function pictureOptions(w) {
  menu({ title: w.name.replace(/\.[a-z]+$/i, ''), rows: function () {
    var rows = [{ label: t('favourite'), value: isFav(w.name) ? '★' : '☆', action: function () { toggleFav(w.name); refreshTop(); } },
                { label: t('crop'), value: cropOf(w.name) ? t('cropSet') : '', chevron: true, action: function () { pop(); editCrop(w); } },
                { info: true, label: t('inFolders') }];
    pictureFolders().forEach(function (fo) {
      rows.push({ label: fo.name, check: fo.items.indexOf(w.name) >= 0, action: function () {
        var at = fo.items.indexOf(w.name);
        if (at >= 0) fo.items.splice(at, 1); else fo.items.push(w.name);
        saveConfig();
        refreshTop();
      } });
    });
    if (!pictureFolders().length) rows.push({ info: true, label: t('noFolders') });
    if (!w.bundled) rows.push({ label: t('deletePicture'), danger: true, action: function () {
      confirmSheet(t('deletePictureQ'), t('deletePictureSub'), t('deleteYes'), function () { deletePicture(w); });
    } });
    return rows;
  } });
}

// Delete Picture (picture options, asks first): the file, its preview, its
// crop and its place in every folder go. Pictures bundled with the app stay.
function deletePicture(w) {
  exec(USB_PY + " delete '" + w.name.replace(/'/g, "'\\''") + "'", function (res) {
    if (res.returnValue === false || (res.stdoutString || '').trim() !== 'ok') {
      showHint(t('deleteFailed')); setTimeout(function () { showHint(''); }, 3000); return;
    }
    var c = library();
    delete c.crops[w.name];
    c.pictureFolders.concat([favFolder()]).forEach(function (fo) {
      var at = fo.items.indexOf(w.name);
      if (at >= 0) fo.items.splice(at, 1);
    });
    if (c.wallpaper === w.name) c.wallpaper = '';   // the first picture takes over
    state.wallpapers = state.wallpapers.filter(function (x) { return x.name !== w.name; });
    saveConfig();
    applyLook();
    pop();                                           // the picture's options
    load();
  });
}

// Pictures as cards with ✓ = in the folder; OK adds or removes one.
function choosePictures(fo) {
  var el = pickerLayer(fo.name, t('framePickHint'));
  var grid = new Grid({
    container: el.querySelector('.grid'),
    decorate: function (tile, e) {
      tile.classList.add('pickable');
      tile.insertAdjacentHTML('beforeend', '<div class="badge">' + ICONS.check + '</div>');
      tile.classList.toggle('picked', fo.items.indexOf(e.key) >= 0);
    },
    onActivate: function (e, i) {
      var at = fo.items.indexOf(e.key);
      if (at >= 0) fo.items.splice(at, 1); else fo.items.push(e.key);
      saveConfig();
      grid.tiles()[i].classList.toggle('picked', at < 0);
    },
    onLongPress: function (e) { editCrop(e.wp); }
  });
  push(pickerView(el, grid));
  grid.set(state.wallpapers.map(function (w) {
    return { type: 'image', key: w.name, title: w.name.replace(/\.[a-z]+$/i, ''), url: picThumb(w), wp: w };
  }));
}

function editCrop(w) {
  cropPicture({ url: w.url, rect: cropOf(w.name), onSave: function (rect, img) {
    if (rect) library().crops[w.name] = rect; else delete library().crops[w.name];
    saveConfig();
    applyLook();
    cropThumb(w, rect, img);
  }, onCut: w.bundled ? null : function (rect, img, done) { cutPicture(w, rect, img, done); } });
}

// ✂ in the crop screen: the picture file is cut to the crop for good (after
// a confirmation), at full resolution, under the same name. Saves space when
// only the crop is worth keeping. The crop entry goes (the whole picture is
// now the crop) and the preview is made from the result.
function cutPicture(w, rect, img, done) {
  showHint(t('cutting'));
  var W = img.naturalWidth, H = img.naturalHeight;
  var sw = Math.round(rect.w * W), sh = Math.round(sw * 9 / 16);
  var c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  c.getContext('2d').drawImage(img, rect.x * W, rect.y * H, sw, sh, 0, 0, sw, sh);
  var b64 = c.toDataURL('image/jpeg', 0.92).split(',')[1];
  var thumb = document.createElement('canvas');
  thumb.width = 640; thumb.height = 360;
  thumb.getContext('2d').drawImage(c, 0, 0, 640, 360);
  var id = 'cut' + Date.now(), name = "'" + w.name.replace(/'/g, "'\\''") + "'";
  var CH = 100000, parts = [];   // one exec argument must stay < 128 KiB
  for (var i = 0; i < b64.length; i += CH) parts.push(b64.slice(i, i + CH));
  (function send(i) {
    if (i < parts.length) { exec(USB_PY + ' chunk ' + id + ' ' + parts[i], function () { send(i + 1); }); return; }
    exec(USB_PY + ' replace ' + id + ' ' + name, function (res) {
      if (res.returnValue === false || (res.stdoutString || '').trim() !== 'ok') {
        showHint(t('saveFailed')); setTimeout(function () { showHint(''); }, 3000); return;
      }
      delete library().crops[w.name];
      saveConfig();
      exec(USB_PY + ' thumbfor ' + name + ' ' + thumb.toDataURL('image/jpeg', 0.85).split(',')[1], function () {
        showHint('');
        if (done) done();
        load();
      });
    });
  })(0);
}

// The picture's preview card shows its crop (or the centre without one).
// Made from the full picture the crop screen has loaded; saved a moment
// after the last change, so − / + presses don't each write a file.
var thumbTimers = {};
function cropThumb(w, rect, img, done) {
  clearTimeout(thumbTimers[w.name]);
  thumbTimers[w.name] = setTimeout(function () {
    var W = img.naturalWidth, H = img.naturalHeight, fw = Math.min(W, H * 16 / 9);
    var r = rect || { x: (W - fw) / 2 / W, y: (H - fw * 9 / 16) / 2 / H, w: fw / W };
    var c = document.createElement('canvas');
    c.width = 640; c.height = 360;
    c.getContext('2d').drawImage(img, r.x * W, r.y * H, r.w * W, r.w * W * 9 / 16, 0, 0, 640, 360);
    var b64 = c.toDataURL('image/jpeg', 0.85).split(',')[1];
    exec(USB_PY + " thumbfor '" + w.name.replace(/'/g, "'\\''") + "' " + b64, function (res) {
      // t: the preview shows this crop (see catchUpThumbs)
      var cur = cropOf(w.name);
      if (cur && res.returnValue !== false) { cur.t = 1; saveConfig(); }
      if (done) done(); else load();
    });
  }, done ? 0 : 800);
}

// Crops made before previews followed them: remake those previews once, one
// picture at a time, when the picture library opens.
var catchingUp = false;
function catchUpThumbs() {
  if (catchingUp) return;
  var todo = state.wallpapers.filter(function (w) { var r = cropOf(w.name); return r && !r.t; });
  if (!todo.length) return;
  catchingUp = true;
  (function next(i) {
    if (i >= todo.length) { catchingUp = false; load(); return; }
    var img = new Image();
    img.onload = function () { cropThumb(todo[i], cropOf(todo[i].name), img, function () { img.src = ''; next(i + 1); }); };
    img.onerror = function () { next(i + 1); };
    img.src = todo[i].url;
  })(0);
}

// ---------------------------------------------------------------- usb pictures

var USB_PY = 'python3 ' + APP_DIR + 'usb.py';
var IMPORT_MAX = 18e6;   // pixels kept per imported picture (enough to pan at 4K)

function chooseUsbPicture(mode) {
  showHint(t('usbLoading'));
  exec(USB_PY + ' list', function (res) {
    showHint('');
    var list = [];
    try { list = JSON.parse(res.stdoutString || '[]'); } catch (e) {}
    if (!list.length) { showHint(t('usbNone')); setTimeout(function () { showHint(''); }, 3000); return; }
    var el = pickerLayer(t('fromUsb'), t('usbHint'));
    var grid = new Grid({
      container: el.querySelector('.grid'),
      onActivate: function (e) { cropPicture({ url: e.pic.url, name: e.pic.name, mode: mode, onSave: null }); }
    });
    push(pickerView(el, grid));
    grid.set(list.map(function (p, i) { return { type: 'image', key: 'usb' + i, title: p.name, url: p.url, pic: p }; }));
  });
}

// Import: the whole picture (scaled down to IMPORT_MAX) plus its crop and a
// preview of the crop go to the TV; a wallpaper import becomes the wallpaper.
function importPicture(pic, img, rect) {
  showHint(t('saving'));
  var W = img.naturalWidth, H = img.naturalHeight, s = Math.min(1, Math.sqrt(IMPORT_MAX / (W * H)));
  var full = document.createElement('canvas');
  full.width = Math.round(W * s); full.height = Math.round(H * s);
  full.getContext('2d').drawImage(img, 0, 0, full.width, full.height);
  var thumb = document.createElement('canvas');
  thumb.width = 640; thumb.height = 360;
  thumb.getContext('2d').drawImage(img, rect.x * W, rect.y * H, rect.w * W, rect.w * W * 9 / 16, 0, 0, 640, 360);
  var id = String(Date.now());
  var name = (pic.name || 'picture').replace(/\.[a-z]+$/i, '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30) + '-' + id.slice(-5);
  var b64 = full.toDataURL('image/jpeg', 0.9).split(',')[1];
  var CH = 100000, parts = [];   // one exec argument must stay < 128 KiB (MAX_ARG_STRLEN)
  for (var i = 0; i < b64.length; i += CH) parts.push(b64.slice(i, i + CH));
  (function send(i) {
    if (i < parts.length) { exec(USB_PY + ' chunk ' + id + ' ' + parts[i], function () { send(i + 1); }); return; }
    exec(USB_PY + ' finish ' + id + ' ' + name, function (res) {
      var file = (res.stdoutString || '').trim();
      if (!file) { showHint(t('saveFailed')); setTimeout(function () { showHint(''); }, 3000); return; }
      exec(USB_PY + ' thumb ' + name + ' ' + thumb.toDataURL('image/jpeg', 0.85).split(',')[1], function () {
        showHint('');
        library().crops[file] = rect;
        if (pic.mode.wallpaper) cfg().wallpaper = file;
        saveConfig();
        closeAll();
        load();
      });
    });
  })(0);
}

// Crop screen: a 16:9 frame over the whole picture. It starts in the bar
// (Smaller, Larger, sharpness, Reset, i); Up moves to the frame, where the
// arrows move it, OK saves and Back cancels (both back to the bar). The label says how sharp the crop is on the 4K screen.
// pic: {url, rect?, onSave(rect or null, img)} for a picture in the library, or
// {url, name, mode} from USB (OK in the frame imports it).
function cropPicture(pic) {
  var probe = new Image();
  probe.onload = function () { openCrop(pic, probe); };
  probe.onerror = function () { showHint(t('saveFailed')); setTimeout(function () { showHint(''); }, 3000); };
  probe.src = pic.url;
}

function openCrop(pic, probe) {
  var W = probe.naturalWidth, H = probe.naturalHeight;
  var el = layer('cropView');
  el.innerHTML = '<div class="stage"><img alt=""><div class="frame"></div></div>' +
    '<div class="cropbar"><div class="pill" data-a="minus">−</div><div class="pill" data-a="plus">+</div>' +
    '<div class="pill" data-a="sharp"></div><div class="pill" data-a="reset"></div>' +
    (pic.onCut ? '<div class="pill cut" data-a="cut">✂</div>' : '') + '<div class="pill i" data-a="info">i</div></div>' +
    '<div class="crophint"></div>';
  var img = el.querySelector('img'), frameEl = el.querySelector('.frame');
  var pills = [].slice.call(el.querySelectorAll('.cropbar .pill'));
  var AREA_W = 1760, AREA_H = 880;
  var k = Math.min(AREA_W / W, AREA_H / H);          // picture px -> screen px
  var ox = (1920 - W * k) / 2, oy = 60 + (AREA_H - H * k) / 2;
  img.style.cssText = 'left:' + ox + 'px;top:' + oy + 'px;width:' + W * k + 'px;height:' + H * k + 'px';
  img.src = pic.url;
  var f;
  function centre() { var fw = Math.min(W, H * 16 / 9); f = { w: fw, x: (W - fw) / 2, y: (H - fw * 9 / 16) / 2 }; }
  centre();
  if (pic.rect) f = { w: pic.rect.w * W, x: pic.rect.x * W, y: pic.rect.y * H };
  // Starts in the bar. Up: the frame (arrows move it); OK there saves and
  // goes back to the bar, Back goes back without saving.
  var focus = 0, barFocus = 0;                        // focus -1 = frame, else pill index
  var saved = { w: f.w, x: f.x, y: f.y };

  function clamp() {
    f.w = Math.max(Math.min(W, H * 16 / 9, f.w), Math.min(W, 480));
    f.x = Math.max(0, Math.min(W - f.w, f.x));
    f.y = Math.max(0, Math.min(H - f.w * 9 / 16, f.y));
  }
  function paint() {
    clamp();
    frameEl.style.cssText = 'left:' + (ox + f.x * k) + 'px;top:' + (oy + f.y * k) + 'px;width:' + f.w * k +
      'px;height:' + f.w * 9 / 16 * k + 'px';
    frameEl.classList.toggle('sel', focus < 0);
    pills.forEach(function (p, i) { p.classList.toggle('sel', i === focus); });
    // An imported picture keeps up to IMPORT_MAX pixels, so judge that size.
    var keep = pic.onSave ? 1 : Math.min(1, Math.sqrt(IMPORT_MAX / (W * H)));
    var px = f.w * keep;
    pills[2].textContent = px >= 3840 * 0.99 ? '4K' : t('upscaled', Math.round((3840 / px - 1) * 100));
    pills[3].textContent = t('wholePicture');
    el.querySelector('.crophint').innerHTML = hintHTML(t('cropHint', W + '×' + H) + '  ·  ' +
      (focus < 0 ? t('cropKeysFrame') : t('cropKeysBar')));
  }
  function resize(factor) {
    var cx = f.x + f.w / 2, cy = f.y + f.w * 9 / 32;
    f.w *= factor;
    clamp();
    f.x = cx - f.w / 2; f.y = cy - f.w * 9 / 32;
    paint();
  }
  function rect() { return { x: f.x / W, y: f.y / H, w: f.w / W, r: W / H }; }
  function toBar() { focus = barFocus; paint(); }
  // Library picture: store the crop. USB picture: import it with this crop.
  function save() {
    if (!pic.onSave) { importPicture(pic, img, rect()); return; }
    saved = { w: f.w, x: f.x, y: f.y };
    pic.onSave(rect(), img);
    toBar();
  }
  function act(a) {
    if (a === 'minus' || a === 'plus') {
      resize(a === 'minus' ? 0.9 : 1 / 0.9);
      if (pic.onSave) { saved = { w: f.w, x: f.x, y: f.y }; pic.onSave(rect(), img); }
    } else if (a === 'reset') {
      centre(); paint();
      saved = { w: f.w, x: f.x, y: f.y };
      if (pic.onSave) pic.onSave(null, img);
    } else if (a === 'cut') {
      confirmSheet(t('cutQ'), t('cutSub'), t('cutYes'), function () {
        pic.onCut(rect(), img, function () { if (stack[stack.length - 1] === view) pop(); });
      });
    } else if (a === 'info') toggleLegend('crop', true);
  }

  var view = { el: el };
  view.key = function (e) {
    var c = e.keyCode, step = W * 0.015;
    if (focus < 0) {
      if (c === KEY.LEFT) f.x -= step; else if (c === KEY.RIGHT) f.x += step;
      else if (c === KEY.UP) f.y -= step; else if (c === KEY.DOWN) f.y += step;
      else if (c === KEY.BACK) { f = { w: saved.w, x: saved.x, y: saved.y }; toBar(); return; }
    } else {
      if (c === KEY.LEFT) focus = (focus + pills.length - 1) % pills.length;
      else if (c === KEY.RIGHT) focus = (focus + 1) % pills.length;
      else if (c === KEY.UP) { barFocus = focus; focus = -1; }
      else if (c === KEY.BACK) { pop(); return; }
    }
    paint();
  };
  view.ok = function () {
    if (!once()) return;
    if (focus < 0) save(); else act(pills[focus].getAttribute('data-a'));
  };
  // Magic Remote: drag the frame, wheel resizes, click the pills.
  var drag = null;
  frameEl.addEventListener('mousedown', function (e) {
    drag = { x: e.clientX, y: e.clientY, fx: f.x, fy: f.y };
    if (focus >= 0) barFocus = focus;
    focus = -1; paint();
  });
  el.addEventListener('mousemove', function (e) {
    if (!drag) return;
    f.x = drag.fx + (e.clientX - drag.x) / k; f.y = drag.fy + (e.clientY - drag.y) / k; paint();
  });
  // Releasing a drag saves, like OK (a library picture; a USB one waits for OK).
  el.addEventListener('mouseup', function () {
    if (drag && pic.onSave && once()) save();
    drag = null;
  });
  el.addEventListener('wheel', function (e) {
    e.stopPropagation();
    if (focus >= 0) { barFocus = focus; focus = -1; }
    resize(e.deltaY > 0 ? 0.92 : 1 / 0.92);
  });
  pills.forEach(function (p, i) {
    p.addEventListener('mouseenter', function () { focus = i; paint(); });
    p.addEventListener('click', function () { focus = i; paint(); if (once()) act(p.getAttribute('data-a')); });
  });
  push(view);
  paint();
}


// ---------------------------------------------------------------- input

function showHint(text) {
  var h = document.getElementById('hint');
  h.innerHTML = hintHTML(text);
  h.style.display = text ? 'block' : 'none';
}

function showMsg(text) {
  var m = document.getElementById('msg');
  m.textContent = text || '';
  m.style.display = text ? 'block' : 'none';
}

function current() {
  return stack.length ? stack[stack.length - 1] : mainView;
}

var mainView = {
  key: function (e) {
    var k = e.keyCode;
    if (claim('key', e)) return;          // a module's own row (Plex)
    if (topFocus >= 0) {
      var n = topButtons().length;
      if (k === KEY.LEFT) focusTop(Math.max(0, topFocus - 1));
      else if (k === KEY.RIGHT) focusTop(Math.min(n - 1, topFocus + 1));
      else if (k === KEY.DOWN || k === KEY.BACK) leaveTop();
      return;
    }
    // Up from the first row goes to the top-left buttons.
    if (k === KEY.UP && mainGrid.moving < 0 && mainGrid.focus < COLS) { focusTop(0); return; }
    if (mainGrid.key(e)) return;
    if (e.keyCode === KEY.BACK) {
      if (editMode) { setEditMode(false); return; }
      var row = Math.floor(mainGrid.focus / COLS);
      if (row > 0) mainGrid.setFocus(mainGrid.focus % COLS);
    }
  },
  ok: function () {
    if (topFocus >= 0) { var b = topButtons()[topFocus]; if (b && once()) b.action(); return; }
    if (claim('ok')) return;
    if (!mainGrid.entries.length) { load(); return; }
    mainGrid.activate(mainGrid.focus);
  },
  longOk: function () {
    if (claim('longOk')) return;
    if (topFocus < 0) { mainGrid.longPress(mainGrid.focus); return; }
    var b = topButtons()[topFocus];
    if (b && b.longAction && once()) b.longAction();
  }
};

// OK is handled on keyup so a long hold can open the options instead.
var okTimer = null, okLong = false, okDown = false;
document.addEventListener('keydown', function (e) {
  lastKeyAt = Date.now();
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  var v = current();
  // A module that takes every key while its view is on top (the Picture Frame).
  if (claim('keydown', e, v)) { e.preventDefault(); return; }
  if (e.keyCode === KEY.OK) {
    e.preventDefault();
    if (okDown) return; // auto-repeat while held
    okDown = true; okLong = false;
    var inMove = (v.grid || (v === mainView && mainGrid)) && (v.grid || mainGrid).moving >= 0;
    if (v.longOk && !inMove) {
      okTimer = setTimeout(function () { okTimer = null; okLong = true; v.longOk(); }, LONG_PRESS_MS);
    }
    return;
  }
  if (e.keyCode >= 37 && e.keyCode <= 40 || e.keyCode === KEY.BACK) {
    e.preventDefault();
    v.key(e);
  }
});

document.addEventListener('keyup', function (e) {
  if (e.keyCode !== KEY.OK) return;
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  e.preventDefault();
  var wasDown = okDown;
  okDown = false;
  if (okTimer) { clearTimeout(okTimer); okTimer = null; }
  if (wasDown && !okLong) current().ok();
});

document.addEventListener('wheel', function (e) {
  var v = current();
  var grid = v === mainView ? mainGrid : v.grid;
  if (grid) grid.setFocus(grid.focus + (e.deltaY > 0 ? grid.cols() : -grid.cols()));
  else if (v.key) v.key({ keyCode: e.deltaY > 0 ? KEY.DOWN : KEY.UP });
});

document.addEventListener('webOSRelaunch', function () {
  if (launchParams().bench) { setTimeout(bench, 500); return; }
  // A launch meant for a module (the Picture Frame: {frame: true}).
  if (claim('relaunch', launchParams())) return;
  // Home pressed again: back to a clean home screen.
  closeAll();
  if (mainGrid.moving >= 0) mainGrid.endMove();
  if (editMode) setEditMode(false);
  topFocus = -1;
  hook('reset');
  renderTop();
  mainGrid.setFocus(0, true);
  load();
});

// Shown again: reload. Modules hear both (the Picture Frame ends when hidden).
// Hidden: a pending save goes out now, before an app takes over.
document.addEventListener('visibilitychange', function () {
  if (document.hidden) flushConfig();
  hook('visibility', !document.hidden);
  if (!document.hidden) load();
});

// ---------------------------------------------------------------- loading

function adopt(data, fromDisk) {
  var changed = false;
  if (JSON.stringify(data.launchPoints) !== JSON.stringify(state.launchPoints)) {
    state.launchPoints = data.launchPoints; changed = true;
  }
  if (data.installed && JSON.stringify(data.installed) !== JSON.stringify(state.installed)) {
    state.installed = data.installed; changed = true;
  }
  if (data.glass) state.glass = data.glass;
  if (data.versions) state.versions = data.versions;
  if (JSON.stringify(data.wallpapers) !== JSON.stringify(state.wallpapers)) {
    state.wallpapers = data.wallpapers; changed = true;
  }
  // The disk config wins, unless a save is still pending.
  if (fromDisk && data.config && !saveTimer && !savesInFlight && JSON.stringify(normalizeConfig(data.config)) !== JSON.stringify(state.config)) {
    state.config = normalizeConfig(data.config); changed = true;
  }
  if (!state.config) { state.config = normalizeConfig(data.config); changed = true; }
  return changed;
}

function load() {
  hook('load');
  exec('sh ' + APP_DIR + 'launchpoints.sh', function (res) {
    var data = null;
    try { data = JSON.parse(res.stdoutString || ''); } catch (e) {}
    haveApps = true;
    if (!data || !data.launchPoints) {
      if (!mainGrid.entries.length) showMsg(t('loadFailed'));
      return;
    }
    showMsg('');
    var changed = adopt(data, true);
    hook('loaded');
    setTimeout(makeLogos, 0);
    if (changed && mainGrid.moving < 0 && !stack.length) refreshMain();
    else if (changed) applyLook();
    persistLocal();
  });
}

// ---------------------------------------------------------------- bench

// Launched with {"bench": true}: scripted navigation while recording frame
// times; results go to /tmp/atvhome-bench.txt (for tuning on the real TV).
function launchParams() {
  try { return JSON.parse((window.PalmSystem && PalmSystem.launchParams) || '{}') || {}; } catch (e) { return {}; }
}

function bench() {
  closeAll();
  if (editMode) setEditMode(false);
  if (topFocus >= 0) leaveTop();
  mainGrid.setFocus(0, true);
  var seq = [];
  for (var r = 0; r < 2; r++) {
    seq.push(39, 39, 39, 39, 40, 37, 37, 37, 37, 40, 39, 39, 38, 38);
  }
  var frames = [], last = 0, running = true, lastKey = 0, janks = [];
  function frame(ts) {
    if (last) { frames.push(ts - last); if (ts - last > 25) janks.push(lastKey + '@' + (i - 1)); }
    last = ts;
    if (running) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  var i = 0;
  var timer = setInterval(function () {
    if (i >= seq.length) {
      clearInterval(timer);
      setTimeout(function () {
        running = false;
        var sorted = frames.slice().sort(function (a, b) { return a - b; });
        function pct(p) { return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(1); }
        var total = frames.reduce(function (a, b) { return a + b; }, 0);
        var jank = frames.filter(function (f) { return f > 25; }).length;
        var line = 'v' + VERSION + ' frames=' + frames.length + ' fps=' + (frames.length / total * 1000).toFixed(1) +
          ' p50=' + pct(0.5) + 'ms p95=' + pct(0.95) + 'ms max=' + sorted[sorted.length - 1].toFixed(1) +
          'ms jank(>25ms)=' + jank + ' after=' + janks.join(',');
        exec('echo "' + line + '" >> /tmp/atvhome-bench.txt');
        mainGrid.setFocus(0, true);
      }, 800);
      return;
    }
    lastKey = seq[i];
    mainView.key({ keyCode: seq[i++] });
  }, 180);
}

function tick() {
  var d = new Date();
  document.getElementById('clock').textContent =
    ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}

mainGrid = new Grid({
  container: document.getElementById('grid'),
  onActivate: onMainActivate,
  onLongPress: onMainLongPress,
  onRow: function (row) {
    hook('leave');
    if (topFocus >= 0) {
      topFocus = -1;
      var els = document.getElementById('topbar').children;
      for (var j = 0; j < els.length; j++) els[j].classList.remove('focus');
    }
    scrollMain(row);
  },
  onMove: function (entries) { saveOrderFrom(entries); }
});

// ---------------------------------------------------------------- first paint

// The page starts under a black cover (#cover) that fades out once the first
// screen is complete: the wallpaper loaded and every card's logo drawn. At
// boot the TV is busy for a while, and without it the wallpaper and the cards
// filled in one by one. Images TV Home draws from (probes, not in the page)
// are counted with track(); <img> elements in the page are checked directly.
var revealed = false, pendingImages = 0, haveApps = false;

function track(img) {
  if (revealed) return img;
  pendingImages++;
  var onload = img.onload, onerror = img.onerror, counted = true;
  function done() { if (counted) { counted = false; pendingImages--; } }
  img.onload = function () { done(); if (onload) return onload.apply(this, arguments); };
  img.onerror = function () { done(); if (onerror) return onerror.apply(this, arguments); };
  return img;
}

function reveal() {
  var t0 = Date.now(), calm = 0;
  function ready() {
    if (!haveApps || pendingImages) return false;
    var imgs = document.images;
    for (var i = 0; i < imgs.length; i++) if (imgs[i].getAttribute('src') && !imgs[i].complete) return false;
    return true;
  }
  (function check() {
    // Two calm checks in a row: a loaded probe may start the next one.
    calm = ready() ? calm + 1 : 0;
    if (calm < 2 && Date.now() - t0 < 12000) { setTimeout(check, 100); return; }
    // Two frames, so the decoded pictures are on screen before the fade.
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      revealed = true;
      var cover = document.getElementById('cover');
      cover.classList.add('gone');
      setTimeout(function () { cover.style.display = 'none'; }, 400);
      exec('echo "$(date +%T) up $(cut -d" " -f1 /proc/uptime)s: shown after ' + (Date.now() - t0) +
           ' ms' + (calm < 2 ? ' (gave up waiting)' : '') + '" >> /tmp/atvhome-firstpaint.txt');
    }); });
  })();
}

// Called by index.html once app.js and modules.js are loaded, so the first
// paint already has the modules' cards, buttons and texts.
function start() {
  tick();
  setInterval(tick, 10000);

  try {
    var cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached && cached.launchPoints) {
      state.launchPoints = cached.launchPoints;
      state.wallpapers = cached.wallpapers || [];
      state.installed = cached.installed || [];
      state.glass = cached.glass || {};
      state.versions = cached.versions || {};
      state.config = normalizeConfig(cached.config);
      refreshMain();
      haveApps = true;
    }
  } catch (e) {}
  if (!state.config) state.config = normalizeConfig(null);
  applyLook();
  load();
  hook('start', launchParams());
  reveal();
}
