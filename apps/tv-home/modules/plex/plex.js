// Plex for TV Home: a "Continue Watching" row above the apps and an optional
// "New in your libraries" row below them, from the Plex server of the account
// signed in under Settings > Plex > Account. OK on a card opens Plex right at
// that title (Continue Watching resumes it). Everything Plex lives in this
// module (plex.js, plex.css, plex.py, devtools.py) and apps/plex-link;
// install.sh copies the .py files next to app.js. Without it, TV Home is
// unchanged.
// How it works: docs/HOW-IT-WORKS.md, "Plex".
//
// plex.py (root, through exec) keeps cache/plex/rows.json and the pictures in
// this app's folder; the page reads the file directly for a fast first paint,
// then asks plex.py, which refreshes in the background when the rows are old.
// The store Plex app ignores launch params, so plex.py opens Plex as the
// hidden developer app com.iso.plexlink (the same Plex web app) and hands it
// the title over the TV's DevTools port. That copy is kept started but hidden
// (plex.py preload) a few seconds after TV Home is shown, so Plex opens at
// once; Settings > Plex > Keep Plex ready turns this off. If plex.py can't
// start, the store app opens instead.
(function () {
  var PLEX_APP = 'cdp-30';        // the Plex app from LG's store
  var PLEX_LINK = 'com.iso.plexlink';
  var PRELOAD_DELAY = 4000;       // let TV Home finish loading first
  var CW_STEP = 448 + 32;         // card width + gap
  var RECENT_H = 500;
  var CW_SHOW = ['always', 'plex', 'up'];   // Settings > Plex > Show Continue Watching             // heading + posters + labels (#recent in plex.css)

  var STRINGS_PLEX = {
    en: {
      plexTitle: 'Plex', plexContinue: 'Continue Watching', plexMinLeft: '{0} min left', plexEpisode: 'S{0} · E{1}',
      plexRecent: 'New in your libraries', plexLibraries: 'Libraries', plexRefresh: 'Refresh now',
      plexUpdated: 'Updated {0}', plexNoToken: 'Not signed in. Sign in under Account above.',
      plexFailed: 'Plex did not answer ({0}). The last rows stay until it does.', plexLoading: 'Loading …',
      plexLibsHint: 'Rows show titles from the ticked libraries.', plexPreload: 'Keep Plex ready',
      plexCwShow: 'Show Continue Watching', plexAlways: 'Always', plexOnPlex: 'When Plex is selected', plexOnUp: 'On Up',
      plexOnUpHint: 'The row stays hidden; Up from the first row of apps shows it.',
      plexOnPlexHint: 'Put the Plex app in the first row of apps: the row appears while it is selected.',
      plexAccount: 'Account', plexSignedOut: 'Not signed in', plexSignedInAs: 'Signed in as {0}', plexServer: 'Server: {0}',
      plexSignIn: 'Sign in to Plex', plexSignInHint: 'On your phone or computer, open plex.tv/link and enter this code.',
      plexSignInFailed: 'Plex could not be reached. Go back and try again.',
      plexSignOut: 'Sign out', plexSignOutQ: 'Sign out of Plex?',
      plexSignOutSub: 'The Plex rows disappear until you sign in again. To also revoke this TV, remove "TV Home" from the authorized devices on plex.tv.'
    },
    de: {
      plexTitle: 'Plex', plexContinue: 'Weiterschauen', plexMinLeft: 'noch {0} Min.', plexEpisode: 'S{0} · F{1}',
      plexRecent: 'Neu in deinen Mediatheken', plexLibraries: 'Mediatheken', plexRefresh: 'Jetzt aktualisieren',
      plexUpdated: 'Aktualisiert {0}', plexNoToken: 'Nicht angemeldet. Melde dich oben unter Konto an.',
      plexFailed: 'Plex hat nicht geantwortet ({0}). Die letzten Reihen bleiben, bis es wieder klappt.', plexLoading: 'Wird geladen …',
      plexLibsHint: 'Die Reihen zeigen Titel aus den angehakten Mediatheken.', plexPreload: 'Plex bereithalten',
      plexCwShow: 'Weiterschauen zeigen', plexAlways: 'Immer', plexOnPlex: 'Wenn Plex ausgewählt ist', plexOnUp: 'Mit Hoch',
      plexOnUpHint: 'Die Reihe bleibt versteckt; Hoch aus der ersten App-Reihe zeigt sie.',
      plexOnPlexHint: 'Leg die Plex-App in die erste App-Reihe: Die Reihe erscheint, solange sie ausgewählt ist.',
      plexAccount: 'Konto', plexSignedOut: 'Nicht angemeldet', plexSignedInAs: 'Angemeldet als {0}', plexServer: 'Server: {0}',
      plexSignIn: 'Bei Plex anmelden', plexSignInHint: 'Öffne auf dem Handy oder Computer plex.tv/link und gib diesen Code ein.',
      plexSignInFailed: 'Plex ist nicht erreichbar. Geh zurück und versuch es noch einmal.',
      plexSignOut: 'Abmelden', plexSignOutQ: 'Von Plex abmelden?',
      plexSignOutSub: 'Die Plex-Reihen verschwinden, bis du dich wieder anmeldest. Um diesen TV auch zu sperren, entferne „TV Home“ aus den autorisierten Geräten auf plex.tv.'
    }
  };

  var rows = { continue: [], recent: [] };
  var status = { at: 0, error: '' };   // for the line in Settings > Plex
  var account = null;             // {user, server}; '' = not signed in; null = not known yet
  var cwFocus = -1;               // focused Continue Watching card, -1 = focus is elsewhere
  var cwLast = 0;                 // card to come back to
  var recFocus = -1;              // focused poster in "New in your libraries"
  var recLast = 0;
  var preloadTimer = null;

  function plexCfg() {
    var p = cfg().plex || {};
    // cwShow: 'always' | 'plex' (while the Plex tile is selected) | 'up' (hidden until Up from the first row).
    // Older configs had cwOnPlex: true for 'plex'.
    var show = CW_SHOW.indexOf(p.cwShow) >= 0 ? p.cwShow : p.cwOnPlex ? 'plex' : 'always';
    return { continue: p.continue !== false, cwShow: show, recent: !!p.recent, sections: p.sections || [],
             preload: p.preload !== false };
  }
  function setPlex(key, value) {
    var c = cfg();
    c.plex = plexCfg();
    c.plex[key] = value;
    saveConfig();
    renderCW();
    renderRecent();
  }
  function cwItems() { return plexCfg().continue ? rows.continue : []; }
  function recItems() { return plexCfg().recent ? rows.recent : []; }

  // Settings > Plex > Show Continue Watching. "When Plex is selected": the row
  // only shows while the Plex tile in the first app row has the focus, or the
  // row itself has it, like the Apple TV's top shelf. "On Up": hidden until Up
  // from the first app row moves into it (a second Up reaches the buttons).
  // The row has its own space above the apps, so nothing moves when it fades.
  function plexTile() {
    for (var i = 0; i < Math.min(COLS, mainGrid.entries.length); i++) {
      var e = mainGrid.entries[i];
      if (e.type === 'app' && e.id === PLEX_APP) return i;
    }
    return -1;
  }
  function cwShown() {
    var show = plexCfg().cwShow;
    if (!cwItems().length) return false;
    if (show === 'always' || cwFocus >= 0) return true;
    return show === 'plex' && !editMode && topFocus < 0 && recFocus < 0 && mainGrid.focus === plexTile();
  }
  // Up from this app tile (first row) moves into the row.
  function cwFromTile(i) {
    var show = plexCfg().cwShow;
    return cwItems().length > 0 && i < COLS && (show !== 'plex' || i === plexTile());
  }
  function showCW() { document.body.classList.toggle('has-cw', cwShown()); }
  function plexArgs() {
    var p = plexCfg();
    return p.sections.join(',') + (p.recent ? ' recent' : '');
  }
  function plexPy(args, cb) {
    // Runs as root through a shell, and keys come from the Plex server: only
    // commands, numbers and commas may pass (plex.py checks them again).
    if (!/^[a-z-]+( [0-9,]*)?( recent)?$/.test(args)) { if (cb) cb(null); return; }
    exec('python3 ' + APP_DIR + 'plex.py ' + args, function (res) {
      var r = null;
      try { r = JSON.parse(res.stdoutString || ''); } catch (e) {}
      if (cb) cb(r);
    });
  }

  // ---- rows

  // Rows from plex.py or rows.json; {error} / {loading} only update the status.
  function adopt(r) {
    if (!r) return;
    // Signed out: the rows go. Other errors keep the last rows until Plex answers again.
    if (r.error === 'no token') r = { continue: [], recent: [], error: r.error };
    else if (r.error) { status.error = r.error; return; }
    if (!r.continue) return;
    status = { at: r.at || 0, error: r.error || '' };
    if (JSON.stringify(r.continue) === JSON.stringify(rows.continue) &&
        JSON.stringify(r.recent || []) === JSON.stringify(rows.recent)) return;
    rows = { continue: r.continue, recent: r.recent || [] };
    renderCW();
    renderRecent();
  }

  function loadRows() {
    var x = new XMLHttpRequest();
    x.onload = function () { try { adopt(JSON.parse(x.responseText)); } catch (e) {} };
    x.open('GET', 'cache/plex/rows.json?' + Date.now());
    x.send();
    var p = plexCfg();
    if (p.continue || p.recent) plexPy('get ' + plexArgs(), adopt);
  }

  // Fetches now (after a settings change); done() when the answer is in.
  function refreshRows(done) {
    plexPy('refresh ' + plexArgs(), function (r) {
      if (r) adopt(r); else status.error = 'no answer';
      if (done) done();
    });
  }

  function cwSub(it) {
    var s = [];
    if (it.season != null) s.push(t('plexEpisode').replace('{0}', it.season).replace('{1}', it.number));
    if (it.left) s.push(t('plexMinLeft', it.left));
    return s.join(' · ');
  }

  function renderCW() {
    var items = cwItems();
    document.querySelector('#cw .cwtitle').textContent = t('plexContinue');
    var track = document.querySelector('#cw .cwtrack');
    track.innerHTML = '';
    items.forEach(function (it, i) {
      var c = document.createElement('div');
      c.className = 'cwcard';
      c.innerHTML = '<div class="img"><div class="bar"><i></i></div></div><div class="t1"></div><div class="t2"></div>';
      c.querySelector('.img').style.backgroundImage = 'url("' + it.wide + '")';
      if (it.progress > 0.01) c.querySelector('.bar i').style.width = (it.progress * 100).toFixed(1) + '%';
      else c.querySelector('.bar').style.display = 'none';
      c.querySelector('.t1').textContent = it.title || '';
      c.querySelector('.t2').textContent = cwSub(it);
      c.addEventListener('mouseenter', function () { focusCW(i); });
      pressable(c, function () { focusCW(i); if (once()) openPlex(it, true); }, function () {});
      track.appendChild(c);
    });
    if (cwFocus >= 0 && !items.length) { cwFocus = -1; mainGrid.setFocus(mainGrid.focus, true); }   // row switched off
    if (cwFocus >= items.length) cwFocus = items.length - 1;
    if (cwFocus >= 0) focusCW(cwFocus);
    showCW();
  }

  // Scrolls so the focused card is the second one, but never past the last.
  function positionCW() {
    var off = Math.min(Math.max(0, cwFocus - 1), Math.max(0, cwItems().length - 3));
    document.querySelector('#cw .cwtrack').style.transform = 'translateX(' + (-off * CW_STEP) + 'px)';
  }

  function focusCW(i) {
    var items = cwItems();
    if (!items.length) return;
    i = Math.max(0, Math.min(items.length - 1, i));
    var tiles = mainGrid.tiles();
    if (tiles[mainGrid.focus]) tiles[mainGrid.focus].classList.remove('focus');
    if (topFocus >= 0) {
      topFocus = -1;
      var els = document.getElementById('topbar').children;
      for (var j = 0; j < els.length; j++) els[j].classList.remove('focus');
    }
    leaveRecent();
    cwFocus = cwLast = i;
    var cards = document.querySelector('#cw .cwtrack').children;
    for (var k = 0; k < cards.length; k++) cards[k].classList.toggle('focus', k === i);
    positionCW();
    scrollMain(0);
    showCW();
  }

  function leaveCW() {
    if (cwFocus < 0) return;
    cwFocus = -1;
    var cards = document.querySelector('#cw .cwtrack').children;
    for (var k = 0; k < cards.length; k++) cards[k].classList.remove('focus');
  }

  // "New in your libraries": posters under the last app row, well clear of its labels.
  function recentTop() {
    return GRID_TOP + Math.ceil(mainGrid.entries.length / COLS) * ROW_H + 56;
  }

  function renderRecent() {
    var items = recItems();
    var box = document.getElementById('recent');
    document.body.classList.toggle('has-recent', items.length > 0);
    box.style.top = recentTop() + 'px';
    box.querySelector('.cwtitle').textContent = t('plexRecent');
    var track = box.querySelector('.rtrack');
    track.innerHTML = '';
    items.forEach(function (it, i) {
      var c = document.createElement('div');
      c.className = 'rcard';
      c.innerHTML = '<div class="img"></div><div class="t1"></div>';
      c.querySelector('.img').style.backgroundImage = 'url("' + it.poster + '")';
      c.querySelector('.t1').textContent = it.title || '';
      c.addEventListener('mouseenter', function () { focusRecent(i); });
      pressable(c, function () { focusRecent(i); if (once()) openPlex(it); }, function () {});
      track.appendChild(c);
    });
    if (recFocus >= 0 && !items.length) { recFocus = -1; mainGrid.setFocus(mainGrid.focus, true); }
    if (recFocus >= items.length) recFocus = items.length - 1;
    if (recFocus >= 0) focusRecent(recFocus);
  }

  function focusRecent(i) {
    var items = recItems();
    if (!items.length) return;
    i = Math.max(0, Math.min(items.length - 1, i));
    var tiles = mainGrid.tiles();
    if (tiles[mainGrid.focus]) tiles[mainGrid.focus].classList.remove('focus');
    leaveCW();
    recFocus = recLast = i;
    var cards = document.querySelector('#recent .rtrack').children;
    for (var k = 0; k < cards.length; k++) cards[k].classList.toggle('focus', k === i);
    // Third card from the left stays put while the row scrolls.
    var off = Math.min(Math.max(0, i - 2), Math.max(0, items.length - 7));
    document.querySelector('#recent .rtrack').style.transform = 'translateX(' + (-off * 248) + 'px)';
    // Scroll the page so the whole poster row (title to labels) is on screen.
    var y = Math.max(0, recentTop() + RECENT_H - 1080 + BOTTOM_PAD);
    document.getElementById('page').style.transform = 'translateY(' + (-y) + 'px)';
    document.body.classList.toggle('scrolled', y > 0);
  }

  function leaveRecent() {
    if (recFocus < 0) return;
    recFocus = -1;
    var cards = document.querySelector('#recent .rtrack').children;
    for (var k = 0; k < cards.length; k++) cards[k].classList.remove('focus');
  }

  // ---- opening Plex

  function preload() {
    clearTimeout(preloadTimer);
    if (!plexCfg().preload) return;
    preloadTimer = setTimeout(function () {
      if (!document.hidden) plexPy('preload');
    }, PRELOAD_DELAY);
  }

  // resume: play from where it was left; otherwise show the title's page.
  function openPlex(it, resume) {
    plexPy((resume ? 'play ' : 'open ') + it.key, function (r) {
      if (!r || !r.ok) launch({ id: PLEX_APP });
    });
  }

  // ---- Settings > Plex

  function statusLine() {
    if (status.error === 'no token') return t('plexNoToken');
    if (status.error) return t('plexFailed', status.error);
    if (!status.at) return t('plexLoading');
    var d = new Date(status.at * 1000);
    return t('plexUpdated', ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2));
  }

  // Its settings, under its switch in Settings > Features.
  function plexRows() {
    var p = plexCfg();
    return [
      { label: t('plexAccount'), chevron: true, action: openAccount,
        value: account === null ? '…' : account ? account.user : t('plexSignedOut') },
      { label: t('plexContinue'), value: p.continue ? t('on') : t('off'), action: function () {
        setPlex('continue', !p.continue); refreshTop();
      } },
      stepRow(t('plexCwShow'), t({ always: 'plexAlways', plex: 'plexOnPlex', up: 'plexOnUp' }[p.cwShow]), function (d) {
        var i = CW_SHOW.indexOf(p.cwShow) + d;
        if (i < 0 || i >= CW_SHOW.length) return;
        setPlex('cwShow', CW_SHOW[i]); refreshTop();
      })
    ].concat(p.cwShow === 'plex' && plexTile() < 0 ? [{ info: true, label: t('plexOnPlexHint') }] :
             p.cwShow === 'up' ? [{ info: true, label: t('plexOnUpHint') }] : []).concat([
      { label: t('plexRecent'), value: p.recent ? t('on') : t('off'), action: function () {
        setPlex('recent', !p.recent); refreshTop();
        if (!p.recent) refreshRows(function () { refreshTop(); });   // posters are fetched when switched on
      } },
      { label: t('plexPreload'), value: p.preload ? t('on') : t('off'), action: function () {
        setPlex('preload', !p.preload); refreshTop();
        // Off also closes the hidden copy (TV Home is in front, so it isn't in use).
        if (p.preload) exec('luna-send -n 1 luna://com.webos.applicationManager/closeByAppId \'{"id":"' + PLEX_LINK + '"}\'');
        else preload();
      } },
      { label: t('plexLibraries'), chevron: true, action: openLibraries },
      { label: t('plexRefresh'), action: function () {
        status = { at: 0, error: '' }; refreshTop();
        refreshRows(function () { refreshTop(); });
      } },
      { info: true, label: statusLine() }
    ]);
  }

  // The movie and show libraries with a check mark; at least one stays ticked.
  // None stored = all of them.
  function openLibraries() {
    var libs = null, failed = '', changed = false;
    var view = menu({
      title: t('plexLibraries'),
      sub: t('plexLibsHint'),
      rows: function () {
        if (!libs) return [{ info: true, label: failed === 'no token' ? t('plexNoToken') : failed ? t('plexFailed', failed) : t('plexLoading') }];
        var p = plexCfg(), all = !p.sections.length;
        return libs.map(function (l) {
          var key = String(l.key);
          return { label: l.title, check: all || p.sections.indexOf(key) >= 0, action: function () {
            var cur = all ? libs.map(function (x) { return String(x.key); }) : p.sections.slice();
            var i = cur.indexOf(key);
            if (i >= 0) cur.splice(i, 1); else cur.push(key);
            if (!cur.length) return;
            setPlex('sections', cur);
            changed = true;
            view.refresh();
          } };
        });
      },
      onClose: function () { if (changed) refreshRows(); }
    });
    plexPy('libraries', function (d) {
      if (d && d.libraries) libs = d.libraries; else failed = (d && d.error) || 'no answer';
      view.refresh();
    });
  }

  // ---- Settings > Plex > Account: Plex's TV sign-in. The TV shows a code, the
  // person enters it at plex.tv/link, and plex.py gets a token for this TV (its
  // own device under their Plex account), so everyone uses their own account and
  // sees their own rows, also on a server someone shared with them.

  function loadAccount(done) {
    plexPy('account', function (a) {
      if (a && a.user) account = a;
      else if (a && a.error === 'no token') account = '';
      if (done) done();
    });
  }

  function openAccount() {
    // Not known yet (Plex didn't answer): ask once more before offering a new sign-in.
    if (account === null) return loadAccount(function () { if (account !== null) openAccount(); });
    if (!account) return signIn();
    menu({
      title: t('plexAccount'),
      rows: function () {
        if (!account) return [{ info: true, label: t('plexSignedOut') }];
        return [
          { info: true, label: t('plexSignedInAs', account.user) + (account.server ? ' · ' + t('plexServer', account.server) : '') },
          { label: t('plexSignOut'), danger: true, action: function () {
            confirmSheet(t('plexSignOutQ'), t('plexSignOutSub'), t('plexSignOut'), function () {
              plexPy('signout', function () {
                account = '';
                adopt({ error: 'no token' });
                pop();
              });
            });
          } }
        ];
      }
    });
  }

  function signIn() {
    var el = layer();
    el.innerHTML = '<div class="panel sheet plexSignIn"><h1></h1><div class="code">…</div><div class="sub"></div></div>';
    el.querySelector('h1').textContent = t('plexSignIn');
    var code = el.querySelector('.code'), sub = el.querySelector('.sub');
    sub.textContent = t('plexSignInHint');
    var view = { el: el }, timer = null, open = true;
    view.key = function (e) { if (e.keyCode === KEY.BACK || e.keyCode === KEY.LEFT) pop(); };
    view.ok = function () {};
    view.onClose = function () { open = false; clearTimeout(timer); };
    function start() {
      plexPy('signin', function (r) {
        if (!open) return;
        if (!r || !r.code) { code.textContent = '–'; sub.textContent = t('plexSignInFailed'); return; }
        code.textContent = r.code;
        sub.textContent = t('plexSignInHint');
        check();
      });
    }
    // Asks every 3 s until the code was entered; a new code when it ran out.
    function check() {
      timer = setTimeout(function () {
        plexPy('signin-check', function (r) {
          if (!open) return;
          if (r && r.done) {
            account = { user: r.user, server: r.server };
            pop();
            refreshRows(function () { loadAccount(); });   // the new account's rows (and its server's name)
            return;
          }
          if (r && r.expired) start(); else check();
        });
      }, 3000);
    }
    push(view);
    start();
  }

  // ---- the module's hooks (see modules/README.md)

  var Plex = {
    id: 'plex',
    title: { en: 'Plex', de: 'Plex' },
    defaults: { plex: {} },   // its settings; empty = defaults (plexCfg)
    // TV Home (re)loads: rows from disk and plex.py, then keep Plex ready.
    load: function () { loadRows(); preload(); },
    // Before the app grid is rebuilt (that moves the focus to the grid) ...
    keep: function () { return { cw: cwFocus, rec: recFocus }; },
    // ... and after it: rows again, the recent row below the new last app row.
    refresh: function (kept) {
      if (kept) { cwFocus = kept.cw; recFocus = kept.rec; }
      renderCW();
      renderRecent();
    },
    // The focus went to the top buttons or the app grid.
    leave: function () { leaveCW(); leaveRecent(); setTimeout(showCW, 0); },
    // Home pressed again: back to a clean start.
    reset: function () {
      leaveCW();
      leaveRecent();
      cwLast = recLast = 0;
      positionCW();
      document.querySelector('#recent .rtrack').style.transform = '';
    },
    // Remote keys on the home screen; true when Plex handled the key.
    key: function (e) {
      var k = e.keyCode;
      if (topFocus >= 0) {
        if (k === KEY.DOWN && cwShown()) { focusCW(cwLast); return true; }
        return false;
      }
      // Continue Watching: Left/Right along the row, Up to the buttons, Down to the apps.
      if (cwFocus >= 0) {
        if (k === KEY.LEFT) focusCW(cwFocus - 1);
        else if (k === KEY.RIGHT) focusCW(cwFocus + 1);
        else if (k === KEY.UP) focusTop(0);
        else if (k === KEY.DOWN) {
          var back = plexCfg().cwShow === 'plex' ? plexTile() : -1;   // back to the Plex tile it came from
          leaveCW();
          mainGrid.setFocus(back >= 0 ? back : Math.min(mainGrid.focus, COLS - 1), true);
        }
        else if (k === KEY.BACK) focusCW(0);
        return true;
      }
      // New in your libraries: Left/Right along the row, Up back to the last app row.
      if (recFocus >= 0) {
        var n = mainGrid.entries.length;
        if (k === KEY.LEFT) focusRecent(recFocus - 1);
        else if (k === KEY.RIGHT) focusRecent(recFocus + 1);
        else if (k === KEY.UP) {
          var col = mainGrid.focus % COLS;
          leaveRecent();
          mainGrid.setFocus(Math.min(n - 1, Math.floor((n - 1) / COLS) * COLS + col), true);
        } else if (k === KEY.BACK) { leaveRecent(); mainGrid.setFocus(0, true); }
        return true;
      }
      if (editMode || mainGrid.moving >= 0) return false;
      // Down from the last app row goes to the posters.
      if (k === KEY.DOWN && recItems().length &&
          Math.floor(mainGrid.focus / COLS) === Math.floor((mainGrid.entries.length - 1) / COLS)) {
        focusRecent(recLast);
        return true;
      }
      // Up from the first app row goes to Continue Watching.
      if (k === KEY.UP && cwFromTile(mainGrid.focus)) { focusCW(cwLast); return true; }
      return false;
    },
    // OK on a card; true when Plex handled it.
    ok: function () {
      if (cwFocus >= 0) { if (once()) openPlex(cwItems()[cwFocus], true); return true; }
      if (recFocus >= 0) { if (once()) openPlex(recItems()[recFocus]); return true; }
      return false;
    },
    // A long OK on a card does nothing.
    longOk: function () { return cwFocus >= 0 || recFocus >= 0; },
    // The Plex app tile opens the copy kept ready; true when Plex handled it.
    launch: function (app) {
      if (app.id !== PLEX_APP || app.store) return false;
      luna('luna://com.webos.applicationManager/launch', { id: PLEX_LINK }, function (res) {
        if (res.returnValue === false) launch({ id: PLEX_APP, store: true });
      });
      return true;
    },
    // The row in TV Home's Settings.
    about: { en: 'Continue Watching from your Plex server above the apps.', de: 'Weiterschauen von deinem Plex-Server über den Apps.' },
    settings: plexRows,
    featureOpen: function () { loadAccount(refreshTop); },
    start: function () { cw.style.display = recent.style.display = ''; Plex.refresh(); },
    // Switched off in Features: the rows go (Plex kept ready stays until
    // the TV closes it); on: they come back.
    toggled: function (on) {
      leaveCW();
      leaveRecent();
      cw.style.display = recent.style.display = on ? '' : 'none';
      if (on) { Plex.refresh(); Plex.load(); }
    },
    strings: STRINGS_PLEX
  };

  // Start: the two rows' elements; the rows themselves come with start and load.
  var page = document.getElementById('page');
  var cw = document.createElement('div');
  cw.id = 'cw';
  cw.innerHTML = '<div class="cwtitle"></div><div class="cwtrack"></div>';
  page.insertBefore(cw, document.getElementById('grid'));
  var recent = document.createElement('div');
  recent.id = 'recent';
  recent.innerHTML = '<div class="cwtitle"></div><div class="rtrack"></div>';
  page.appendChild(recent);
  cw.style.display = recent.style.display = 'none';   // until start (not at all while switched off)
  addModule(Plex);
})();
