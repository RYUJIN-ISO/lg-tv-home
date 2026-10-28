// AV receiver button for TV Home (Settings > Features > AV receiver button): a
// top-left button that selects HDMI eARC as the sound output, the same as
// LG's sound output menu. When the receiver switched itself off, the TV falls
// back to its speakers; choosing eARC again makes the TV ask the receiver
// over CEC to come on.
(function () {
  var ICON = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M3 9v6h4l5 4V5L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>';
  var hintTimer = null;

  function soundToAvr() {
    exec("luna-send -n 1 -w 8000 luna://com.webos.service.apiadapter/audio/changeSoundOutput '{\"output\":\"external_arc\"}'", function (res) {
      var ok = /"returnValue":\s*true/.test(res.stdoutString || '');
      showHint(ok ? t('avrOn') : t('avrFailed'));
      clearTimeout(hintTimer);
      hintTimer = setTimeout(function () { showHint(editMode ? t('editHint') : ''); }, 2500);
    });
  }

  addModule({
    id: 'avr',
    title: { en: 'AV receiver button', de: 'Taste AV-Receiver' },
    strings: {
      en: { avr: 'AV Receiver', avrOn: 'Sound to the AV receiver (HDMI eARC)',
            avrFailed: 'The TV did not switch the sound output.' },
      de: { avr: 'AV-Receiver', avrOn: 'Ton zum AV-Receiver (HDMI eARC)',
            avrFailed: 'Der TV hat den Tonausgang nicht umgeschaltet.' }
    },
    about: { en: 'A button at the top left that sends the sound to the AV receiver on HDMI eARC (and wakes it).',
             de: 'Eine Taste oben links, die den Ton zum AV-Receiver über HDMI eARC schickt (und ihn weckt).' },
    // Off until switched on in Settings > Features (it used to be a Look
    // setting, avrButton; that stays its switch).
    defaults: { avrButton: false },
    isOn: function () { return cfg().avrButton === true; },
    setOn: function (on) { cfg().avrButton = on; },
    topButtons: function () { return [{ icon: ICON, title: t('avr'), action: soundToAvr }]; }
  });
})();
