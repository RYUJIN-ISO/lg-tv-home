# Remote Buttons

Give the remote's buttons (Netflix, Prime, Mic, Input, colour and number
keys, ...) any app or action.

| | |
|---|---|
| Installer | **Remote buttons** (`REMOTE`), part of TV Home |
| Switch | Settings, **Features**, **Remote Buttons**. Off: every button does what LG made it do (stays off across reboots) |
| On the TV | `/var/lib/webosbrew/remote-mapper/` (`remap.js`, `remote-mapper.sh`, your map in `map.json`); boot hook `init.d/86-remote-mapper` |
| Removed by | unticking it in `install.sh` (restores LG's key handling; `map.json` stays) |

## Using it

Settings, **Features**, **Remote Buttons**, **Buttons** shows a drawing of
the Magic Remote. Move over it with the arrows or point at a button; the
card next to it shows what the button does now. **OK** opens its choices:

- **LG default** or **Do nothing**
- **Home screen**, **Picture Frame**, **Light**, **Live TV**, **HDMI 1** to **4**
  (Picture Frame and Light when those modules are on)
- **App ...**: every installed app as a card

Remapped buttons get a green ring. Power, volume, mute, home, back, settings,
the arrows and OK are greyed out and can't be changed, so the TV always stays
under control. Below the card: **Other button** (for a button the drawing
doesn't have: press it within 20 seconds, then choose) and **Reset** (every
button back to LG default). Changes work at once, and the original app never
opens.

## How it works

LG Input Hook's `ezinject` approach does not work on webOS 24 and 25. What
actually decides what a button does:

1. `lginput2` receives the remote and logs `NL_BUTTON_CLICK {KEY_NETFLIX}`.
2. **surface-manager** runs a chain of QML/JavaScript key filters
   (`/usr/lib/qt5/qml/KeyFilters/*.js`). App buttons go through
   `appLaunch.js` and LG's `cpHotkeyInfo.mapping_info`.
3. LG's `other/mapping_info` setting can't be used: surface-manager reads it
   once at start, and on every power on LG's mapping is fetched from LG's
   server (through `sdx`) and written back.
4. **The chain itself is a configd value**,
   `com.webos.surfacemanager.keyFilters` (`[{file, handler}]`), which
   surface-manager subscribes to and reloads at once.
   `com.webos.service.config/setConfigs` (runtime only, never saved) inserts
   `remap.js` right after LG's `handleScreenSaver`. It is loaded with
   `Qt.include` and gets the same globals as LG's filters (`lunaCall`,
   `KeyPolicy`, `WebOS`, `Qt`). For a mapped key it launches the target and
   returns `KeyPolicy.Accepted`; everything else passes on.
5. Buttons are named after LG's `WebOS.Key_webOS_*` constants, `Qt.Key_*`,
   or `code:<n>`.
6. **Other button** (learn mode): the filter publishes key presses into a
   custom configd value (`com.iso.remotemapper.learned`), because
   surface-manager may not call Homebrew's `exec`. Learn mode ends by itself
   after 30 seconds and never swallows navigation keys.

No LG file is changed. An error in the filter falls back to LG's handling,
and a reboot restores LG's chain until `86-remote-mapper` adds the filter
again (20 s after boot, with retries). The file
`/var/lib/webosbrew/remote-mapper/disabled` keeps it off; that is what the
Features switch sets.

Commands (`remote-mapper.sh`): `apply`, `remove`, `status`, `getmap`,
`setmap <base64>`, `enable`, `disable`, `learn on|off`, `learned`.

Code: `apps/tv-home/modules/remote/`, `tv/remote-mapper/`.
