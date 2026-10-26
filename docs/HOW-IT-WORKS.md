# How it works

Everything lives in two places on the TV: developer mode apps under
`/media/developer/apps/usr/palm/applications/`, and scripts plus data under
`/var/lib/webosbrew/`. The root file system and `/etc` are read only and are
never changed.

## Boot scripts

Homebrew Channel runs everything in `/var/lib/webosbrew/init.d/` at boot, one
script after another, and keeps its **failsafe flag** armed until the last one
has returned (plus 10 seconds). If the TV powers off while the flag is armed,
the next boot starts in failsafe mode with a "crash" message. So every boot
script here returns at once and does its slow work in the background:

| Script | Does |
|---|---|
| `60-lg-ad-block` | adds the block list to `/etc/hosts` (instant) |
| `80-debloat` | after 45 s, stops the selected LG services (`debloat.sh apply`) |
| `85-app-trim` | after 60 s, starts the app watcher (`app-trim.sh`) |
| `86-remote-mapper` | after 20 s, puts the remote mapper back (`remote-mapper.sh apply`) |

## Replacing the home screen

LG's home (`com.webos.app.home`) is a Flutter release build. Its
`flutter_assets/assets/home*.xml` files only arrange fixed parts (ad banner,
app row, recommendations); how they look is compiled Dart in `libapp.so`. So
TV Home is a separate web app that becomes *the* home app:

1. Its `appinfo.json` declares `"appCategory": ["home"]`.
2. The TV setting `general/defaultApps.home` points to it. surface-manager
   opens the home app with `launchDefaultApp {"category":"home"}` when Home is
   pressed, so the Home button opens TV Home.
3. A profile override, `/var/webos-profile/override/atvhome_profile.json`,
   sets `idleApp` and `defaultApps.categories.home`, so the TV also shows TV
   Home after boot and after the last app closes. `systemprofile/debug/rescan`
   applies it right away. (The override does not accept `blockedApps`.)

LG's Flutter home still starts at boot and stays hidden (about 100 MB). It is
in the read only `keepAliveApps` list, ignores `closeByAppId` and shares its
`flutter-client` runtime with the screensaver, so it is left alone.

## The launcher

- **Data**: `launchpoints.sh` runs as root through Homebrew Channel's `exec`
  service, because `listLaunchPoints` and `listApps` are private. It returns
  LG's launch points (order, HDMI device names) and the installed apps.
  `cache.js` copies icons and wallpapers into the app folder, because the web
  runtime can't load files from other folders.
- **Previews**: `wallpapers/thumbs/<name>` (640x360) is used on picture
  cards when it exists, so a grid never decodes every full-size picture.
- **Config**: `/var/lib/webosbrew/atvhome/config.json`, written by `config.sh`
  (base64 through exec): `{language, wallpaper, clock, order[], folders{},
  hidden[], added[]}`. Apps LG shows are on the home screen unless they are in
  `hidden`; apps LG hides or that have no launch point only show when they are
  in `added`.
- **Rendering**: the app lays out at 1920x1080 but the TV draws it at
  **devicePixelRatio 2**, i.e. 3840x2160. That is why wallpapers are 4K and
  tile art is 640x384.
- **Smoothness** (`tools/bench.sh`, from about 56 to 60 fps and from 13 to 20
  dropped frames per run to 0 to 2): animated parts get their own GPU layers
  up front (`will-change`), the focus shadow is a `box-shadow` instead of
  `filter: blur`, the gloss and the label animate on their own layers so a
  focus change never repaints a card, the wallpaper and its shading are one
  layer, and the dimming layer stays on the GPU. There are no endless
  animations; an idle tilt animation alone cost about 45% CPU.
- **Wallpapers**: cropping runs in the web view (`canvas`, JPEG at 90%). The
  result goes to the TV in 100 KB base64 pieces through `exec`, because one
  argument may not exceed 128 KiB (`MAX_ARG_STRLEN`); `usb.py` puts them back
  together. Originals are kept in `wallpapers/originals/`, and image URLs
  carry `?v=<mtime>` so a new crop is not shown from the cache.
- **Picture frame**: drawn with WebGL, not CSS. Each picture is one GPU
  texture, uploaded in 64-row strips: `createImageBitmap` decodes and cuts
  each strip off the main thread, and a frame uploads only as many ready
  strips as fit in 4 ms, so a new picture never stalls the motion. Every frame
  draws the texture at a slowly moving offset: cover the screen, then travel
  between two corners at about 7 screen pixels per second with a cosine ease
  at each turn. Still frames are stored per picture in the config
  (`frame.focus[name] = {x, y, w}` as fractions), so they survive any
  resizing of the file and never change it. CSS animation of a large layer was avoided on purpose: the
  compositor rasterises big layers in tiles while they move, which can
  hitch. Crossfades blend the old and new texture; dimming happens in the
  shader. Frame times (and slow frames during loads, texture allocation
  and strip upload times) are appended to `/tmp/atvhome-frame.txt` when the
  frame ends. Without WebGL, two CSS images crossfade instead. LG's
  screensaver starts after 2 minutes
  without input (configd `com.webos.surfacemanager.userActivityTimeout`);
  while the frame runs, the launcher calls
  `com.webos.surfacemanager.screenSaver/restartUserActivityTimer` once a
  minute through `exec`. That only restarts the timer and never wakes the
  screen. Remote buttons start it by launching TV Home with `{"frame": true}`.
- **Languages**: `STRINGS` in `app.js`, English by default and German. The
  Light and App-Updates apps read the language from the launcher config.

## Remote button mapper

LG Input Hook's `ezinject` approach does not work on webOS 24 and 25. What
actually decides what a button does:

1. `lginput2` receives the remote and logs `NL_BUTTON_CLICK {KEY_NETFLIX}`.
   Its `/dev/uinput` devices are not how buttons reach the interface (a read
   only capture of `/dev/input/event*` saw almost nothing).
2. **surface-manager** runs a chain of QML/JavaScript key filters
   (`/usr/lib/qt5/qml/KeyFilters/*.js`). App buttons go through
   `appLaunch.js`, `handleCPHotkeys` and `cpHotkeyInfo.mapping_info`.
3. LG's own `other/mapping_info` setting can't be used: surface-manager reads
   it once at start, and on every power on it fetches LG's mapping from the
   server through `sdx` and writes it back.
4. **The chain is a configd value**, `com.webos.surfacemanager.keyFilters`
   (`[{file, handler}]`), which surface-manager subscribes to and reloads at
   once. `com.webos.service.config/setConfigs` (runtime only, not saved)
   inserts our own filter, `tv/remote-mapper/remap.js`. It is loaded with
   `Qt.include` and gets the same globals as LG's filters (`lunaCall`,
   `KeyPolicy`, `WebOS`, `Qt`). It sits right after `handleScreenSaver`; for a
   mapped key it launches the target and returns `KeyPolicy.Accepted`,
   everything else passes on with `NextPolicy`.
5. Buttons are named after LG's `WebOS.Key_webOS_*` constants (resolved by
   name, because QML enums can't be listed), `Qt.Key_*`, or `code:<n>`.
6. **Other button** (learn mode): the filter publishes key presses into a
   custom configd value (`com.iso.remotemapper.learned`). surface-manager may
   not call Homebrew's `exec`, but configd accepts new keys. Learn mode ends
   by itself after 30 seconds and never swallows navigation keys.

No LG file is changed, any error in the filter falls back to LG's handling,
and a reboot restores the stock chain until `86-remote-mapper` adds ours again.
`remote-mapper/disabled` keeps it off.

## Hue

`apps/hue-light/hue.py` (Python standard library, run as root) talks to the
bridge's v1 API over HTTPS (self-signed certificate) and keeps its settings
in `/var/lib/webosbrew/hue-scene.conf`: `BRIDGE`, `KEY`, `GROUP`, `SCENE`
(cinema), `RESTORE` (a GroupScene named "TV Home before" that stores the
lighting before cinema), `BACK` (`previous` or `scene`) and `BACK_SCENE`.
`hue-scene.mode` remembers whether cinema is on.

- **toggle**: cinema off, so (when `BACK=previous`) save the current lighting
  into the snapshot scene with `storelightstate`, then recall the cinema
  scene. Cinema on, so recall the snapshot or `BACK_SCENE`. `scene.sh` is a
  wrapper for it (Light button and the Philips Hue app, which remote buttons open).
- **status** returns rooms and zones with their lights and scenes (without the
  snapshot scene) in one call for the Hue screen; **room**, **light** and
  **scene** change things; **set** saves the button setup and creates the
  snapshot scene in the chosen room.
- **pair**: POST `/api` with `devicetype` until the bridge button is pressed;
  **discover** asks `discovery.meethue.com`.

## Privacy

- **Block list**: the base list of `hugobatista/lg-tv-ad-block`, duplicated
  for IPv6 (`::`), because apps otherwise reach blocked hosts over AAAA
  records.
- **Services** (`tv/debloat.sh`, groups from `/var/lib/webosbrew/debloat.conf`):
  systemd units are stopped and masked with `--runtime` (`/etc` is read only).
  Services the bus starts on demand get their program covered by a stub that
  exits right away, so callers fail in about 0.1 s instead of the bus starting
  them again. Kept on purpose: casting, `trigger_alexa` (needed by the Alexa
  button) and `sdx` (part of the broadcast stack; its uploads are blocked
  anyway).
- `systemctl` takes 10 to 20 seconds per call on these TVs, so applying or
  lifting takes 2 to 3 minutes and runs in the background. The newest call
  wins.
- **App Store**: `tv/store-mode.sh on` strips the block list for 10 minutes
  and lifts the service block; `off` (or the timer) restores both. TV Home's
  Settings and the App-Updates app both use it.

## App trimming

LG's `preload-manager` starts Netflix, YouTube, the browser, LG Channels,
voice and AirPlay at boot (about 300 MB on a TV with 1.9 GB, which leads to
heavy swapping). `app-trim.sh` replaces it: every 3 seconds it checks the app
on screen and closes all user apps except the current and the previous one.
System apps, inputs, the launcher and Homebrew are never touched. Only one
copy runs at a time (`/tmp/app-trim.pid`).

## Things that are easy to get wrong

- `luna-send` over SSH prints nothing when its stdin is the SSH channel. The
  redirect has to happen on the TV (`exec < /dev/null` in `lib/common.sh`).
  The first call after a pause sometimes gets no answer, so calls are retried.
- `pkill -f` and `pgrep -f` also match the shell that runs them, if its
  command line contains the pattern. Use PID files, `pkill -x`, or anchored
  patterns.
- Dropbear (the TV's SSH server) rejects very long commands.
- `/var/log/messages` is rotated every few minutes (`messages.0.gz`).
- With Quick Start+ off, every power on is a cold boot.
- LG's security manager logs `NL_ABNORMAL_MONITORING program1/program2` for
  telnetd and dropbear. That is its root detection; it only logs.
- A load average of 15 to 20 is normal: LG driver threads sleep in a state
  that counts as busy.
