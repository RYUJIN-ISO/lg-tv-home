// Inputs menu for TV Home (Settings > Features > Inputs menu). The menu itself
// is its own small app, com.iso.inputs (apps/inputs-overlay): an overlay
// window, so it opens over any input or app without switching away. This
// module puts it on the AI (mic) button (a switch here, written into the
// remote mapper's map.json) and offers it as an action in Remote Buttons.
(function () {
  var INPUTS_APP = 'com.iso.inputs';
  var MAPPER = '/var/lib/webosbrew/remote-mapper/remote-mapper.sh';
  var AI_KEY = 'Key_webOS_Voice';
  var aiState = { known: false, mapper: false, on: false };

  // Ours: the overlay, or TV Home's own menu from 0.33 ({inputs: true}).
  function isOurs(a) { return !!a && (a.app === INPUTS_APP || (a.app === APP_ID && !!(a.params || {}).inputs)); }

  function readMap(cb) {
    exec('sh ' + MAPPER + ' getmap', function (res) {
      var map = null;
      if (res.returnValue !== false && !res.stderrString) {
        try { map = JSON.parse(res.stdoutString || ''); } catch (e) {}
      }
      aiState.known = true;
      aiState.mapper = !!map;
      if (map && !map.buttons) map.buttons = {};
      aiState.on = !!map && isOurs(map.buttons[AI_KEY]);
      cb(map);
    });
  }

  function writeMap(map, cb) {
    var b64 = btoa(unescape(encodeURIComponent(JSON.stringify({ buttons: map.buttons }))));
    exec('sh ' + MAPPER + ' setmap ' + b64, cb);
  }

  function setAiButton(on) {
    readMap(function (map) {
      if (!map) { refreshTop(); return; }
      if (on) map.buttons[AI_KEY] = { app: INPUTS_APP };
      else if (isOurs(map.buttons[AI_KEY])) delete map.buttons[AI_KEY];
      writeMap(map, function () { aiState.on = on; refreshTop(); });
    });
  }

  // Buttons still set to TV Home's old in-app menu go to the overlay.
  function migrate() {
    readMap(function (map) {
      if (!map) return;
      var changed = false;
      for (var k in map.buttons) {
        var a = map.buttons[k];
        if (a && a.app === APP_ID && (a.params || {}).inputs) { map.buttons[k] = { app: INPUTS_APP }; changed = true; }
      }
      if (changed) writeMap(map);
    });
  }

  addModule({
    id: 'inputs',
    title: { en: 'Inputs menu', de: 'Eingänge-Menü' },
    about: { en: 'A list of the TV\'s inputs (HDMI) with their names and signal, over whatever is on screen. The AI button opens it (switch below), or any button in Remote Buttons.',
             de: 'Eine Liste der Eingänge (HDMI) mit Namen und Signal, über dem laufenden Bild. Die KI-Taste öffnet sie (Schalter unten) oder jede Taste unter Fernbedienungstasten.' },
    strings: {
      en: { inputsMenu: 'Inputs menu', inLoading: '…', inAiButton: 'AI button opens Inputs',
            inNeedsRemote: 'Remote Buttons (install.sh) puts it on a button.' },
      de: { inputsMenu: 'Eingänge-Menü', inLoading: '…', inAiButton: 'KI-Taste öffnet Eingänge',
            inNeedsRemote: 'Mit Fernbedienungstasten (install.sh) auf eine Taste legen.' }
    },
    settings: function () {
      if (!aiState.known) return [{ label: t('inLoading'), info: true }];
      if (!aiState.mapper) return [{ label: t('inNeedsRemote'), info: true }];
      var flip = function () { setAiButton(!aiState.on); };
      return [{ label: t('inAiButton'), value: '‹ ' + (aiState.on ? t('on') : t('off')) + ' ›', action: flip, adjust: flip }];
    },
    featureOpen: function () { readMap(refreshTop); },
    remoteActions: function () { return [{ id: INPUTS_APP, title: t('inputsMenu') }]; },
    start: function (p) {
      migrate();
      // An old mapping ({inputs: true}) pressed before the migration ran.
      if (p.inputs) launch({ id: INPUTS_APP, params: {} });
    },
    relaunch: function (p) {
      if (!p.inputs) return false;
      launch({ id: INPUTS_APP, params: {} });
      return true;
    }
  });
})();
