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
// and Light. The Magic Remote works too: hover, click, click and hold, wheel.

var APP_ID = 'com.iso.atvhome';
var APP_DIR = '/media/developer/apps/usr/palm/applications/' + APP_ID + '/';
var VERSION = '0.18.0';
var COLS = 5;
var ROW_H = 264;
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
  order: [],      // top-level keys: app keys and folder ids, in display order
  folders: {},    // id -> { name, items: [app keys] }
  hidden: [],     // keys of LG launch points taken off the home screen
  added: [],      // keys of installed apps without a launch point, put on it
  frame: { pictures: null, every: 5, bri: 60 }   // picture frame (null = all wallpapers)
};
// Never offered for uninstall: losing these loses root / the launcher itself.
var PROTECTED = /^(com\.iso\.|org\.webosbrew\.)/;

var state = { launchPoints: [], installed: [], wallpapers: [], config: null };
var editMode = false;
var topFocus = -1;      // focused top-left button, -1 = focus is in the grid
var LIGHT_APP = 'com.iso.moviescene';
var LIGHT_SCRIPT = '/media/developer/apps/usr/palm/applications/' + LIGHT_APP + '/scene.sh';
var lightFlash = '';    // '', 'ok' or 'err': ring around the Light button
var lightCinema = false; // cinema scene active (button glows)
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
// config from disk.
var saveTimer = null, savesInFlight = 0;
function saveConfig() {
  persistLocal();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    saveTimer = null;
    var json = JSON.stringify(state.config);
    var b64 = btoa(unescape(encodeURIComponent(json)));
    savesInFlight++;
    exec('sh ' + APP_DIR + 'config.sh save ' + b64, function () { savesInFlight--; });
  }, 400);
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

function normalizeConfig(c) {
  var out = clone(DEFAULT_CONFIG);
  if (c && typeof c === 'object') {
    for (var k in out) if (c[k] !== undefined) out[k] = c[k];
  }
  return out;
}

// ---------------------------------------------------------------- i18n

// English is the default; German is selectable in the settings.
var STRINGS = {
  en: {
    settings: 'Settings', settingsTitle: 'Home Screen', language: 'Language',
    wallpaper: 'Wallpaper',
    none: 'None',
    newFolder: 'New Folder',
    editHome: 'Organize Apps', light: 'Light', addApps: 'Add Apps', homeAppsTitle: 'Apps on the home screen', appPick: 'App …',
    editHint: 'Editing: OK on an app or folder for options · Back to finish (changes are saved)',
    removeFromHome: 'Remove from Home Screen',
    uninstall: 'Uninstall', uninstallApps: 'Uninstall Apps', uninstallSub: 'Apps that can be removed from the TV.',
    uninstallQ: 'Uninstall {0}?', uninstallNQ: 'Uninstall {0} apps?', uninstallYes: 'Uninstall',
    uninstallWarn: 'The app and its data are removed. To reinstall it, unlock App-Updates and use the LG Content Store.',
    uninstalling: 'Uninstalling {0} …', uninstalled: '{0} was uninstalled.', uninstallFailed: 'Could not uninstall {0}.',
    noUninstall: 'No apps can be uninstalled.',
    showClock: 'Show Clock', on: 'On', off: 'Off',
    reset: 'Reset Layout', resetQ: 'Reset layout?',
    resetSub: 'Folders, order and the app selection are reset. The wallpaper stays.', resetYes: 'Reset',
    tip: 'Apps and folders: use Organize Apps (top left) to arrange, add, group, uninstall or reset. Holding OK on an app works anywhere.',
    move: 'Move', rename: 'Rename', open: 'Open', cancel: 'Cancel',
    toFolder: 'Add to Folder', toOtherFolder: 'Move to Another Folder', removeFromFolder: 'Remove from Folder',
    chooseApps: 'Choose Apps', checkHint: 'OK checks or unchecks an app.',
    dissolve: 'Remove Folder', dissolveQ: 'Remove folder?', dissolveSub: 'Its apps go back to the home screen.', dissolveYes: 'Remove',
    renameFolder: 'Rename Folder', nApps: '{0} apps', emptySuffix: '(empty)',
    folderEmpty: 'This folder is empty. Hold OK on an app and choose "Add to Folder".',
    inputHint: 'Enter a name, then OK / Enter. Back cancels.',
    moveHint: 'Use the arrow keys to move, OK to drop',
    loadFailed: 'Could not load apps. Press OK to retry.',
    fromUsb: 'From USB …', wpHint: 'OK: use · hold OK: crop', usbLoading: 'Looking for pictures on USB …', usbNone: 'No pictures (JPG/PNG) found on a USB stick.',
    cropHint: 'Picture {0} · best: 3840×2160 (16:9)', cropKeysFrame: 'Arrows: move · OK: options',
    cropKeysBar: 'Up: back to the frame', save: 'Save', saving: 'Saving wallpaper …', saveFailed: 'Could not save the wallpaper.',
    resetButtons: 'Reset', resetButtonsQ: 'Reset all buttons to LG default?',
    appStore: 'App Store', storeLocked: 'Locked', storeOpen: 'Open · {0} min',
    frame: 'Picture Frame', frameStart: 'Start', framePictures: 'Pictures', frameAll: 'All',
    frameEvery: 'Change every', frameHow: 'Any button on the remote ends it.', framePickHint: 'OK: show / skip',
    frameNone: 'Add a wallpaper first.', minutes: '{0} min', hour: '1 hour',
    hue: 'Hue', hueHint: 'OK: on / off · hold OK: room', hueConnecting: 'Connecting to Hue …',
    hueFailed: 'The Hue bridge is not reachable.', hueIp: 'IP address of the Hue bridge',
    huePress: 'Press the button on the Hue bridge', huePressSub: 'Waiting up to 60 seconds.',
    huePaired: 'Hue connected.', lightButton: 'Light button', power: 'Power', brightness: 'Brightness',
    scenes: 'Scenes', lights: 'Lights', room: 'Room', cinemaScene: 'Cinema scene', backTo: 'Back to',
    backPrevious: 'Lighting before cinema', lightHow: 'One press: cinema. Next press: {0}.',
    notSet: 'Not set', unreachable: 'unreachable',
    remoteButtons: 'Remote Buttons', remoteTip: 'Arrows or pointer: pick a button · OK: change it · Back: close', otherButton: 'Other button …',
    remoteOff: 'Remote mapper', remoteMissing: 'The remote mapper is not installed on this TV (install.sh → remote buttons).',
    learnSub: 'Press any button on the remote now …', learnNone: 'No button pressed. Try again.',
    learnBlocked: 'This button can\'t be changed (needed to control the TV).',
    lgDefault: 'LG default', doNothing: 'Do nothing', actions: 'Actions', appsHead: 'Apps',
    tvHome: 'Home screen (TV Home)', liveTv: 'Live TV', hdmi: 'HDMI {0}', button: 'Button {0}',
    saved: 'Saved. Works right away.',
    b_mic: 'Mic', b_input: 'Input', b_list: 'List', b_more: '··· (more)',
    b_red: 'Red', b_green: 'Green', b_yellow: 'Yellow', b_blue: 'Blue',
    b_chup: 'Channel +', b_chdown: 'Channel −'
  },
  de: {
    settings: 'Einstellungen', settingsTitle: 'Startbildschirm', language: 'Sprache',
    wallpaper: 'Hintergrundbild',
    none: 'Keines',
    newFolder: 'Neuer Ordner',
    editHome: 'Apps organisieren', light: 'Licht', addApps: 'Apps hinzufügen', homeAppsTitle: 'Apps auf dem Startbildschirm', appPick: 'App …',
    editHint: 'Bearbeiten: OK auf einer App oder einem Ordner für Optionen · Zurück zum Beenden (wird gespeichert)',
    removeFromHome: 'Vom Startbildschirm entfernen',
    uninstall: 'Deinstallieren', uninstallApps: 'Apps deinstallieren', uninstallSub: 'Apps, die vom Fernseher entfernt werden können.',
    uninstallQ: '{0} deinstallieren?', uninstallNQ: '{0} Apps deinstallieren?', uninstallYes: 'Deinstallieren',
    uninstallWarn: 'Die App und ihre Daten werden entfernt. Zum Neu-Installieren App-Updates entsperren und den LG Content Store nutzen.',
    uninstalling: '{0} wird deinstalliert …', uninstalled: '{0} wurde deinstalliert.', uninstallFailed: '{0} konnte nicht deinstalliert werden.',
    noUninstall: 'Keine Apps können deinstalliert werden.',
    showClock: 'Uhr anzeigen', on: 'An', off: 'Aus',
    reset: 'Anordnung zurücksetzen', resetQ: 'Anordnung zurücksetzen?',
    resetSub: 'Ordner, Reihenfolge und App-Auswahl werden zurückgesetzt. Das Hintergrundbild bleibt.', resetYes: 'Zurücksetzen',
    tip: 'Apps und Ordner: Mit „Apps organisieren“ (oben links) anordnen, hinzufügen, gruppieren, deinstallieren oder zurücksetzen. Lange OK auf einer App geht überall.',
    move: 'Verschieben', rename: 'Umbenennen', open: 'Öffnen', cancel: 'Abbrechen',
    toFolder: 'In Ordner legen', toOtherFolder: 'In anderen Ordner legen', removeFromFolder: 'Aus Ordner nehmen',
    chooseApps: 'Apps auswählen', checkHint: 'OK hakt eine App an oder ab.',
    dissolve: 'Ordner auflösen', dissolveQ: 'Ordner auflösen?', dissolveSub: 'Die Apps kommen zurück auf den Startbildschirm.', dissolveYes: 'Auflösen',
    renameFolder: 'Ordner umbenennen', nApps: '{0} Apps', emptySuffix: '(leer)',
    folderEmpty: 'Dieser Ordner ist leer. Lange OK auf einer App drücken → „In Ordner legen“.',
    inputHint: 'Namen eingeben, dann OK / Enter. Zurück bricht ab.',
    moveHint: 'Mit den Pfeiltasten verschieben, OK zum Ablegen',
    loadFailed: 'Apps konnten nicht geladen werden. OK drücken zum Wiederholen.',
    fromUsb: 'Von USB …', wpHint: 'OK: verwenden · OK halten: zuschneiden', usbLoading: 'Suche Bilder auf USB …', usbNone: 'Keine Bilder (JPG/PNG) auf einem USB-Stick gefunden.',
    cropHint: 'Bild {0} · ideal: 3840×2160 (16:9)', cropKeysFrame: 'Pfeile: verschieben · OK: Optionen',
    cropKeysBar: 'Hoch: zurück zum Rahmen', save: 'Speichern', saving: 'Hintergrund wird gespeichert …', saveFailed: 'Hintergrund konnte nicht gespeichert werden.',
    resetButtons: 'Zurücksetzen', resetButtonsQ: 'Alle Tasten auf LG-Standard zurücksetzen?',
    appStore: 'App Store', storeLocked: 'Gesperrt', storeOpen: 'Offen · {0} Min.',
    frame: 'Bilderrahmen', frameStart: 'Starten', framePictures: 'Bilder', frameAll: 'Alle',
    frameEvery: 'Wechsel alle', frameHow: 'Jede Taste der Fernbedienung beendet ihn.', framePickHint: 'OK: zeigen / auslassen',
    frameNone: 'Zuerst ein Hintergrundbild hinzufügen.', minutes: '{0} Min.', hour: '1 Stunde',
    hue: 'Hue', hueHint: 'OK: an / aus · OK halten: Raum', hueConnecting: 'Verbinde mit Hue …',
    hueFailed: 'Die Hue Bridge ist nicht erreichbar.', hueIp: 'IP-Adresse der Hue Bridge',
    huePress: 'Den Knopf auf der Hue Bridge drücken', huePressSub: 'Wartet bis zu 60 Sekunden.',
    huePaired: 'Hue verbunden.', lightButton: 'Licht-Taste', power: 'Ein / Aus', brightness: 'Helligkeit',
    scenes: 'Szenen', lights: 'Lampen', room: 'Raum', cinemaScene: 'Kino-Szene', backTo: 'Zurück zu',
    backPrevious: 'Licht vor dem Kino', lightHow: 'Einmal drücken: Kino. Nochmal: {0}.',
    notSet: 'Nicht gesetzt', unreachable: 'nicht erreichbar',
    remoteButtons: 'Fernbedienungstasten', remoteTip: 'Pfeile oder Zeiger: Taste wählen · OK: ändern · Zurück: schließen', otherButton: 'Andere Taste …',
    remoteOff: 'Tastenbelegung', remoteMissing: 'Die Tastenbelegung ist auf diesem Fernseher nicht installiert (install.sh → Fernbedienung).',
    learnSub: 'Jetzt eine Taste auf der Fernbedienung drücken …', learnNone: 'Keine Taste gedrückt. Nochmal versuchen.',
    learnBlocked: 'Diese Taste kann nicht geändert werden (wird zur Bedienung gebraucht).',
    lgDefault: 'LG-Standard', doNothing: 'Nichts tun', actions: 'Aktionen', appsHead: 'Apps',
    tvHome: 'Startbildschirm (TV Home)', liveTv: 'Live-TV', hdmi: 'HDMI {0}', button: 'Taste {0}',
    saved: 'Gespeichert. Wirkt sofort.',
    b_mic: 'Mikrofon', b_input: 'Eingang', b_list: 'Liste', b_more: '··· (mehr)',
    b_red: 'Rot', b_green: 'Grün', b_yellow: 'Gelb', b_blue: 'Blau',
    b_chup: 'Kanal +', b_chdown: 'Kanal −'
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
      title: lp.title || lp.id, icon: lp._icon || '', tile: lp._tile || '', color: cardColor(lp)
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
        title: a.title, icon: a._icon || '', tile: a._tile || '', color: cardColor(a)
      });
      appOrder.push(key);
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
    var ctx = sampler.getContext('2d');
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

function iconInto(el, app) {
  el.style.setProperty('--c', app.color);
  if (!app.icon) return;
  var img = document.createElement('img');
  img.alt = '';
  img.onload = function () { bleed(el, img); };
  img.onerror = function () { img.style.display = 'none'; };
  img.src = app.icon;
  el.insertBefore(img, el.firstChild);
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
  light: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M9 21a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1H9v1zm3-19a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2z"/></svg>'
};
var GEAR = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>';

function renderTile(entry) {
  var tile = document.createElement('div');
  tile.className = 'tile';
  var card = document.createElement('div');
  card.className = 'card';
  var label = document.createElement('div');
  label.className = 'label';

  if (entry.type === 'room') {
    card.classList.add('room');
    card.classList.toggle('lit', entry.room.on);
    card.style.setProperty('--glow', entry.room.on ? (0.35 + entry.room.bri / 160).toFixed(2) : 0);
    card.innerHTML = ICONS.light + '<div class="rname"></div><div class="pct"></div><div class="gloss"></div>';
    card.querySelector('.rname').textContent = entry.title;
    card.querySelector('.pct').textContent = entry.room.on ? entry.room.bri + '%' : t('off');
    label.textContent = entry.title;
  } else if (entry.type === 'image') {
    card.classList.add('art');
    card.innerHTML = '<img alt=""><div class="gloss"></div>';
    card.querySelector('img').src = entry.url;
    label.textContent = entry.title;
  } else if (entry.type === 'app' && entry.tile) {
    // Sharp full-card artwork (tiles/<appId>.png) instead of the LG icon.
    card.classList.add('art');
    card.innerHTML = '<img alt=""><div class="gloss"></div>';
    card.querySelector('img').src = entry.tile;
    label.textContent = entry.title;
  } else if (entry.type === 'app') {
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
        m.querySelector('img').src = app.tile;
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
  buildApps();
  mainGrid.set(mainEntries(), keepKey);
  renderTop();
  applyLook();
}

// ---------------------------------------------------------------- top buttons

function topButtons() {
  var b = [
    { icon: GEAR, title: t('settings'), action: openSettings },
    { icon: ICONS.apps, title: t('editHome'), action: function () { setEditMode(!editMode); } }
  ];
  if (hasLight()) b.push({ icon: ICONS.light, title: t('light'), light: true, action: toggleLight, longAction: openHue });
  return b;
}

function renderTop() {
  var bar = document.getElementById('topbar');
  var buttons = topButtons();
  bar.innerHTML = '';
  buttons.forEach(function (btn, i) {
    var el = document.createElement('div');
    el.className = 'tbtn' + (i === topFocus ? ' focus' : '') + (i === 1 && editMode ? ' on' : '') +
      (btn.light && lightFlash ? ' flash-' + lightFlash : '') + (btn.light && lightCinema ? ' cinema' : '');
    el.innerHTML = btn.icon + '<div class="tlabel"></div>';
    el.querySelector('.tlabel').textContent = btn.title;
    el.addEventListener('mouseenter', function () { focusTop(i); });
    pressable(el, function () { focusTop(i); if (once()) btn.action(); },
      function () { focusTop(i); if (btn.longAction && once()) btn.longAction(); });
    bar.appendChild(el);
  });
  if (topFocus >= buttons.length) topFocus = buttons.length - 1;
}

// Toggles the Hue movie scene directly (no app launch / toast); the Light
// button shows a brief green ring on success, red if the bridge failed.
var lightTimer = null;
function toggleLight() {
  setLightFlash('ok');
  exec('sh ' + LIGHT_SCRIPT, function (res) {
    var out = (res.stdoutString || '').trim();
    var ok = res.returnValue !== false && (out === 'movie' || out === 'restored');
    if (!ok && /not set up|KEY|BRIDGE/.test(res.stderrString || '')) { setLightFlash(''); openHue(); return; }
    if (ok) { lightCinema = out === 'movie'; renderTop(); }
    setLightFlash(ok ? 'ok' : 'err');
    clearTimeout(lightTimer);
    lightTimer = setTimeout(function () { setLightFlash(''); }, 1200);
  });
}

function setLightFlash(state) {
  lightFlash = state;
  var buttons = topButtons(), els = document.getElementById('topbar').children;
  buttons.forEach(function (b, i) {
    if (!b.light || !els[i]) return;
    els[i].classList.remove('flash-ok', 'flash-err');
    if (state) els[i].classList.add('flash-' + state);
  });
}

function focusTop(i) {
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

function applyLook() {
  var c = cfg();
  var wall = document.getElementById('wall');
  var wp = null;
  state.wallpapers.forEach(function (w) { if (w.name === c.wallpaper) wp = w; });
  if (!wp && c.wallpaper !== 'none' && state.wallpapers.length) wp = state.wallpapers[0];
  wall.classList.toggle('none', !wp);
  var shade = 'linear-gradient(180deg, rgba(0,0,0,.25) 0%, transparent 18%, transparent 48%, rgba(0,0,0,.55) 75%, rgba(0,0,0,.75) 100%)';
  wall.style.backgroundImage = wp ? shade + ', url("' + wp.url + '")' : '';
  document.getElementById('clock').classList.toggle('off', !c.clock);
  document.documentElement.lang = lang();
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
  var below = stack[stack.length - 1];
  if (below && below.el) below.el.style.visibility = 'hidden';
  stack.push(view);
  document.body.classList.add('overlay');
  remoteSubState();
}

// Hide the Remote Buttons info card while one of its submenus is open.
function remoteSubState() {
  document.body.classList.toggle('remote-sub', !!remoteView && stack[stack.length - 1] !== remoteView);
}

function pop() {
  var v = stack.pop();
  if (v) {
    v.el.parentNode.removeChild(v.el);
    if (v.onClose) v.onClose();
  }
  if (!stack.length) document.body.classList.remove('overlay');
  var top = stack[stack.length - 1];
  if (top && top.el) top.el.style.visibility = '';
  remoteSubState();
  if (top && top.refresh) top.refresh();
}

function closeAll() { while (stack.length) pop(); }

// Folder overlay: its own grid of the folder's apps.
function openFolder(id) {
  var el = layer('folderView');
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
// spec: { title, sub, sheet, onFocus, onClose,
//         rows: function () -> [{label, value, chevron, check, danger, info, action}] }
function menu(spec) {
  var el = layer();
  var panel = document.createElement('div');
  panel.className = 'panel' + (spec.sheet ? ' sheet' : '');
  el.appendChild(panel);
  var view = { el: el, focus: 0, rows: [] };

  view.refresh = function () {
    view.rows = spec.rows();
    panel.innerHTML = '<h1></h1>' + (spec.sub ? '<div class="sub"></div>' : '') + '<div class="rowsclip"><div class="rows"></div></div>';
    panel.querySelector('h1').textContent = typeof spec.title === 'function' ? spec.title() : spec.title;
    if (spec.sub) panel.querySelector('.sub').textContent = spec.sub;
    var list = panel.querySelector('.rows');
    view.rows.forEach(function (r, i) {
      var row = document.createElement('div');
      row.className = 'row' + (r.info ? ' info' : '') + (r.danger ? ' danger' : '');
      var lab = document.createElement('span');
      lab.textContent = (r.check !== undefined ? (r.check ? '✓  ' : '     ') : '') + r.label;
      row.appendChild(lab);
      if (r.value !== undefined || r.chevron) {
        var v = document.createElement('span');
        v.className = 'val';
        v.textContent = r.value || '';
        row.appendChild(v);
      }
      if (r.chevron) row.insertAdjacentHTML('beforeend', '<span class="chev">›</span>');
      if (!r.info) {
        row.addEventListener('mouseenter', function () { view.setFocus(i); });
        row.addEventListener('click', function () { view.setFocus(i); view.select(); });
      }
      list.appendChild(row);
    });
    var f = view.focus;
    if (!view.rows[f] || view.rows[f].info) f = selectable(Math.min(f, view.rows.length - 1), -1);
    if (f < 0) f = selectable(0, 1);
    view.setFocus(f);
  };

  function selectable(from, dir) {
    for (var i = from; i >= 0 && i < view.rows.length; i += dir) if (!view.rows[i].info) return i;
    return -1;
  }
  function wrapSel(from, dir) {
    var i = selectable(from, dir);
    return i >= 0 ? i : selectable(dir > 0 ? 0 : view.rows.length - 1, dir);
  }

  view.setFocus = function (i) {
    if (i < 0) return;
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
    var r = view.rows[view.focus];
    if (r && r.action && once()) r.action();
  };

  // Right goes one level deeper (only on rows that open a submenu, so a
  // sideways press can't flip a setting); Left goes back like Back.
  view.key = function (e) {
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
    onRow: function (row) { inner.style.transform = 'translateY(' + (row > 1 ? -(row - 1) * ROW_H : 0) + 'px)'; }
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

// LG Content Store access (tv/store-mode.sh): the privacy block also blocks
// the store, this opens it for 10 minutes (it re-locks on its own).
var STORE_MODE = '/var/lib/webosbrew/store-mode.sh';
var storeState = { available: false, open: false, left: 0 };

function loadStore(cb) {
  exec('[ -f ' + STORE_MODE + ' ] && sh ' + STORE_MODE + ' status', function (res) {
    var out = (res.stdoutString || '').trim();
    storeState.available = /^(blocked|open)/.test(out);
    storeState.open = out.indexOf('open') === 0;
    storeState.left = parseInt(out.split(' ')[1], 10) || 0;
    if (cb) cb();
  });
}

function storeLabel() {
  return storeState.open ? t('storeOpen', Math.max(1, Math.ceil(storeState.left / 60))) : t('storeLocked');
}

function toggleStore() {
  var opening = !storeState.open;
  exec('sh ' + STORE_MODE + ' ' + (opening ? 'on' : 'off'), function () {
    loadStore(function () {
      refreshTop();
      if (opening) launch({ id: 'com.webos.app.discovery', params: {} });
    });
  });
}

function openSettings() {
  loadStore(refreshTop);
  menu({
    title: function () { return t('settingsTitle'); },
    rows: function () {
      var c = cfg();
      return [
        { label: t('language'), value: LANG_NAMES[lang()], chevron: true, action: chooseLanguage },
        { label: t('wallpaper'), value: wallpaperLabel(), chevron: true, action: chooseWallpaper },
        { label: t('frame'), chevron: true, action: openFrameSettings },
        { label: t('remoteButtons'), chevron: true, action: openRemote }
      ].concat(hasLight() ? [{ label: t('hue'), chevron: true, action: openHue }] : []).concat(storeState.available ? [{ label: t('appStore'), value: storeLabel(), action: toggleStore }] : []).concat([
        { label: t('showClock'), value: c.clock ? t('on') : t('off'), action: function () {
          c.clock = !c.clock; saveConfig(); applyLook(); refreshTop();
        } },
        { info: true, label: t('tip') },
        { info: true, label: 'TV Home ' + VERSION }
      ]);
    }
  });
}

// Wallpapers as cards: OK uses one (✓), hold OK crops it (from the kept
// full-size original when there is one), plus None and From USB cards.
function chooseWallpaper() {
  var el = layer('folderView picker');
  el.innerHTML = '<div class="inner"><div class="title"></div><div class="pickhint"></div><div class="grid"></div></div>';
  el.querySelector('.title').textContent = t('wallpaper');
  el.querySelector('.pickhint').textContent = t('wpHint');
  var inner = el.querySelector('.inner');
  var view = { el: el };
  function current() { return cfg().wallpaper; }
  function entries() {
    var list = state.wallpapers.map(function (w) {
      return { type: 'image', key: w.name, title: w.name.replace(/\.[a-z]+$/i, ''), url: w.thumb || w.url, wp: w };
    });
    list.push({ type: 'special', key: 'none', icon: 'none', title: t('none') });
    list.push({ type: 'special', key: '__usb', icon: 'usb', title: t('fromUsb') });
    return list;
  }
  var grid = new Grid({
    container: el.querySelector('.grid'),
    decorate: function (tile, e) {
      tile.insertAdjacentHTML('beforeend', '<div class="badge">' + ICONS.check + '</div>');
      tile.classList.toggle('picked', e.key === current());
    },
    onActivate: function (e) {
      if (e.key === '__usb') { chooseUsbPicture(); return; }
      cfg().wallpaper = e.key;
      saveConfig();
      applyLook();
      var tiles = grid.tiles();
      for (var i = 0; i < tiles.length; i++) tiles[i].classList.toggle('picked', grid.entries[i].key === e.key);
    },
    onLongPress: function (e) {
      if (!e.wp) return;
      cropPicture({ url: e.wp.orig || e.wp.url, name: e.title, saveAs: e.wp.bundled ? null : e.title });
    },
    onRow: function (row) { inner.style.transform = 'translateY(' + (row > 1 ? -(row - 1) * ROW_H : 0) + 'px)'; }
  });
  view.key = function (e) { if (!grid.key(e) && e.keyCode === KEY.BACK) pop(); };
  view.ok = function () { grid.activate(grid.focus); };
  view.longOk = function () { grid.longPress(grid.focus); };
  view.grid = grid;
  push(view);
  var list = entries();
  grid.set(list);
  for (var i = 0; i < list.length; i++) if (list[i].key === current()) grid.setFocus(i, true);
}

function indexOfKey(key) {
  for (var i = 0; i < mainGrid.entries.length; i++) if (mainGrid.entries[i].key === key) return i;
  return 0;
}





// ---------------------------------------------------------------- usb wallpapers

var USB_PY = 'python3 ' + APP_DIR + 'usb.py';
var OUT_SIZES = [3840, 2560, 1920];   // 16:9 output widths; 4K preferred

function chooseUsbPicture() {
  showHint(t('usbLoading'));
  exec(USB_PY + ' list', function (res) {
    showHint('');
    var list = [];
    try { list = JSON.parse(res.stdoutString || '[]'); } catch (e) {}
    if (!list.length) { showHint(t('usbNone')); setTimeout(function () { showHint(''); }, 3000); return; }
    var el = layer('folderView picker');
    el.innerHTML = '<div class="inner"><div class="title"></div><div class="grid"></div></div>';
    el.querySelector('.title').textContent = t('fromUsb');
    var inner = el.querySelector('.inner');
    var view = { el: el };
    var grid = new Grid({
      container: el.querySelector('.grid'),
      onActivate: function (e) {
        cropPicture({ url: e.pic.url, name: e.pic.name, keepOriginal: true });
      },
      onRow: function (row) { inner.style.transform = 'translateY(' + (row > 1 ? -(row - 1) * ROW_H : 0) + 'px)'; }
    });
    view.key = function (e) { if (!grid.key(e) && e.keyCode === KEY.BACK) pop(); };
    view.ok = function () { grid.activate(grid.focus); };
    view.grid = grid;
    push(view);
    grid.set(list.map(function (p, i) { return { type: 'image', key: 'usb' + i, title: p.name, url: p.url, pic: p }; }));
  });
}

// Crop screen: 16:9 frame over the picture. Arrows move the frame; OK goes to
// the bar (Smaller, Larger, resolution, Save); Up/Back returns to the frame.
// pic: {url, name, saveAs?, keepOriginal?}. saveAs = overwrite that wallpaper
// (re-crop); otherwise a new one named after pic.name. keepOriginal stores the
// full-size source in wallpapers/originals for later re-cropping.
function cropPicture(pic) {
  var probe = new Image();
  probe.onload = function () { openCrop(pic, probe.naturalWidth, probe.naturalHeight); };
  probe.onerror = function () { showHint(t('saveFailed')); setTimeout(function () { showHint(''); }, 3000); };
  probe.src = pic.url;
}

function openCrop(pic, W, H) {
  var el = layer('cropView');
  el.innerHTML = '<div class="stage"><img alt=""><div class="frame"></div></div>' +
    '<div class="cropbar"><div class="pill" data-a="minus">−</div><div class="pill" data-a="plus">+</div>' +
    '<div class="pill" data-a="res"></div><div class="pill save" data-a="save"></div></div>' +
    '<div class="crophint"></div>';
  var img = el.querySelector('img'), frameEl = el.querySelector('.frame');
  var pills = [].slice.call(el.querySelectorAll('.cropbar .pill'));
  var AREA_W = 1760, AREA_H = 880;
  var k = Math.min(AREA_W / W, AREA_H / H);          // source px -> screen px
  var ox = (1920 - W * k) / 2, oy = 60 + (AREA_H - H * k) / 2;
  img.style.cssText = 'left:' + ox + 'px;top:' + oy + 'px;width:' + W * k + 'px;height:' + H * k + 'px';
  img.src = pic.url;
  var fw = Math.min(W, H * 16 / 9);                   // frame in source px
  var f = { w: fw, x: (W - fw) / 2, y: (H - fw * 9 / 16) / 2 };
  var focus = -1;                                     // -1 = frame, else pill index
  var outW = 0;
  var wantW = OUT_SIZES[0];                           // what the viewer chose; 4K by default

  function sizes() {
    var max = Math.floor(f.w);
    var list = OUT_SIZES.filter(function (s) { return s <= max; });
    if (!list.length) list = [Math.max(16, max - max % 16)];
    return list;
  }
  function clamp() {
    f.w = Math.max(Math.min(W, H * 16 / 9, f.w), Math.min(W, 480));
    f.x = Math.max(0, Math.min(W - f.w, f.x));
    f.y = Math.max(0, Math.min(H - f.w * 9 / 16, f.y));
    var s = sizes();
    // Highest size up to the chosen one that the frame allows, so shrinking and
    // growing the frame again returns to 4K unless a lower size was chosen.
    outW = s.filter(function (w) { return w <= wantW; })[0] || s[s.length - 1];
  }
  function paint() {
    clamp();
    frameEl.style.cssText = 'left:' + (ox + f.x * k) + 'px;top:' + (oy + f.y * k) + 'px;width:' + f.w * k +
      'px;height:' + f.w * 9 / 16 * k + 'px';
    frameEl.classList.toggle('sel', focus < 0);
    pills.forEach(function (p, i) { p.classList.toggle('sel', i === focus); });
    pills[2].textContent = (outW === 3840 ? '4K · ' : '') + outW + '×' + Math.round(outW * 9 / 16);
    pills[3].textContent = t('save');
    el.querySelector('.crophint').textContent = t('cropHint', W + '×' + H) + '  ·  ' +
      (focus < 0 ? t('cropKeysFrame') : t('cropKeysBar'));
  }
  function resize(factor) {
    var cx = f.x + f.w / 2, cy = f.y + f.w * 9 / 32;
    f.w *= factor;
    clamp();
    f.x = cx - f.w / 2; f.y = cy - f.w * 9 / 32;
    paint();
  }
  function act(a) {
    if (a === 'minus') resize(0.9);
    else if (a === 'plus') resize(1 / 0.9);
    else if (a === 'res') { var s = sizes(); wantW = s[(s.indexOf(outW) + 1) % s.length]; paint(); }
    else if (a === 'save') save();
  }
  function save() {
    showHint(t('saving'));
    var canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = Math.round(outW * 9 / 16);
    canvas.getContext('2d').drawImage(img, f.x, f.y, f.w, f.w * 9 / 16, 0, 0, canvas.width, canvas.height);
    var b64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
    var id = String(Date.now());
    var name = pic.saveAs || ((pic.name || 'picture').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30) + '-' + id.slice(-5));
    var CH = 100000, parts = [];   // one exec argument must stay < 128 KiB (MAX_ARG_STRLEN)
    for (var i = 0; i < b64.length; i += CH) parts.push(b64.slice(i, i + CH));
    (function send(i) {
      if (i < parts.length) { exec(USB_PY + ' chunk ' + id + ' ' + parts[i], function () { send(i + 1); }); return; }
      exec(USB_PY + ' finish ' + id + ' ' + name, function (res) {
        var file = (res.stdoutString || '').trim();
        showHint('');
        if (!file) { showHint(t('saveFailed')); setTimeout(function () { showHint(''); }, 3000); return; }
        cfg().wallpaper = file;
        saveConfig();
        closeAll();
        if (pic.keepOriginal) exec(USB_PY + ' keep ' + pic.url + ' ' + name, function () { load(); });
        else load();
      });
    })(0);
  }

  var view = { el: el };
  view.key = function (e) {
    var c = e.keyCode, step = W * 0.03;
    if (focus < 0) {
      if (c === KEY.LEFT) f.x -= step; else if (c === KEY.RIGHT) f.x += step;
      else if (c === KEY.UP) f.y -= step; else if (c === KEY.DOWN) f.y += step;
      else if (c === KEY.BACK) { pop(); return; }
    } else {
      if (c === KEY.LEFT) focus = (focus + pills.length - 1) % pills.length;
      else if (c === KEY.RIGHT) focus = (focus + 1) % pills.length;
      else if (c === KEY.UP || c === KEY.BACK) focus = -1;
    }
    paint();
  };
  view.ok = function () {
    if (focus < 0) { focus = 3; paint(); return; }
    if (once()) act(pills[focus].getAttribute('data-a'));
  };
  // Magic Remote: drag the frame, wheel resizes, click the pills.
  var drag = null;
  frameEl.addEventListener('mousedown', function (e) { drag = { x: e.clientX, y: e.clientY, fx: f.x, fy: f.y }; focus = -1; paint(); });
  el.addEventListener('mousemove', function (e) {
    if (!drag) return;
    f.x = drag.fx + (e.clientX - drag.x) / k; f.y = drag.fy + (e.clientY - drag.y) / k; paint();
  });
  el.addEventListener('mouseup', function () { drag = null; });
  el.addEventListener('wheel', function (e) { e.stopPropagation(); resize(e.deltaY > 0 ? 0.92 : 1 / 0.92); });
  pills.forEach(function (p, i) {
    p.addEventListener('mouseenter', function () { focus = i; paint(); });
    p.addEventListener('click', function () { focus = i; paint(); if (once()) act(p.getAttribute('data-a')); });
  });
  push(view);
  paint();
}

// ---------------------------------------------------------------- picture frame

// Wallpapers full screen and dimmed, like a framed picture. Any key ends it.
// LG's screensaver (2 min without input) is held off by restarting
// surface-manager's idle timer once a minute; LG's own auto power off still
// applies. Against OLED burn-in the picture drifts a few pixels now and then.
var FRAME_EVERY = [1, 5, 15, 30, 60];   // minutes
var KEEP_AWAKE = "luna-send -n 1 luna://com.webos.surfacemanager.screenSaver/restartUserActivityTimer '{}'";
var frameView = null;

function frameCfg() {
  var c = cfg();
  if (!c.frame) c.frame = clone(DEFAULT_CONFIG.frame);
  return c.frame;
}

function framePictures() {
  var sel = frameCfg().pictures;
  return state.wallpapers.filter(function (w) { return !sel || sel.indexOf(w.name) >= 0; });
}

function everyLabel(m) { return m < 60 ? t('minutes', m) : t('hour'); }

function openFrameSettings() {
  function step(list, v, d) { var i = list.indexOf(v); return list[(i + d + list.length) % list.length]; }
  menu({
    title: function () { return t('frame'); },
    rows: function () {
      var f = frameCfg(), n = framePictures().length;
      var rows = [
        { label: t('frameStart'), action: startFrame },
        { label: t('framePictures'), value: f.pictures ? String(n) : t('frameAll'), chevron: true, action: chooseFramePictures }
      ];
      if (n > 1) rows.push({ label: t('frameEvery'), value: '‹ ' + everyLabel(f.every) + ' ›',
        adjust: function (d) { f.every = step(FRAME_EVERY, f.every, d); saveConfig(); refreshTop(); },
        action: function () { f.every = step(FRAME_EVERY, f.every, 1); saveConfig(); refreshTop(); } });
      rows.push({ label: t('brightness'), value: '‹ ' + f.bri + '% ›',
        adjust: function (d) { f.bri = Math.max(20, Math.min(100, f.bri + d * 10)); saveConfig(); refreshTop(); },
        action: function () { f.bri = f.bri >= 100 ? 20 : f.bri + 10; saveConfig(); refreshTop(); } });
      rows.push({ info: true, label: t('frameHow') });
      return rows;
    }
  });
}

// Wallpapers as cards with check marks; OK shows or skips one. At least one
// stays picked. All picked is stored as "all", so new wallpapers join.
function chooseFramePictures() {
  var el = layer('folderView picker');
  el.innerHTML = '<div class="inner"><div class="title"></div><div class="pickhint"></div><div class="grid"></div></div>';
  el.querySelector('.title').textContent = t('framePictures');
  el.querySelector('.pickhint').textContent = t('framePickHint');
  var inner = el.querySelector('.inner');
  var view = { el: el };
  function picked(name) { var sel = frameCfg().pictures; return !sel || sel.indexOf(name) >= 0; }
  var grid = new Grid({
    container: el.querySelector('.grid'),
    decorate: function (tile, e) {
      tile.classList.add('pickable');
      tile.insertAdjacentHTML('beforeend', '<div class="badge">' + ICONS.check + '</div>');
      tile.classList.toggle('picked', picked(e.key));
    },
    onActivate: function (e, i) {
      var all = state.wallpapers.map(function (w) { return w.name; });
      var sel = (frameCfg().pictures || all).slice();
      var at = sel.indexOf(e.key);
      if (at >= 0) { if (sel.length === 1) return; sel.splice(at, 1); } else sel.push(e.key);
      frameCfg().pictures = all.every(function (n) { return sel.indexOf(n) >= 0; }) ? null : sel;
      saveConfig();
      grid.tiles()[i].classList.toggle('picked', picked(e.key));
    },
    onRow: function (row) { inner.style.transform = 'translateY(' + (row > 1 ? -(row - 1) * ROW_H : 0) + 'px)'; }
  });
  view.key = function (e) { if (!grid.key(e) && e.keyCode === KEY.BACK) pop(); };
  view.ok = function () { grid.activate(grid.focus); };
  view.grid = grid;
  push(view);
  grid.set(state.wallpapers.map(function (w) {
    return { type: 'image', key: w.name, title: w.name.replace(/\.[a-z]+$/i, ''), url: w.thumb || w.url };
  }));
}

function startFrame() {
  var pics = framePictures();
  if (!pics.length) { showHint(t('frameNone')); setTimeout(function () { showHint(''); }, 3000); return; }
  if (frameView) return;
  var order = [], shown = 0;
  function nextPic() {
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
  var el = layer('frame');
  var view = { el: el, timers: [], stop: null };
  view.key = function () { pop(); };
  view.ok = function () { pop(); };
  view.onClose = function () {
    view.timers.forEach(clearInterval);
    if (view.stop) view.stop();
    frameView = null;
    document.body.classList.remove('framing');
  };
  el.addEventListener('click', function () { if (frameView === view) pop(); });
  frameView = view;
  document.body.classList.add('framing');
  push(view);
  if (!glFrame(view, nextPic, pics.length)) cssFrame(view, nextPic, pics.length);
  exec(KEEP_AWAKE);
  view.timers.push(setInterval(function () { exec(KEEP_AWAKE); }, 60000));
}

// WebGL renderer: every picture is one GPU texture, drawn each frame at a
// slowly moving offset. Pictures bigger than the screen (or not 16:9) pan
// across their whole area and turn round gently; 16:9 pictures only drift a
// few pixels (OLED care). Uploads go in strips, one per frame, so a new
// picture never stalls the motion.
var PAN_SPEED = 7;          // screen pixels per second, on average
var FADE_MS = 2500;

function glFrame(view, nextPic, count) {
  var canvas = document.createElement('canvas');
  var dpr = window.devicePixelRatio || 1;
  var W = Math.round(1920 * dpr), H = Math.round(1080 * dpr);
  canvas.width = W; canvas.height = H;
  canvas.className = 'fgl';
  var gl = null;
  try { gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false }); } catch (e) {}
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
    'precision mediump float; varying vec2 uv; uniform sampler2D tex; uniform float alpha; uniform float bri;' +
    'void main() { gl_FragColor = vec4(texture2D(tex, uv).rgb * bri, alpha); }'));
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
  var maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;

  var cur = null, prev = null, fadeStart = 0, raf = 0, stopped = false, loading = false;
  var strip = document.createElement('canvas');
  var sctx = strip.getContext('2d', { willReadFrequently: true });
  var times = [], last = 0;

  // Where the picture sits: cover the screen, pan between two corners.
  function plan(w, h) {
    var k = Math.max(W / w, H / h);
    var tx = w - W / k, ty = h - H / k;
    var drift = tx * k < 40 && ty * k < 40;
    if (drift) { k *= 1.02; tx = w - W / k; ty = h - H / k; }
    var dist = Math.sqrt(tx * tx + ty * ty) * k;
    var x0 = Math.random() < 0.5 ? 0 : tx, y0 = Math.random() < 0.5 ? 0 : ty;
    return { k: k, x0: x0, y0: y0, x1: tx - x0, y1: ty - y0,
             leg: Math.max(drift ? 600 : 60, dist / PAN_SPEED) * 1000 };
  }

  function load(pic) {
    loading = true;
    var img = new Image();
    img.src = pic.url;
    var ready = img.decode ? img.decode() : new Promise(function (ok, bad) { img.onload = ok; img.onerror = bad; });
    ready.then(function () {
      if (stopped) return;
      var w = img.naturalWidth, h = img.naturalHeight, s = Math.min(1, maxTex / Math.max(w, h));
      w = Math.floor(w * s); h = Math.floor(h * s);
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, w, h, 0, gl.RGB, gl.UNSIGNED_BYTE, null);
      var SH = 128, y = 0;
      strip.width = w; strip.height = SH;
      (function upload() {
        if (stopped) return;
        var hh = Math.min(SH, h - y);
        sctx.clearRect(0, 0, w, SH);
        sctx.drawImage(img, 0, y / s, img.naturalWidth, hh / s, 0, 0, w, hh);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y, gl.RGB, gl.UNSIGNED_BYTE,
          hh === SH ? strip : sctx.getImageData(0, 0, w, hh));
        y += hh;
        if (y < h) { requestAnimationFrame(upload); return; }
        img.src = '';
        if (prev) gl.deleteTexture(prev.tex);
        prev = cur;
        cur = { tex: tex, w: w, h: h, p: plan(w, h), start: performance.now() };
        fadeStart = cur.start;
        loading = false;
      })();
    }, function () { loading = false; });
  }

  function place(o, now) {
    var p = o.p, t = (now - o.start) / p.leg;
    var lap = Math.floor(t), f = t - lap;
    var e = (1 - Math.cos(Math.PI * f)) / 2;
    if (lap % 2) e = 1 - e;
    var x = p.x0 + p.x1 * e, y = p.y0 + p.y1 * e;
    gl.uniform2f(U.off, x / o.w, y / o.h);
    gl.uniform2f(U.span, W / p.k / o.w, H / p.k / o.h);
    gl.bindTexture(gl.TEXTURE_2D, o.tex);
  }

  function draw(now) {
    if (stopped) return;
    raf = requestAnimationFrame(draw);
    if (last) times.push(now - last);
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

  load(nextPic());
  raf = requestAnimationFrame(draw);
  if (count > 1) view.timers.push(setInterval(function () { if (!loading) load(nextPic()); }, frameCfg().every * 60000));

  // Frame times go to /tmp/atvhome-frame.txt when the frame ends.
  view.stop = function () {
    stopped = true;
    cancelAnimationFrame(raf);
    if (times.length > 60) {
      var sorted = times.slice().sort(function (a, b) { return a - b; });
      var total = times.reduce(function (a, b) { return a + b; }, 0);
      var slow = times.filter(function (x) { return x > 25; }).length;
      exec('echo "v' + VERSION + ' webgl frames=' + times.length + ' fps=' + (times.length / total * 1000).toFixed(1) +
        ' p99=' + sorted[Math.floor(sorted.length * 0.99)].toFixed(1) + 'ms max=' + sorted[sorted.length - 1].toFixed(1) +
        'ms over25ms=' + slow + ' tex=' + maxTex + '" >> /tmp/atvhome-frame.txt');
    }
    [cur, prev].forEach(function (o) { if (o) gl.deleteTexture(o.tex); });
    var lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  };
  return true;
}

// Fallback without WebGL: two images crossfade, 16:9 only (cover).
function cssFrame(view, nextPic, count) {
  var el = view.el, front = 1;
  el.insertAdjacentHTML('beforeend', '<div class="fimg"></div><div class="fimg"></div><div class="fdim"></div>');
  var imgs = el.querySelectorAll('.fimg');
  el.querySelector('.fdim').style.opacity = (1 - frameCfg().bri / 100).toFixed(2);
  function drift(img) {
    var dx = Math.round(Math.random() * 24 - 12), dy = Math.round(Math.random() * 24 - 12);
    img.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(1.02)';
  }
  function show() {
    var pic = nextPic();
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

// ---------------------------------------------------------------- hue

// Philips Hue through hue.py (in the Light app, run as root): rooms and
// lights, scenes, and the Light button setup (room, cinema scene, back to).
var HUE_PY = 'python3 /media/developer/apps/usr/palm/applications/' + LIGHT_APP + '/hue.py';
var HUE_MODE = '/var/lib/webosbrew/hue-scene.mode';
var hueData = null;
var hueSend = {};   // debounce timers for brightness changes

function hasLight() {
  return state.installed.some(function (a) { return a.id === LIGHT_APP; });
}

function hue(args, cb) {
  exec(HUE_PY + ' ' + args, function (res) {
    var ok = res.returnValue !== false;
    if (cb) cb((res.stdoutString || '').trim(), ok, (res.stderrString || '').trim());
  });
}

function loadHue(cb) {
  hue('status', function (out, ok) {
    try { hueData = ok ? JSON.parse(out) : null; } catch (e) { hueData = null; }
    if (hueData && hueData.paired) { lightCinema = hueData.mode === 'movie'; renderTop(); }
    if (cb) cb();
  });
}

function hueRoom(id) {
  var r = null;
  (hueData && hueData.rooms || []).forEach(function (x) { if (x.id === id) r = x; });
  return r;
}

function sceneName(room, id) {
  var n = '';
  (room && room.scenes || []).forEach(function (s) { if (s.id === id) n = s.name; });
  return n;
}

function openHue() {
  closeAll();
  showHint(t('hueConnecting'));
  loadHue(function () {
    showHint('');
    if (!hueData) { showHint(t('hueFailed')); setTimeout(function () { showHint(''); }, 3000); return; }
    if (!hueData.paired) { pairBridge(); return; }
    openHueRooms();
  });
}

// Rooms as cards: OK switches a room, hold OK opens it. Plus the Light
// button card.
function openHueRooms() {
  var el = layer('folderView picker');
  el.innerHTML = '<div class="inner"><div class="title"></div><div class="pickhint"></div><div class="grid"></div></div>';
  el.querySelector('.title').textContent = 'Hue';
  el.querySelector('.pickhint').textContent = t('hueHint');
  var inner = el.querySelector('.inner');
  var view = { el: el };
  function entries() {
    var list = (hueData.rooms || []).map(function (r) { return { type: 'room', key: 'room' + r.id, title: r.name, room: r }; });
    list.push({ type: 'special', key: '__button', icon: 'light', title: t('lightButton') });
    return list;
  }
  var grid = new Grid({
    container: el.querySelector('.grid'),
    onActivate: function (e) {
      if (e.key === '__button') { lightButtonMenu(); return; }
      e.room.on = !e.room.on;
      grid.set(entries(), e.key);
      hue('room ' + e.room.id + (e.room.on ? ' on' : ' off'), function () { loadHue(view.refresh); });
    },
    onLongPress: function (e) { if (e.room) roomMenu(e.room.id); },
    onRow: function (row) { inner.style.transform = 'translateY(' + (row > 1 ? -(row - 1) * ROW_H : 0) + 'px)'; }
  });
  view.key = function (e) { if (!grid.key(e) && e.keyCode === KEY.BACK) pop(); };
  view.ok = function () { grid.activate(grid.focus); };
  view.longOk = function () { grid.longPress(grid.focus); };
  view.refresh = function () { if (hueData && hueData.rooms) grid.set(entries()); };
  view.grid = grid;
  push(view);
  grid.set(entries());
}

// Brightness: change locally right away, send after a short pause.
function hueBri(kind, id, value) {
  clearTimeout(hueSend[kind + id]);
  hueSend[kind + id] = setTimeout(function () { hue(kind + ' ' + id + ' bri ' + value); }, 350);
}

function roomMenu(id) {
  menu({
    title: function () { var r = hueRoom(id); return r ? r.name : ''; },
    rows: function () {
      var r = hueRoom(id);
      if (!r) return [];
      var rows = [
        { label: t('power'), value: r.on ? t('on') : t('off'), action: function () {
          r.on = !r.on; refreshTop(); hue('room ' + id + (r.on ? ' on' : ' off'), function () { loadHue(refreshTop); });
        } },
        { label: t('brightness'), value: '‹ ' + (r.on ? r.bri + '%' : t('off')) + ' ›', adjust: function (d) {
          r.bri = Math.max(1, Math.min(100, (r.on ? r.bri : 0) + d * 10)); r.on = true;
          refreshTop(); hueBri('room', id, r.bri);
        } }
      ];
      if (r.scenes.length) rows.push({ info: true, label: t('scenes') });
      r.scenes.forEach(function (sc) {
        rows.push({ label: sc.name, action: function () {
          hue('scene ' + id + ' ' + sc.id, function () { lightCinema = false; renderTop(); loadHue(refreshTop); });
        } });
      });
      rows.push({ info: true, label: t('lights') });
      r.lights.forEach(function (l) {
        rows.push({ label: l.name, value: !l.reachable ? t('unreachable') : (l.on ? '‹ ' + l.bri + '% ›' : t('off')),
          action: function () {
            l.on = !l.on; refreshTop(); hue('light ' + l.id + (l.on ? ' on' : ' off'));
          },
          adjust: function (d) {
            l.bri = Math.max(1, Math.min(100, (l.on ? l.bri : 0) + d * 10)); l.on = true;
            refreshTop(); hueBri('light', l.id, l.bri);
          } });
      });
      return rows;
    }
  });
}

// Light button: room, cinema scene, and what the second press goes back to.
function lightButtonMenu() {
  function save(args) { hue('set ' + args, function () { loadHue(refreshTop); }); }
  function pick(title, items, current, onPick) {
    menu({ title: title, rows: function () {
      return items.map(function (it) {
        return { label: it.name, check: it.id === current(), action: function () { onPick(it.id); pop(); } };
      });
    } });
  }
  menu({
    title: t('lightButton'),
    rows: function () {
      var b = hueData.button, r = hueRoom(b.group);
      var backLabel = b.back === 'scene' ? (sceneName(r, b.backScene) || t('notSet')) : t('backPrevious');
      return [
        { label: t('room'), value: r ? r.name : t('notSet'), chevron: true, action: function () {
          pick(t('room'), hueData.rooms, function () { return hueData.button.group; }, function (gid) {
            hueData.button.group = gid; hueData.button.scene = ''; save('group=' + gid);
          });
        } },
        { label: t('cinemaScene'), value: sceneName(r, b.scene) || t('notSet'), chevron: true, action: function () {
          if (!r) return;
          pick(t('cinemaScene'), r.scenes, function () { return hueData.button.scene; }, function (sid) {
            hueData.button.scene = sid; save('scene=' + sid);
          });
        } },
        { label: t('backTo'), value: backLabel, chevron: true, action: function () {
          if (!r) return;
          var items = [{ id: 'previous', name: t('backPrevious') }].concat(r.scenes);
          pick(t('backTo'), items, function () {
            return hueData.button.back === 'scene' ? hueData.button.backScene : 'previous';
          }, function (sid) {
            hueData.button.back = sid === 'previous' ? 'previous' : 'scene';
            hueData.button.backScene = sid === 'previous' ? '' : sid;
            save('back=' + sid);
          });
        } },
        { info: true, label: t('lightHow', backLabel) }
      ];
    }
  });
}

// Pairing on the TV: find the bridge (or type its IP), press its button.
function pairBridge() {
  hue('discover', function (out) {
    var list = [];
    try { list = JSON.parse(out || '[]'); } catch (e) {}
    if (list.length) waitForButton(list[0].ip);
    else askText(t('hueIp'), '', function (ip) { waitForButton(ip.trim()); });
  });
}

function waitForButton(ip) {
  var tries = 0, done = false;
  var sheet = menu({ title: t('huePress'), sub: t('huePressSub'), sheet: true,
    onClose: function () { done = true; },
    rows: function () { return [{ label: t('cancel'), action: pop }]; } });
  (function poll() {
    if (done) return;
    hue('pair ' + ip, function (out) {
      if (done) return;
      if (out === 'ok') {
        done = true;
        closeAll();
        showHint(t('huePaired')); setTimeout(function () { showHint(''); }, 2500);
        loadHue(function () { openHueRooms(); if (!hueData.button.group) lightButtonMenu(); });
        return;
      }
      if (++tries >= 30) { pop(); showHint(t('hueFailed')); setTimeout(function () { showHint(''); }, 3000); return; }
      setTimeout(poll, 2000);
    });
  })();
  return sheet;
}

// ---------------------------------------------------------------- remote buttons

// Remote mapper (tv/remote-mapper): a surface-manager key filter that reads
// /var/lib/webosbrew/remote-mapper/map.json. This UI edits that map via the
// control script; changes apply immediately (the script reloads the filter).
var MAPPER = '/var/lib/webosbrew/remote-mapper/remote-mapper.sh';
// Buttons of the Magic Remote that can be remapped, as the filter names them.
// Home, Back, OK, arrows, volume and power are deliberately not offered.
var REMOTE_BUTTONS = [
  { key: 'Key_webOS_Voice', label: 'b_mic' },
  { key: 'Key_webOS_InputSource', label: 'b_input' },
  { key: 'Key_webOS_ProgramList', label: 'b_list' },
  { key: 'Key_webOS_ScreenRemote', label: 'b_more' },
  { key: 'Key_webOS_ChannelUp', label: 'b_chup' },
  { key: 'Key_webOS_ChannelDown', label: 'b_chdown' },
  { key: 'Key_webOS_Red', label: 'b_red' },
  { key: 'Key_webOS_Green', label: 'b_green' },
  { key: 'Key_webOS_Yellow', label: 'b_yellow' },
  { key: 'Key_webOS_Blue', label: 'b_blue' },
  { key: 'Key_webOS_Netflix', text: 'Netflix' },
  { key: 'Key_webOS_Amazon', text: 'Prime Video' },
  { key: 'Key_webOS_Disneyplus', text: 'Disney+' },
  { key: 'Key_webOS_RakutenTV', text: 'Rakuten TV' },
  { key: 'Key_webOS_LGChannels', text: 'LG Channels' },
  { key: 'Key_webOS_ALEXA', text: 'Alexa' }
];
// Never mappable: power, volume, mute, home, back, settings, arrows, OK.
var BLOCKED_KEYS = /^(Qt\.Key_Super_L|Key_webOS_(Back|Exit|Settings)|Qt\.Key_(Up|Down|Left|Right|Return|Enter|Select|VolumeUp|VolumeDown|VolumeMute|PowerOff))$/;
var remoteState = { map: { buttons: {} }, active: false, installed: false };
var learnTimer = null;

// Learn mode ends with the Remote Buttons menu (Back, Home, closing it).
function stopLearning(silent) {
  if (!learnTimer) return;
  clearInterval(learnTimer);
  learnTimer = null;
  mapper('learn off');
  if (!silent) showHint('');
}

function buttonLabel(key) {
  for (var i = 0; i < REMOTE_BUTTONS.length; i++) {
    var b = REMOTE_BUTTONS[i];
    if (b.key === key) return b.text || t(b.label);
  }
  var m = /^code:(\d+)$/.exec(key);
  if (m) return t('button', m[1]);
  return key.replace(/^(Qt\.)?Key_(webOS_)?/, '');
}

function specialActions() {
  var list = [{ id: APP_ID, title: t('tvHome') }, { id: APP_ID, params: { frame: true }, title: t('frame') }];
  if (state.installed.some(function (a) { return a.id === LIGHT_APP; })) list.push({ id: LIGHT_APP, title: t('light') });
  list.push({ id: 'com.webos.app.livetv', title: t('liveTv') });
  for (var n = 1; n <= 4; n++) list.push({ id: 'com.webos.app.hdmi' + n, title: t('hdmi', n) });
  return list;
}

function sameAction(a, sp) {
  return !!a && a.app === sp.id && JSON.stringify(a.params || {}) === JSON.stringify(sp.params || {});
}

function actionLabel(a) {
  if (!a) return t('lgDefault');
  if (a.action === 'none') return t('doNothing');
  var sp = specialActions();
  for (var i = 0; i < sp.length; i++) if (sameAction(a, sp[i])) return sp[i].title;
  for (var j = 0; j < state.installed.length; j++) if (state.installed[j].id === a.app) return state.installed[j].title;
  return a.app || '?';
}

function mapper(args, cb) {
  exec('sh ' + MAPPER + ' ' + args, function (res) {
    cb && cb((res.stdoutString || '').trim(), res.returnValue !== false && !res.stderrString);
  });
}

function loadRemote(cb) {
  mapper('getmap; echo @@; sh ' + MAPPER + ' status', function (out, ok) {
    var parts = out.split('@@');
    remoteState.installed = ok && parts.length === 2;
    try { remoteState.map = JSON.parse(parts[0]); } catch (e) { remoteState.map = { buttons: {} }; }
    if (!remoteState.map.buttons) remoteState.map.buttons = {};
    remoteState.active = (parts[1] || '').trim() === 'active';
    cb && cb();
  });
}

function saveRemote() {
  var b64 = btoa(unescape(encodeURIComponent(JSON.stringify({ buttons: remoteState.map.buttons }))));
  mapper('setmap ' + b64, function () { showHint(t('saved')); setTimeout(function () { showHint(''); }, 2500); });
  paintRemote(null);
}

// Highlight the focused button and mark mapped ones on the drawing.
function paintRemote(selKey) {
  var els = document.querySelectorAll('#remoteArt [data-key]');
  for (var i = 0; i < els.length; i++) {
    var k = els[i].getAttribute('data-key');
    els[i].classList.toggle('mapped', !!remoteState.map.buttons[k]);
    els[i].classList.toggle('sel', k === selKey);
  }
}

// Remote Buttons screen: navigate the drawing (arrows / pointer), OK opens
// the focused button's choices. Two pills: mapper on/off, Other button.
var remoteView = null;
var remoteFocus = null;   // focused SVG button or pill element

function remoteTargets() {
  return [].slice.call(document.querySelectorAll('#remoteArt [data-key]:not(.fixed), #remotePills .pill'));
}

function remoteKeyOf(el) { return el && el.getAttribute('data-key'); }

function paintRemoteInfo() {
  var els = remoteTargets();
  for (var i = 0; i < els.length; i++) els[i].classList.toggle('sel', els[i] === remoteFocus);
  var key = remoteKeyOf(remoteFocus);
  paintRemote(key);
  var pills = document.querySelectorAll('#remotePills .pill');
  pills[0].textContent = t('remoteOff') + ': ' + (remoteState.active ? t('on') : t('off'));
  pills[1].textContent = t('otherButton');
  pills[2].textContent = t('resetButtons');
  var info = document.getElementById('remoteInfo');
  var a = key && remoteState.map.buttons[key];
  info.querySelector('.name').textContent = key ? buttonLabel(key) : (remoteFocus ? remoteFocus.textContent : '');
  info.querySelector('.act').textContent = key ? actionLabel(a) : '';
  info.querySelector('.act').classList.toggle('on', !!a);
  info.querySelector('.tip').textContent = remoteState.installed ? t('remoteTip') : t('remoteMissing');
}

function focusRemote(el) {
  remoteFocus = el;
  paintRemoteInfo();
}

// Spatial navigation: nearest target in the pressed direction.
function moveRemote(dir) {
  if (!remoteFocus) return;
  var c = remoteFocus.getBoundingClientRect();
  var cx = c.left + c.width / 2, cy = c.top + c.height / 2, best = null, bestScore = 1e9;
  remoteTargets().forEach(function (el) {
    if (el === remoteFocus) return;
    var r = el.getBoundingClientRect();
    var dx = r.left + r.width / 2 - cx, dy = r.top + r.height / 2 - cy;
    var p = dir === KEY.LEFT ? -dx : dir === KEY.RIGHT ? dx : dir === KEY.UP ? -dy : dy;
    var q = (dir === KEY.LEFT || dir === KEY.RIGHT) ? Math.abs(dy) : Math.abs(dx);
    // Only targets inside a ~55° cone of the pressed direction count.
    if (p <= 4 || q > p * 1.5) return;
    var score = p + 1.2 * q;
    if (score < bestScore) { bestScore = score; best = el; }
  });
  if (best) focusRemote(best);
}

function remoteActivate() {
  if (!remoteFocus || !once()) return;
  var pill = remoteFocus.getAttribute('data-pill');
  if (pill === 'power') {
    mapper(remoteState.active ? 'disable' : 'enable', function () { loadRemote(paintRemoteInfo); });
  } else if (pill === 'other') {
    learnButton();
  } else if (pill === 'reset') {
    confirmSheet(t('resetButtonsQ'), '', t('resetYes'), function () {
      remoteState.map.buttons = {};
      saveRemote();
      paintRemoteInfo();
    });
  } else if (remoteState.installed) {
    chooseButtonAction(remoteKeyOf(remoteFocus));
  }
}

function bindRemoteMouse() {
  if (bindRemoteMouse.done) return;
  bindRemoteMouse.done = true;
  remoteTargets().forEach(function (el) {
    el.addEventListener('mouseenter', function () { if (stack[stack.length - 1] === remoteView) focusRemote(el); });
    el.addEventListener('click', function () {
      if (stack[stack.length - 1] !== remoteView) return;
      focusRemote(el); remoteActivate();
    });
  });
}

function openRemote() {
  closeAll();
  document.body.classList.add('remote');
  bindRemoteMouse();
  var el = layer('remoteLayer');
  remoteView = {
    el: el,
    key: function (e) {
      if (e.keyCode === KEY.BACK) pop();
      else moveRemote(e.keyCode);
    },
    ok: remoteActivate,
    refresh: paintRemoteInfo,
    onClose: function () {
      stopLearning();
      remoteView = null;
      document.body.classList.remove('remote');
      paintRemote(null);
    }
  };
  push(remoteView);
  if (!remoteFocus || remoteFocus.classList.contains('fixed')) remoteFocus = document.querySelector('#remoteArt [data-key="Key_webOS_Netflix"]');
  loadRemote(paintRemoteInfo);
  paintRemoteInfo();
}

function chooseButtonAction(key) {
  function set(a) {
    if (a) remoteState.map.buttons[key] = a; else delete remoteState.map.buttons[key];
    saveRemote();
    pop();
    refreshTop();
  }
  menu({
    title: buttonLabel(key),
    sub: actionLabel(remoteState.map.buttons[key]),
    onFocus: function () { paintRemote(key); },
    rows: function () {
      var cur = remoteState.map.buttons[key];
      var rows = [
        { label: t('lgDefault'), check: !cur, action: function () { set(null); } },
        { label: t('doNothing'), check: !!(cur && cur.action === 'none'), action: function () { set({ action: 'none' }); } },
        { info: true, label: t('actions') }
      ];
      specialActions().forEach(function (sp) {
        rows.push({ label: sp.title, check: sameAction(cur, sp), action: function () {
          set(sp.params ? { app: sp.id, params: sp.params } : { app: sp.id });
        } });
      });
      var isSpecial = cur && specialActions().some(function (sp) { return sameAction(cur, sp); });
      rows.push({ label: t('appPick'), value: cur && cur.app && !isSpecial ? actionLabel(cur) : '', chevron: true,
        action: function () {
          appPicker({
            title: buttonLabel(key), single: true, side: true, keys: appOrder,
            isPicked: function (k) { return !!(cur && apps[k].id === cur.app); },
            focusKey: appOrder.filter(function (k) { return cur && apps[k].id === cur.app; })[0],
            onDone: function (sel) {
              var a = apps[sel[0]];
              set(Object.keys(a.params || {}).length ? { app: a.id, params: a.params } : { app: a.id });
            }
          });
        } });
      return rows;
    }
  });
}

// Learn mode: the filter publishes presses; poll them for ~20 s.
function learnButton() {
  stopLearning(true);
  showHint(t('learnSub'));
  mapper('learn on', function () {
    var tries = 0;
    learnTimer = setInterval(function () {
      if (!learnTimer) return;
      mapper('learned', function (out) {
        if (!learnTimer) return;   // menu closed meanwhile
        var list = [];
        try { list = JSON.parse(out || '[]'); } catch (e) {}
        var hit = list.filter(function (e) { return e.code; })[0];
        if (!hit && ++tries < 25) return;
        stopLearning();
        if (!hit) { showHint(t('learnNone')); setTimeout(function () { showHint(''); }, 2500); return; }
        var key = hit.name || ('code:' + hit.code);
        if (BLOCKED_KEYS.test(key)) { showHint(t('learnBlocked')); setTimeout(function () { showHint(''); }, 3000); return; }
        var el = document.querySelector('#remoteArt [data-key="' + key + '"]');
        if (el && !el.classList.contains('fixed')) focusRemote(el);
        chooseButtonAction(key);
      });
    }, 800);
  });
}

// ---------------------------------------------------------------- input

function showHint(text) {
  var h = document.getElementById('hint');
  h.textContent = text;
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
    if (!mainGrid.entries.length) { load(); return; }
    mainGrid.activate(mainGrid.focus);
  },
  longOk: function () {
    if (topFocus < 0) { mainGrid.longPress(mainGrid.focus); return; }
    var b = topButtons()[topFocus];
    if (b && b.longAction && once()) b.longAction();
  }
};

// OK is handled on keyup so a long hold can open the options instead.
var okTimer = null, okLong = false, okDown = false;
document.addEventListener('keydown', function (e) {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  var v = current();
  // Picture frame: any key ends it (OK too, without reaching the tile behind).
  if (frameView && v === frameView) { e.preventDefault(); pop(); return; }
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
  if (launchParams().frame) { closeAll(); startFrame(); return; }
  // Home pressed again: back to a clean home screen.
  closeAll();
  if (mainGrid.moving >= 0) mainGrid.endMove();
  if (editMode) setEditMode(false);
  topFocus = -1;
  renderTop();
  mainGrid.setFocus(0, true);
  load();
});

document.addEventListener('visibilitychange', function () {
  if (document.hidden) { if (frameView) closeAll(); return; }
  load();
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
  exec('sh ' + APP_DIR + 'launchpoints.sh', function (res) {
    var data = null;
    try { data = JSON.parse(res.stdoutString || ''); } catch (e) {}
    if (!data || !data.launchPoints) {
      if (!mainGrid.entries.length) showMsg(t('loadFailed'));
      return;
    }
    showMsg('');
    var changed = adopt(data, true);
    if (hasLight()) exec('cat ' + HUE_MODE + ' 2>/dev/null', function (res) {
      var on = (res.stdoutString || '').trim() === 'movie';
      if (on !== lightCinema) { lightCinema = on; renderTop(); }
    });
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
    if (topFocus >= 0) {
      topFocus = -1;
      var els = document.getElementById('topbar').children;
      for (var j = 0; j < els.length; j++) els[j].classList.remove('focus');
    }
    scrollMain(row);
  },
  onMove: function (entries) { saveOrderFrom(entries); }
});

tick();
setInterval(tick, 10000);

try {
  var cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
  if (cached && cached.launchPoints) {
    state.launchPoints = cached.launchPoints;
    state.wallpapers = cached.wallpapers || [];
    state.installed = cached.installed || [];
    state.config = normalizeConfig(cached.config);
    refreshMain();
  }
} catch (e) {}
if (!state.config) state.config = normalizeConfig(null);
applyLook();
load();
if (launchParams().frame) setTimeout(startFrame, 300);
