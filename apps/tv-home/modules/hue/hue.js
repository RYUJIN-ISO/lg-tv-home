// Philips Hue for TV Home: the top-left Light button (one press: the cinema
// scene, the next: back to the lighting before, or a chosen scene) and
// Settings > Hue with the rooms and lights. hue.py and scene.sh live in the
// Light app (apps/hue-light, com.iso.moviescene), installed with this module;
// they run as root through exec. Pairing happens on the TV (pairBridge).
(function () {
  var LIGHT_APP = 'com.iso.moviescene';
  var LIGHT_SCRIPT = '/media/developer/apps/usr/palm/applications/' + LIGHT_APP + '/scene.sh';
  var LIGHT_ICON = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M9 21a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1H9v1zm3-19a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2z"/></svg>';
  ICONS.light = LIGHT_ICON;     // the Light button card in Settings > Hue
  var lightFlash = '';    // '', 'ok' or 'err': ring around the Light button
  var lightCinema = false; // cinema scene active (button glows)

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
    renderTop();
  }

  // ---------------------------------------------------------------- hue

  // Philips Hue through hue.py (in the Light app, run as root): rooms and
  // lights, scenes, and the Light button setup (room, cinema scene, back to).
  var HUE_PY = 'python3 /media/developer/apps/usr/palm/applications/' + LIGHT_APP + '/hue.py';
  var HUE_MODE = '/var/lib/webosbrew/hue-scene.mode';
  var hueData = null;
  var hueSend = {};   // debounce timers for brightness changes

  // The Light app (apps/hue-light) does the work; without it there is no Hue.
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
    el.querySelector('.pickhint').innerHTML = hintHTML(t('hueHint'));
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
      onRow: function (row) { inner.style.transform = 'translateY(' + (row > 1 ? -(row - 1) * PICK_ROW_H : 0) + 'px)'; }
    });
    view.key = function (e) { if (!grid.key(e) && e.keyCode === KEY.BACK) pop(); };
    view.ok = function () { grid.activate(grid.focus); };
    view.longOk = function () { grid.longPress(grid.focus); };
    view.refresh = function () { if (hueData && hueData.rooms) grid.set(entries()); };
    view.grid = grid;
    infoButton(view, inner, 'hue', grid);
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
      info: 'light',
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

  // A Hue room as a card: glows warmer with its brightness.
  function roomTile(entry, card, label) {
    card.classList.add('room');
    card.classList.toggle('lit', entry.room.on);
    card.style.setProperty('--glow', entry.room.on ? (0.35 + entry.room.bri / 160).toFixed(2) : 0);
    card.innerHTML = LIGHT_ICON + '<div class="rname"></div><div class="pct"></div><div class="gloss"></div>';
    card.querySelector('.rname').textContent = entry.title;
    card.querySelector('.pct').textContent = entry.room.on ? entry.room.bri + '%' : t('off');
    label.textContent = entry.title;
  }

  addModule({
    id: 'hue',
    title: { en: 'Philips Hue', de: 'Philips Hue' },
    strings: {
      en: {
        light: 'Light', hue: 'Hue', hueHint: '{ok} on / off · {hold} room', hueConnecting: 'Connecting to Hue …',
        hueFailed: 'The Hue bridge is not reachable.', hueIp: 'IP address of the Hue bridge',
        huePress: 'Press the button on the Hue bridge', huePressSub: 'Waiting up to 60 seconds.',
        huePaired: 'Hue connected.', lightButton: 'Light button', power: 'Power',
        scenes: 'Scenes', lights: 'Lights', room: 'Room', cinemaScene: 'Cinema scene', backTo: 'Back to',
        backPrevious: 'Lighting before cinema', lightHow: 'One press: cinema. Next press: {0}.',
        notSet: 'Not set', unreachable: 'unreachable'
      },
      de: {
        light: 'Licht', hue: 'Hue', hueHint: '{ok} an / aus · {hold} Raum', hueConnecting: 'Verbinde mit Hue …',
        hueFailed: 'Die Hue Bridge ist nicht erreichbar.', hueIp: 'IP-Adresse der Hue Bridge',
        huePress: 'Den Knopf auf der Hue Bridge drücken', huePressSub: 'Wartet bis zu 60 Sekunden.',
        huePaired: 'Hue verbunden.', lightButton: 'Licht-Taste', power: 'Ein / Aus',
        scenes: 'Szenen', lights: 'Lampen', room: 'Raum', cinemaScene: 'Kino-Szene', backTo: 'Zurück zu',
        backPrevious: 'Licht vor dem Kino', lightHow: 'Einmal drücken: Kino. Nochmal: {0}.',
        notSet: 'Nicht gesetzt', unreachable: 'nicht erreichbar'
      }
    },
    info: {
      light: { title: { en: 'Light', de: 'Licht' }, lines: [
        { en: '{ok} cinema ↔ back', de: '{ok} Kino ↔ zurück' },
        { en: '{hold} Hue rooms and lights', de: '{hold} Hue-Räume und Lampen' },
        { en: 'Glows while cinema is on', de: 'Leuchtet, solange Kino an ist' }
      ] },
      hue: { title: { en: 'Hue', de: 'Hue' }, lines: [
        { en: '{ok} room on / off', de: '{ok} Raum an / aus' },
        { en: '{hold} brightness, scenes, lights', de: '{hold} Helligkeit, Szenen, Lampen' },
        { en: '{lr} brightness', de: '{lr} Helligkeit' }
      ] }
    },
    available: hasLight,
    topButtons: function () {
      return [{ icon: LIGHT_ICON, title: t('light'), action: toggleLight, longAction: openHue, cls: function () {
        return (lightFlash ? 'flash-' + lightFlash : '') + (lightCinema ? ' cinema' : '');
      } }];
    },
    settingsRows: function () { return [{ label: t('hue'), chevron: true, action: openHue }]; },
    tile: function (entry, card, label) {
      if (entry.type !== 'room') return false;
      roomTile(entry, card, label);
      return true;
    },
    remoteActions: function () { return [{ id: LIGHT_APP, title: t('light') }]; },
    // The scene may have changed elsewhere (the Light app, a remote button).
    loaded: function () {
      exec('cat ' + HUE_MODE + ' 2>/dev/null', function (res) {
        var on = (res.stdoutString || '').trim() === 'movie';
        if (on !== lightCinema) { lightCinema = on; renderTop(); }
      });
    }
  });
})();
