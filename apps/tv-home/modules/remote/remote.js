// Remote Buttons for TV Home (Settings > Remote Buttons): give the remote's
// buttons (Netflix, Prime, Mic, Input, colour and number keys ...) any app or
// action. The drawing of the remote is in this file (MARKUP); the mapper that
// does the work on the TV is tv/remote-mapper (installed with this module).
(function () {
  // The remote drawing and the info card next to it, added to the page once.
  var MARKUP = [
    '<div id="remoteInfo"><div class="name"></div><div class="act"></div><div class="tip"></div></div>',
    '<div id="remotePills"><div class="pill" data-pill="power"></div><div class="pill" data-pill="other"></div><div class="pill" data-pill="reset"></div><div class="pill" data-pill="info"></div></div>',
    '<svg id="remoteArt" viewBox="0 0 360 1120">',
    '  <!-- Magic Remote (MR2x), front view; data-key = name in remap.js -->',
    '  <path class="body" d="M30 170 Q30 20 180 20 Q330 20 330 170 L330 1050 Q330 1100 280 1100 L80 1100 Q30 1100 30 1050 Z"/>',
    '  <circle class="btn fixed pwr" cx="180" cy="62" r="22"/>',
    '  <g class="nums">',
    '    <circle class="btn" data-key="Qt.Key_1" cx="95" cy="130" r="25"/><text class="lbl" x="95" y="130">1</text>',
    '    <circle class="btn" data-key="Qt.Key_2" cx="180" cy="130" r="25"/><text class="lbl" x="180" y="130">2</text>',
    '    <circle class="btn" data-key="Qt.Key_3" cx="265" cy="130" r="25"/><text class="lbl" x="265" y="130">3</text>',
    '    <circle class="btn" data-key="Qt.Key_4" cx="95" cy="198" r="25"/><text class="lbl" x="95" y="198">4</text>',
    '    <circle class="btn" data-key="Qt.Key_5" cx="180" cy="198" r="25"/><text class="lbl" x="180" y="198">5</text>',
    '    <circle class="btn" data-key="Qt.Key_6" cx="265" cy="198" r="25"/><text class="lbl" x="265" y="198">6</text>',
    '    <circle class="btn" data-key="Qt.Key_7" cx="95" cy="266" r="25"/><text class="lbl" x="95" y="266">7</text>',
    '    <circle class="btn" data-key="Qt.Key_8" cx="180" cy="266" r="25"/><text class="lbl" x="180" y="266">8</text>',
    '    <circle class="btn" data-key="Qt.Key_9" cx="265" cy="266" r="25"/><text class="lbl" x="265" y="266">9</text>',
    '    <circle class="btn" data-key="Key_webOS_ProgramList" cx="95" cy="334" r="25"/><text class="lbl sm" x="95" y="334">LIST</text>',
    '    <circle class="btn" data-key="Qt.Key_0" cx="180" cy="334" r="25"/><text class="lbl" x="180" y="334">0</text>',
    '    <circle class="btn" data-key="Key_webOS_ScreenRemote" cx="265" cy="334" r="25"/><text class="lbl" x="265" y="334">···</text>',
    '  </g>',
    '  <!-- volume / channel rockers, mute, mic -->',
    '  <rect class="btn fixed" x="68" y="392" width="54" height="150" rx="27"/><text class="lbl" x="95" y="420">+</text><text class="lbl" x="95" y="514">−</text>',
    '  <rect class="btn" data-key="Key_webOS_ChannelUp" x="238" y="392" width="54" height="75" rx="27"/><text class="lbl sm" x="265" y="425">CH+</text>',
    '  <rect class="btn" data-key="Key_webOS_ChannelDown" x="238" y="467" width="54" height="75" rx="27"/><text class="lbl sm" x="265" y="508">CH−</text>',
    '  <circle class="btn fixed" cx="180" cy="420" r="25"/><text class="lbl sm" x="180" y="420">MUTE</text>',
    '  <circle class="btn" data-key="Key_webOS_Voice" cx="180" cy="512" r="27"/><text class="lbl sm" x="180" y="512">MIC</text>',
    '  <circle class="btn fixed" cx="95" cy="590" r="25"/><text class="lbl sm" x="95" y="590">HOME</text>',
    '  <circle class="btn" data-key="Key_webOS_InputSource" cx="265" cy="590" r="25"/><text class="lbl sm" x="265" y="590">INPUT</text>',
    '  <!-- wheel -->',
    '  <circle class="btn fixed" cx="180" cy="715" r="98"/><circle class="btn fixed" cx="180" cy="715" r="40"/><text class="lbl" x="180" y="715">OK</text>',
    '  <circle class="btn fixed" cx="85" cy="840" r="25"/><text class="lbl sm" x="85" y="840">BACK</text>',
    '  <circle class="btn fixed" cx="275" cy="840" r="25"/><text class="lbl sm" x="275" y="840">SET</text>',
    '  <!-- colour buttons -->',
    '  <rect class="btn clr red" data-key="Key_webOS_Red" x="60" y="890" width="50" height="22" rx="11"/>',
    '  <rect class="btn clr green" data-key="Key_webOS_Green" x="126" y="890" width="50" height="22" rx="11"/>',
    '  <rect class="btn clr yellow" data-key="Key_webOS_Yellow" x="192" y="890" width="50" height="22" rx="11"/>',
    '  <rect class="btn clr blue" data-key="Key_webOS_Blue" x="258" y="890" width="50" height="22" rx="11"/>',
    '  <!-- app buttons (this TV\'s remote: Netflix/Prime, Disney+/Rakuten, LG Channels/Alexa) -->',
    '  <rect class="btn app" data-key="Key_webOS_Netflix" x="48" y="932" width="128" height="48" rx="10"/><text class="lbl nf" x="112" y="956">NETFLIX</text>',
    '  <rect class="btn app" data-key="Key_webOS_Amazon" x="184" y="932" width="128" height="48" rx="10"/><text class="lbl" x="248" y="956">prime video</text>',
    '  <rect class="btn app" data-key="Key_webOS_Disneyplus" x="48" y="986" width="128" height="48" rx="10"/><text class="lbl" x="112" y="1010">Disney+</text>',
    '  <rect class="btn app" data-key="Key_webOS_RakutenTV" x="184" y="986" width="128" height="48" rx="10"/><text class="lbl" x="248" y="1010">Rakuten TV</text>',
    '  <rect class="btn app" data-key="Key_webOS_LGChannels" x="48" y="1040" width="128" height="48" rx="10"/><text class="lbl" x="112" y="1064">LG Channels</text>',
    '  <rect class="btn app" data-key="Key_webOS_ALEXA" x="184" y="1040" width="128" height="48" rx="10"/><text class="lbl" x="248" y="1064">alexa</text>',
    '</svg>'
  ].join('\n');

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

  // Actions besides apps: TV Home, what other modules offer (Picture Frame,
  // Light), Live TV and the HDMI inputs.
  function specialActions() {
    var list = [{ id: APP_ID, title: t('tvHome') }].concat(hook('remoteActions'));
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
    pills[3].textContent = 'i';
    var info = document.getElementById('remoteInfo');
    var a = key && remoteState.map.buttons[key];
    info.querySelector('.name').textContent = key ? buttonLabel(key) : (remoteFocus ? remoteFocus.textContent : '');
    info.querySelector('.act').textContent = key ? actionLabel(a) : '';
    info.querySelector('.act').classList.toggle('on', !!a);
    info.querySelector('.tip').innerHTML = hintHTML(remoteState.installed ? t('remoteTip') : t('remoteMissing'));
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
    } else if (pill === 'info') {
      toggleLegend('remote', true);
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
              title: buttonLabel(key), single: true, side: true, keys: appOrder.filter(function (k) { return !apps[k].virtual; }),
              isPicked: function (k) { return !!(cur && apps[k].id === cur.app); },
              focusKey: appOrder.filter(function (k) { return !apps[k].virtual && cur && apps[k].id === cur.app; })[0],
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

  document.body.insertAdjacentHTML('beforeend', MARKUP);

  addModule({
    id: 'remote',
    title: { en: 'Remote Buttons', de: 'Fernbedienungstasten' },
    strings: {
      en: {
        remoteButtons: 'Remote Buttons', remoteTip: '{arrows} {pointer} pick · {ok} change · {back} close', otherButton: 'Other button …',
        remoteOff: 'Remote mapper', remoteMissing: 'The remote mapper is not installed on this TV (install.sh → remote buttons).',
        learnSub: 'Press any button on the remote now …', learnNone: 'No button pressed. Try again.',
        learnBlocked: 'This button can\'t be changed (needed to control the TV).',
        lgDefault: 'LG default', doNothing: 'Do nothing', actions: 'Actions', appsHead: 'Apps', appPick: 'App …',
        tvHome: 'Home screen (TV Home)', liveTv: 'Live TV', hdmi: 'HDMI {0}', button: 'Button {0}',
        saved: 'Saved. Works right away.', resetButtons: 'Reset', resetButtonsQ: 'Reset all buttons to LG default?',
        b_mic: 'Mic', b_input: 'Input', b_list: 'List', b_more: '··· (more)',
        b_red: 'Red', b_green: 'Green', b_yellow: 'Yellow', b_blue: 'Blue',
        b_chup: 'Channel +', b_chdown: 'Channel −'
      },
      de: {
        remoteButtons: 'Fernbedienungstasten', remoteTip: '{arrows} {pointer} wählen · {ok} ändern · {back} schließen', otherButton: 'Andere Taste …',
        remoteOff: 'Tastenbelegung', remoteMissing: 'Die Tastenbelegung ist auf diesem Fernseher nicht installiert (install.sh → Fernbedienung).',
        learnSub: 'Jetzt eine Taste auf der Fernbedienung drücken …', learnNone: 'Keine Taste gedrückt. Nochmal versuchen.',
        learnBlocked: 'Diese Taste kann nicht geändert werden (wird zur Bedienung gebraucht).',
        lgDefault: 'LG-Standard', doNothing: 'Nichts tun', actions: 'Aktionen', appsHead: 'Apps', appPick: 'App …',
        tvHome: 'Startbildschirm (TV Home)', liveTv: 'Live-TV', hdmi: 'HDMI {0}', button: 'Taste {0}',
        saved: 'Gespeichert. Wirkt sofort.', resetButtons: 'Zurücksetzen', resetButtonsQ: 'Alle Tasten auf LG-Standard zurücksetzen?',
        b_mic: 'Mikrofon', b_input: 'Eingang', b_list: 'Liste', b_more: '··· (mehr)',
        b_red: 'Rot', b_green: 'Grün', b_yellow: 'Gelb', b_blue: 'Blau',
        b_chup: 'Kanal +', b_chdown: 'Kanal −'
      }
    },
    info: {
      remote: { title: { en: 'Remote Buttons', de: 'Fernbedienungstasten' }, lines: [
        { en: '{arrows} {pointer} pick a button', de: '{arrows} {pointer} Taste wählen' },
        { en: '{ok} app, input, nothing or LG default', de: '{ok} App, Eingang, nichts oder LG-Standard' },
        { en: 'Grey: fixed, needed by the TV', de: 'Grau: fest, braucht der Fernseher' }
      ] }
    },
    settingsRows: function () { return [{ label: t('remoteButtons'), chevron: true, action: openRemote }]; },
    // Hide the info card while one of its submenus is open.
    stack: function () {
      document.body.classList.toggle('remote-sub', !!remoteView && stack[stack.length - 1] !== remoteView);
    },
    // Switched off in Features: the buttons do what LG made them do again.
    toggled: function (on) { mapper(on ? 'enable' : 'disable'); }
  });
})();
