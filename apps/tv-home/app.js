// TV Home — Apple TV–style launcher for webOS (com.iso.atvhome).
//
// Data comes from launchpoints.sh (run as root via Homebrew Channel exec):
// LG's launch points (order, icons, HDMI bookmarks), available wallpapers and
// the saved config. The config lives in /var/lib/webosbrew/atvhome/config.json
// (written by config.sh) so it survives reinstalls; localStorage only caches
// the last state for an instant first paint.
//
// Remote: arrows / OK / Back. Hold OK on a tile for its options (move, put in
// folder, remove from home). Top-left buttons (Up from the first row):
// Settings, Organize Apps (edit mode: OK opens options directly; add apps,
// new folder, uninstall) and Light (Hue movie scene). Magic Remote: hover +
// click, click-and-hold, wheel.

var APP_ID = 'com.iso.atvhome';
var APP_DIR = '/media/developer/apps/usr/palm/applications/' + APP_ID + '/';
var VERSION = '0.10.2';
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
  added: []       // keys of installed apps without a launch point, put on it
};
// Never offered for uninstall: losing these loses root / the launcher itself.
var PROTECTED = /^(com\.iso\.|org\.webosbrew\.)/;

var state = { launchPoints: [], installed: [], wallpapers: [], config: null };
var editMode = false;
var topFocus = -1;      // focused top-left button, -1 = focus is in the grid
var LIGHT_APP = 'com.iso.moviescene';
var LIGHT_SCRIPT = '/media/developer/apps/usr/palm/applications/' + LIGHT_APP + '/scene.sh';
var lightFlash = '';    // '', 'ok' or 'err': ring around the Light button
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
    wallpaper: 'Wallpaper', wallpaperSub: 'More images: copy them to /var/lib/webosbrew/atvhome/wallpapers/ on the TV.',
    none: 'None', noneDark: 'None (dark)',
    newFolder: 'New Folder',
    editHome: 'Organize Apps', light: 'Light', addApps: 'Add Apps', addAppsSub: 'Installed apps that are not on the home screen yet.',
    allOnHome: 'All installed apps are already on the home screen.',
    editHint: 'Editing: OK on an app or folder for options · Back to finish (changes are saved)',
    removeFromHome: 'Remove from Home Screen',
    uninstall: 'Uninstall', uninstallApps: 'Uninstall Apps', uninstallSub: 'Apps that can be removed from the TV.',
    uninstallQ: 'Uninstall {0}?', uninstallYes: 'Uninstall',
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
    remoteButtons: 'Remote Buttons', remoteSub: 'Choose what each button on the remote does.',
    remoteOff: 'Remote mapper', remoteMissing: 'The remote mapper is not installed on this TV (install.sh → remote buttons).',
    learn: 'Learn a Button', learnSub: 'Press any button on the remote now …', learnNone: 'No button pressed. Try again.',
    learnBlocked: 'This button can\'t be changed (needed to control the TV).',
    lgDefault: 'LG default', doNothing: 'Do nothing', actions: 'Actions', appsHead: 'Apps',
    tvHome: 'Home screen (TV Home)', liveTv: 'Live TV', hdmi: 'HDMI {0}', button: 'Button {0}',
    saved: 'Saved — works right away.',
    b_mic: 'Mic', b_settings: 'Settings', b_input: 'Input', b_list: 'List', b_more: '··· (more)',
    b_red: 'Red', b_green: 'Green', b_yellow: 'Yellow', b_blue: 'Blue',
    b_mute: 'Mute', b_chup: 'Channel +', b_chdown: 'Channel −'
  },
  de: {
    settings: 'Einstellungen', settingsTitle: 'Startbildschirm', language: 'Sprache',
    wallpaper: 'Hintergrundbild', wallpaperSub: 'Weitere Bilder: nach /var/lib/webosbrew/atvhome/wallpapers/ kopieren.',
    none: 'Keines', noneDark: 'Keines (dunkel)',
    newFolder: 'Neuer Ordner',
    editHome: 'Apps organisieren', light: 'Licht', addApps: 'Apps hinzufügen', addAppsSub: 'Installierte Apps, die noch nicht auf dem Startbildschirm sind.',
    allOnHome: 'Alle installierten Apps sind schon auf dem Startbildschirm.',
    editHint: 'Bearbeiten: OK auf einer App oder einem Ordner für Optionen · Zurück zum Beenden (wird gespeichert)',
    removeFromHome: 'Vom Startbildschirm entfernen',
    uninstall: 'Deinstallieren', uninstallApps: 'Apps deinstallieren', uninstallSub: 'Apps, die vom Fernseher entfernt werden können.',
    uninstallQ: '{0} deinstallieren?', uninstallYes: 'Deinstallieren',
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
    remoteButtons: 'Fernbedienungstasten', remoteSub: 'Lege fest, was jede Taste der Fernbedienung macht.',
    remoteOff: 'Tastenbelegung', remoteMissing: 'Die Tastenbelegung ist auf diesem Fernseher nicht installiert (install.sh → Fernbedienung).',
    learn: 'Taste anlernen', learnSub: 'Jetzt eine Taste auf der Fernbedienung drücken …', learnNone: 'Keine Taste gedrückt. Nochmal versuchen.',
    learnBlocked: 'Diese Taste kann nicht geändert werden (wird zur Bedienung gebraucht).',
    lgDefault: 'LG-Standard', doNothing: 'Nichts tun', actions: 'Aktionen', appsHead: 'Apps',
    tvHome: 'Startbildschirm (TV Home)', liveTv: 'Live-TV', hdmi: 'HDMI {0}', button: 'Taste {0}',
    saved: 'Gespeichert – wirkt sofort.',
    b_mic: 'Mikrofon', b_settings: 'Einstellungen', b_input: 'Eingang', b_list: 'Liste', b_more: '··· (mehr)',
    b_red: 'Rot', b_green: 'Grün', b_yellow: 'Gelb', b_blue: 'Blau',
    b_mute: 'Stumm', b_chup: 'Kanal +', b_chdown: 'Kanal −'
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
  apps: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z"/></svg>',
  light: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M9 21a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1H9v1zm3-19a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2z"/></svg>'
};
var GEAR = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>';

function renderTile(entry) {
  var t = document.createElement('div');
  t.className = 'tile';
  var card = document.createElement('div');
  card.className = 'card';
  var label = document.createElement('div');
  label.className = 'label';

  if (entry.type === 'app' && entry.tile) {
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
  t.appendChild(card);
  t.appendChild(label);
  return t;
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
    var t = renderTile(e);
    t.addEventListener('mouseenter', function () { if (self.moving < 0) self.setFocus(i); });
    pressable(t, function () { self.activate(i); }, function () { self.longPress(i); });
    c.appendChild(t);
  });
  this.setFocus(Math.max(0, this.focus), true);
};

Grid.prototype.tiles = function () { return this.o.container.children; };

Grid.prototype.setFocus = function (i, force) {
  if (!this.entries.length) return;
  i = Math.max(0, Math.min(this.entries.length - 1, i));
  if (i === this.focus && !force) return;
  var tiles = this.tiles();
  if (tiles[this.focus]) tiles[this.focus].classList.remove('focus');
  this.focus = i;
  tiles[i].classList.add('focus');
  if (this.o.onRow) this.o.onRow(Math.floor(i / COLS));
};

Grid.prototype.target = function (keyCode) {
  var f = this.focus, n = this.entries.length, row = Math.floor(f / COLS);
  switch (keyCode) {
    case KEY.LEFT:  return f % COLS > 0 ? f - 1 : f;
    case KEY.RIGHT: return f % COLS < COLS - 1 && f + 1 < n ? f + 1 : f;
    case KEY.UP:    return row > 0 ? f - COLS : f;
    case KEY.DOWN:  return f + COLS < n ? f + COLS : (row < Math.floor((n - 1) / COLS) ? n - 1 : f);
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
  var hasLight = state.installed.some(function (a) { return a.id === LIGHT_APP; });
  if (hasLight) b.push({ icon: ICONS.light, title: t('light'), light: true, action: toggleLight });
  return b;
}

function renderTop() {
  var bar = document.getElementById('topbar');
  var buttons = topButtons();
  bar.innerHTML = '';
  buttons.forEach(function (btn, i) {
    var el = document.createElement('div');
    el.className = 'tbtn' + (i === topFocus ? ' focus' : '') + (i === 1 && editMode ? ' on' : '') +
      (btn.light && lightFlash ? ' flash-' + lightFlash : '');
    el.innerHTML = btn.icon + '<div class="tlabel"></div>';
    el.querySelector('.tlabel').textContent = btn.title;
    el.addEventListener('mouseenter', function () { focusTop(i); });
    el.addEventListener('click', function () { focusTop(i); if (once()) btn.action(); });
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

function push(view) {
  stack.push(view);
  document.body.classList.add('overlay');
}

function pop() {
  var v = stack.pop();
  if (v) {
    v.el.parentNode.removeChild(v.el);
    if (v.onClose) v.onClose();
  }
  if (!stack.length) document.body.classList.remove('overlay');
  var top = stack[stack.length - 1];
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
// spec: { title, sub, sheet, rows: function () -> [{label, value, chevron,
//         check, danger, info, thumb, action}] }
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
      if (r.thumb) {
        var th = document.createElement('div');
        th.className = 'thumb';
        th.style.backgroundImage = r.thumb === 'none' ? 'radial-gradient(#26262c, #0d0d0f)' : 'url("' + r.thumb + '")';
        row.appendChild(th);
      }
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
    if (e.keyCode === KEY.UP) view.setFocus(selectable(view.focus - 1, -1));
    else if (e.keyCode === KEY.DOWN) view.setFocus(selectable(view.focus + 1, 1));
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

function uninstall(app) {
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

// Checklist of all apps; checked = in this folder.
function chooseFolderApps(id) {
  menu({
    title: function () { return cfg().folders[id].name + ': Apps'; },
    sub: t('checkHint'),
    rows: function () {
      return appOrder.map(function (k) {
        var inIt = cfg().folders[id].items.indexOf(k) >= 0;
        return { label: apps[k].title, check: inIt, action: function () {
          if (inIt) removeFromFolder(k, id); else moveToFolder(k, id);
          refreshMain(); refreshTop();
        } };
      });
    }
  });
}

function refreshTop() {
  var top = stack[stack.length - 1];
  if (top && top.refresh) top.refresh();
}

// ---------------------------------------------------------------- settings

function wallpaperLabel() {
  var c = cfg();
  if (c.wallpaper === 'none') return t('none');
  return c.wallpaper.replace(/\.[a-z]+$/i, '');
}

function openSettings() {
  menu({
    title: function () { return t('settingsTitle'); },
    rows: function () {
      var c = cfg();
      return [
        { label: t('language'), value: LANG_NAMES[lang()], chevron: true, action: chooseLanguage },
        { label: t('wallpaper'), value: wallpaperLabel(), chevron: true, action: chooseWallpaper },
        { label: t('remoteButtons'), chevron: true, action: openRemote },
        { label: t('showClock'), value: c.clock ? t('on') : t('off'), action: function () {
          c.clock = !c.clock; saveConfig(); applyLook(); refreshTop();
        } },
        { info: true, label: t('tip') },
        { info: true, label: 'TV Home ' + VERSION }
      ];
    }
  });
}

function chooseWallpaper() {
  menu({
    title: t('wallpaper'),
    sub: t('wallpaperSub'),
    rows: function () {
      var c = cfg();
      var rows = state.wallpapers.map(function (w) {
        return { label: w.name.replace(/\.[a-z]+$/i, ''), thumb: w.url, check: c.wallpaper === w.name,
          action: function () { c.wallpaper = w.name; saveConfig(); applyLook(); refreshTop(); } };
      });
      rows.push({ label: t('noneDark'), thumb: 'none', check: c.wallpaper === 'none',
        action: function () { c.wallpaper = 'none'; saveConfig(); applyLook(); refreshTop(); } });
      return rows;
    }
  });
}

function indexOfKey(key) {
  for (var i = 0; i < mainGrid.entries.length; i++) if (mainGrid.entries[i].key === key) return i;
  return 0;
}

// Only the apps that aren't on the home screen yet (pen card → Add Apps).
function chooseAddApps() {
  var offered = appOrder.filter(function (k) { return !onHome(k); });
  menu({
    title: function () { return t('addApps'); },
    sub: t('addAppsSub'),
    rows: function () {
      if (!offered.length) return [{ info: true, label: t('allOnHome') }];
      return offered.map(function (k) {
        var on = onHome(k);
        return { label: apps[k].title, check: on, action: function () {
          setOnHome(k, !on); refreshMain(k); refreshTop();
        } };
      });
    }
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
  menu({
    title: function () { return t('uninstallApps'); },
    sub: t('uninstallSub'),
    rows: function () {
      var rows = appOrder.filter(function (k) { return apps[k].removable; }).map(function (k) {
        return { label: apps[k].title, chevron: true, action: function () { confirmUninstall(apps[k]); } };
      });
      return rows.length ? rows : [{ info: true, label: t('noUninstall') }];
    }
  });
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
  { key: 'Key_webOS_Settings', label: 'b_settings' },
  { key: 'Key_webOS_ProgramList', label: 'b_list' },
  { key: 'Key_webOS_ScreenRemote', label: 'b_more' },
  { key: 'Qt.Key_VolumeMute', label: 'b_mute' },
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
var BLOCKED_KEYS = /^(Qt\.Key_Super_L|Key_webOS_Back|Key_webOS_Exit|Qt\.Key_(Up|Down|Left|Right|Return|Enter|Select|VolumeUp|VolumeDown|PowerOff))$/;
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
  var list = [{ id: APP_ID, title: t('tvHome') }];
  if (state.installed.some(function (a) { return a.id === LIGHT_APP; })) list.push({ id: LIGHT_APP, title: t('light') });
  list.push({ id: 'com.webos.app.livetv', title: t('liveTv') });
  for (var n = 1; n <= 4; n++) list.push({ id: 'com.webos.app.hdmi' + n, title: t('hdmi', n) });
  return list;
}

function actionLabel(a) {
  if (!a) return t('lgDefault');
  if (a.action === 'none') return t('doNothing');
  var sp = specialActions();
  for (var i = 0; i < sp.length; i++) if (sp[i].id === a.app) return sp[i].title;
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

function openRemote() {
  document.body.classList.add('remote');
  loadRemote(function () {
    var view = menu({
      title: function () { return t('remoteButtons'); },
      sub: t('remoteSub'),
      onFocus: function (row) { paintRemote(row && row.key); },
      onClose: function () { stopLearning(); document.body.classList.remove('remote'); },
      rows: function () {
        if (!remoteState.installed) return [{ info: true, label: t('remoteMissing') }];
        var rows = [
          { label: t('remoteOff'), value: remoteState.active ? t('on') : t('off'), action: function () {
            mapper(remoteState.active ? 'disable' : 'enable', function () { loadRemote(refreshTop); });
          } },
          { label: t('learn'), chevron: true, action: learnButton }
        ];
        var keys = REMOTE_BUTTONS.map(function (b) { return b.key; });
        Object.keys(remoteState.map.buttons).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
        keys.forEach(function (k) {
          rows.push({ key: k, label: buttonLabel(k), value: actionLabel(remoteState.map.buttons[k]), chevron: true,
            action: function () { chooseButtonAction(k); } });
        });
        return rows;
      }
    });
    paintRemote(null);
    return view;
  });
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
        rows.push({ label: sp.title, check: !!(cur && cur.app === sp.id), action: function () { set({ app: sp.id }); } });
      });
      rows.push({ info: true, label: t('appsHead') });
      state.installed.slice().sort(function (a, b) { return a.title.localeCompare(b.title); }).forEach(function (a) {
        if (a.id === APP_ID) return;
        rows.push({ label: a.title, check: !!(cur && cur.app === a.id), action: function () { set({ app: a.id }); } });
      });
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
  longOk: function () { if (topFocus < 0) mainGrid.longPress(mainGrid.focus); }
};

// OK is handled on keyup so a long hold can open the options instead.
var okTimer = null, okLong = false, okDown = false;
document.addEventListener('keydown', function (e) {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  var v = current();
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
  if (grid) grid.setFocus(grid.focus + (e.deltaY > 0 ? COLS : -COLS));
  else if (v.key) v.key({ keyCode: e.deltaY > 0 ? KEY.DOWN : KEY.UP });
});

document.addEventListener('webOSRelaunch', function () {
  if (launchParams().bench) { setTimeout(bench, 500); return; }
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
