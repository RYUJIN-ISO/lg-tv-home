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
- **Pictures**: one library for Wallpaper and Picture Frame (`library()` in
  `app.js`). A crop is only a position, so it never needs a new file. A USB
  import is scaled in the web view (`canvas`, JPEG at 90%, at most about 18
  megapixels) and goes to the TV in 100 KB base64 pieces through `exec`,
  because one argument may not exceed 128 KiB (`MAX_ARG_STRLEN`); `usb.py`
  puts them back together and stores the crop's preview in
  `wallpapers/thumbs/`. Image URLs carry `?v=<mtime>` so a changed file is
  not shown from the cache.
- **Picture frame**: drawn with WebGL, not CSS (CSS animation of a large
  layer makes the compositor rasterise tiles while it moves, which hitches).
  Each picture is one GPU texture. Loading never touches the motion:
  `frameworker.js` (a Web Worker) decodes the file once and sends RGB strips
  of 64 rows; the main thread only copies ready strips into the texture,
  4 ms per frame at most. Fallbacks: decode on the main thread from a blob,
  or an `<img>` cut by a canvas. (Cutting strips straight from an `<img>`
  re-decodes the whole JPEG per strip on the TV: measured 4 fps.) The next
  picture is preloaded while the current one shows, so CH+ and the timer
  switch at once; crossfades take 0.7 s. Every frame draws the texture at a
  moving offset: Every view is a window (x, y, width) into
  the picture, so travel and zoom interpolate together. Pan with a still
  frame: a one-way trip from the window farthest from the frame to the frame
  (cosine eased, about 7 screen pixels per second, started closer when it
  would not arrive within 85% of the change interval), then a 2% drift on the
  frame. Pan without one: corner to corner and back. Still: the frame or the
  centre, filling the screen, with the 2% drift. Picture folders are
  `pictureFolders = [{id, name, items}]`, shared by Wallpaper and Picture
  Frame; `frame.show` is the folder the frame plays. Crops live in the config (`crops[name] = {x, y, w, r}`, fractions plus
  the picture's shape), shared with the home wallpaper (CSS background size
  and position), and never change the file. Dimming happens in the shader. Frame
  times, slow frames during loads and the load path are appended to
  `/tmp/atvhome-frame.txt` when the frame ends.
- **Screensaver**: tvpowerd starts it, after asking every client registered
  with `com.webos.service.tvpower/power/registerScreenSaverRequest`; a single
  `responseScreenSaverRequest {clientName, ack: false, timestamp}` keeps it
  away. `keepawake.py` (started in the background through `exec` when the
  frame starts) answers "no" while the launcher touches
  `/tmp/atvhome-awake.beat` every minute, and quits when the heartbeat is
  older than 150 s, so it can never block the screensaver for good. The
  launcher also restarts surface-manager's idle timer
  (`com.webos.surfacemanager.screenSaver/restartUserActivityTimer`). Remote
  buttons start the frame by launching TV Home with `{"frame": true}`.
- **Help legends**: `INFO` in `app.js` holds each screen's legend (title,
  short lines, English and German); `{ok}`, `{hold}`, `{arrows}` and so on in
  any hint string become key caps (`hintHTML`). `toggleLegend(id)` shows it
  in a corner without taking the keys; `push`/`pop` close it. Grid screens
  get their "i" from `infoButton()`, menus from `spec.info`.
- **Screensaver guard**: `framesaver.py` (started by `init.d/87-frame-saver`
  and by TV Home). tvpowerd asks registered clients before its screensaver
  (`registerScreenSaverRequest`) but starts it whatever they answer, about 3 s
  later (tested with both answers). So the guard works from tvpowerd's power
  state (`getPowerState`): with Instead of Screensaver on (`frame.saver`), on
  "Screen Saver" it starts the frame behind LG's screensaver and closes LG's
  after 10 s, so the frame is already there (no black, no home screen). A key
  during those 10 s ends the hidden frame and returns to the app before.
  While a frame runs, the guard switches LG's screensaver off
  (`general.screenSaverEnabled`, which tvpowerd follows live) and back on
  afterwards; a marker file makes it undo that after a crash or power cut,
  and a screensaver the user switched off stays off. If LG's still comes up
  over a running frame, it is closed at once. The frame ignores key codes
  1536/1537 (the pointer showing or hiding, also sent when another window
  takes the focus), and waits 5 s before ending when TV Home is hidden.
  LG's timer (`option.screenSaverTimer`, 3 min) can't be changed on this
  model. Log: `/tmp/atvhome-saver.log`; why a frame ended:
  `/tmp/atvhome-events.log`.
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

## Plex

All of it is in `apps/tv-home/plex.js`, `plex.css`, `plex.py`, `devtools.py`
and `apps/plex-link/`. `app.js` only calls `window.Plex` at a few places
(each guarded), so without `plex.js` TV Home works as before.

**Signing in.** `plex.py signin` asks plex.tv for a PIN (`POST
/api/v2/pins`), the TV shows its code, and `plex.py signin-check` polls
`/api/v2/pins/<id>` every 3 seconds until the person entered the code at
plex.tv/link; then the PIN carries a token for this TV. Each TV identifies
itself with its own random client id (made once, in
`/var/lib/webosbrew/atvhome/plex-client-id`), so every TV is its own device
under the account, named "TV Home" plus the id's last 4 characters, and can be
removed there. Next to the id the file keeps hashes of the TV's LAN and Wi-Fi
addresses (never sent anywhere): when the data folder was copied from another
TV, none matches, so the id is replaced and the copied sign-in dropped.
Switching between LAN and Wi-Fi changes nothing. Signing out forgets the id
too; the next sign-in is a new device. Plex
keys from the server (items, libraries) must be numbers; anything else is
skipped, as they end up in file names and in TV Home's root shell commands. The token is in
`/var/lib/webosbrew/atvhome/plex-token` (root only, mode 600); it never
reaches the web page or a picture URL.

**Finding the server.** `plex.tv/api/v2/resources` lists the servers the
account can use: its own first, else one shared with it, direct connections
before relays. The working address, its server token, id and name are
cached for 6 hours in `plex-server.json` (mode 600) and looked up again when
the address stops answering. A shared server answers with the signed-in
person's own Continue Watching and watch state.

**Rows.** `plex.py` reads `/hubs/continueWatching` (and the libraries'
`recentlyAdded` when that row is on), saves the pictures scaled by the
server into the app's `cache/plex/`, and writes `cache/plex/rows.json`. The
page shows that file right away and asks `plex.py get`, which refreshes in
the background when the rows are older than 15 minutes.

**Opening Plex at a title.** The store app (`cdp-30`) is a small encrypted
loader for the Plex web app at `app.plex.tv/tv-v5-webos/`, and that web app
ignores launch parameters, so deep links can't work. Instead:

1. `apps/plex-link` (`com.iso.plexlink`, hidden from the app list) is a
   developer mode app that only loads the same Plex web app. It shares the
   Plex sign-in with the store app (same origin, same storage).
2. Developer mode apps can be inspected over the TV's DevTools port
   (`127.0.0.1:9998`, WAM's remote debugging); store apps can't.
3. `plex.py play <id>` / `open <id>` launches plexlink, waits until Plex has
   drawn its screen and is signed in, then calls Plex's own
   `appController.processDeepLink` with the item (and its resume offset)
   through `devtools.py`, a small standard library DevTools client. The
   result of the last call is in `/var/lib/webosbrew/atvhome/plex-play.log`.
4. If any of this fails, Plex simply stays on its home screen; if plexlink
   is missing, the store app opens.

Plex's code is minified and changes with Plex updates, so the script finds
the module that exports Plex's service container by its source text, not
by its number. It must not touch that module before Plex has drawn its
first screen: loading it early runs Plex's start-up out of order and leaves
a black screen.

**Keeping Plex ready.** A few seconds after TV Home is shown (also at power
on, when the TV opens the home app), `plex.py preload` launches plexlink
with the app manager's `"preload": "full"` mode, which starts it hidden, but
only when someone is signed in and it isn't already running. Background apps
survive the TV's standby. App trimming never closes `com.iso.*` apps.

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
