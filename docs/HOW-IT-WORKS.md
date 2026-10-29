# How it works

The overview: where everything lives, what runs when, and how TV Home
replaces LG's home screen. Each module's page explains its own internals:
[Picture Frame](modules/picture-frame.md), [Plex](modules/plex.md),
[Philips Hue](modules/hue.md), [Remote Buttons](modules/remote-buttons.md),
[AV receiver button](modules/av-receiver.md), [privacy lock](modules/privacy-lock.md),
[tracking services](modules/tracking-services.md), [app trimming](modules/app-trim.md),
[telnet off](modules/telnet-off.md). Sharp logos: [LOGOS.md](LOGOS.md).

## Where everything lives

The root file system and `/etc` are read only and are never changed. Everything
is in two places, plus `/tmp` for things that should vanish at reboot:

| Path on the TV | What | From |
|---|---|---|
| `/media/developer/apps/usr/palm/applications/com.iso.atvhome/` | TV Home (with the chosen modules bundled in `modules.js` / `modules.css`) | TV Home |
| `.../com.iso.plexlink/` | hidden Plex helper app | Plex |
| `.../com.iso.moviescene/` | the Light app (`hue.py`, `scene.sh`) | Philips Hue |
| `.../com.iso.appupdates/` | App-Updates app | privacy lock without TV Home |
| `/var/lib/webosbrew/init.d/` | boot hooks (below) | several |
| `/var/lib/webosbrew/atvhome/` | `config.json`, your wallpapers, `tiles/`, `autotiles/`, Plex sign-in files | TV Home, Plex |
| `/var/lib/webosbrew/remote-mapper/` | the key filter and your button map | Remote Buttons |
| `/var/lib/webosbrew/hue-scene.conf`, `hue-scene.mode` | Hue pairing and button setup | Philips Hue |
| `/var/lib/webosbrew/lg-ad-block-hosts.txt`, `store-mode.sh` | block list, store switch | privacy lock |
| `/var/lib/webosbrew/debloat.sh`, `debloat.conf`, `debloat-stub` | service block | tracking services |
| `/var/lib/webosbrew/app-trim.sh` | app watcher | app trimming |
| `/var/webos-profile/override/atvhome_profile.json` | makes TV Home the home app after boot | TV Home |
| `/var/luna/preferences/webosbrew_telnet_disabled` | Homebrew's telnet switch | telnet off |

## Boot scripts

Homebrew Channel runs everything in `/var/lib/webosbrew/init.d/` at boot, one
script after another, and keeps its **failsafe flag** armed until the last one
has returned (plus 10 seconds). If the TV powers off while the flag is armed,
the next boot starts in failsafe mode with a "crash" message. So every boot
script here returns at once and does its slow work in the background:

| Script | Does | Module |
|---|---|---|
| `50-keep-web-apps` | stops LG restarting the web-app manager about 80 s after boot, which would close TV Home (runtime drop-in for `lsm-ready.service`) | TV Home |
| `60-lg-ad-block` | adds the block list to `/etc/hosts` (instant) | privacy lock |
| `80-debloat` | after 45 s, stops the selected LG services (`debloat.sh apply`) | tracking services |
| `85-app-trim` | after 60 s, starts the app watcher (`app-trim.sh`) | app trimming |
| `86-remote-mapper` | after 20 s, puts the key filter back (`remote-mapper.sh apply`) | Remote Buttons |
| `87-frame-saver` | after 30 s, starts the screensaver guard (`framesaver.py`) | Picture Frame |

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

- **Modules**: everything beyond the home screen (Picture Frame, Plex, Hue,
  Remote Buttons, AV receiver, App Store) lives in
  `apps/tv-home/modules/<id>/`. `install.sh` joins the chosen ones into
  `modules.js` / `modules.css` and copies their helper files next to
  `app.js`; `app.js` calls their hooks at fixed points (`hook`, `claim`).
  The hooks and how to write one: `apps/tv-home/modules/README.md`.
- **Data**: `launchpoints.sh` runs as root through Homebrew Channel's `exec`
  service, because `listLaunchPoints` and `listApps` are private. It returns
  LG's launch points (order, HDMI device names) and the installed apps.
  `cache.js` copies icons and wallpapers into the app folder, because the web
  runtime can't load files from other folders.
- **Previews**: `wallpapers/thumbs/<name>` (640x360) is used on picture
  cards when it exists, so a grid never decodes every full-size picture.
- **Config**: `/var/lib/webosbrew/atvhome/config.json`, written by `config.sh`
  (base64 through exec): `{language, wallpaper, clock, cards, order[],
  folders{}, hidden[], added[], modules{}, ...}` plus each module's own keys
  (`frame`, `plex`, `avrButton`). Keys TV Home doesn't know are kept, so a
  module's settings survive while it is off or not installed. Apps LG shows are on the home screen unless they are in
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
- **Help legends**: `INFO` in `app.js` holds each screen's legend (title,
  short lines, English and German); `{ok}`, `{hold}`, `{arrows}` and so on in
  any hint string become key caps (`hintHTML`). `toggleLegend(id)` shows it
  in a corner without taking the keys; `push`/`pop` close it. Grid screens
  get their "i" from `infoButton()`, menus from `spec.info`.
- **Languages**: `STRINGS` in `app.js` (modules bring their own texts),
  English by default and German. The Light and App-Updates apps read the
  language from the launcher config.
- **Sharp logos**: cut out of the apps' splash screens, see [LOGOS.md](LOGOS.md).

## The installer

- `install.sh` shows the checklist, saves the choices in `setup.conf` (no
  secrets) and looks at what is on the TV now (`installed_modules` in
  `lib/common.sh`, by the files each module leaves). Modules on the TV but no
  longer chosen are removed (`remove_<module>`), then the chosen ones are
  installed or updated in place. `uninstall.sh` runs every removal.
- TV Home is built per TV: `stage_home` copies `apps/tv-home` without
  `modules/`, joins `modules/<id>/<id>.js` and `.css` of the chosen modules
  into `modules.js` / `modules.css`, and copies their other files next to
  `app.js`. `build_ipk` packs it, `install_app` installs it through
  `appInstallService/dev/install`.
- How modules plug into TV Home (hooks, writing one): `apps/tv-home/modules/README.md`.

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
