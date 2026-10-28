// App Store switch for TV Home (part of the privacy lock, see install.sh):
// the block list in /etc/hosts also locks the LG Content Store. Settings >
// App Store opens it through tv/store-mode.sh, which re-locks on its own as
// soon as the Store is left (after 10 minutes at the latest). Without the block on the TV the row doesn't appear.
(function () {
  var STORE_MODE = '/var/lib/webosbrew/store-mode.sh';
  var state_ = { available: false, open: false, left: 0 };

  function load(cb) {
    exec('[ -f ' + STORE_MODE + ' ] && sh ' + STORE_MODE + ' status', function (res) {
      var out = (res.stdoutString || '').trim();
      state_.available = /^(blocked|open)/.test(out);
      state_.open = out.indexOf('open') === 0;
      state_.left = parseInt(out.split(' ')[1], 10) || 0;
      if (cb) cb();
    });
  }

  function label() {
    return state_.open ? t('storeOpen', Math.max(1, Math.ceil(state_.left / 60))) : t('storeLocked');
  }

  function toggle() {
    var opening = !state_.open;
    exec('sh ' + STORE_MODE + ' ' + (opening ? 'on' : 'off'), function () {
      load(function () {
        refreshTop();
        if (opening) launch({ id: 'com.webos.app.discovery', params: {} });
      });
    });
  }

  INFO.settings.lines.push({ en: 'App Store: open until you leave it (max 10 min)', de: 'App Store: offen, bis du ihn verlässt (max. 10 Min.)' });

  addModule({
    id: 'store',
    strings: {
      en: { appStore: 'App Store', storeLocked: 'Locked', storeOpen: 'Open · {0} min' },
      de: { appStore: 'App Store', storeLocked: 'Gesperrt', storeOpen: 'Offen · {0} Min.' }
    },
    settingsOpen: function () { load(refreshTop); },
    settingsRows: function () {
      return state_.available ? [{ label: t('appStore'), value: label(), action: toggle }] : [];
    }
  });
})();
