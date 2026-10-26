# How it works

Everything lives in two places on the TV: developer-mode apps under
`/media/developer/apps/usr/palm/applications/` and scripts/config under
`/var/lib/webosbrew/` (Homebrew Channel runs `init.d/*` there at boot). The
root filesystem and `/etc` are read-only and are never modified.

## Replacing the home screen (no redirect)

LG's home (`com.webos.app.home`) is a **Flutter** release build: its
`flutter_assets/assets/home*.xml` only arrange fixed widgets (ad banner, app
row, recommendations); their look is compiled Dart (`libapp.so`). So instead
of reskinning it, TV Home is a separate web app made *the* home app:

1. `appinfo.json` declares `"appCategory": ["home"]`.
2. TV setting `general/defaultApps.home = com.iso.atvhome` — the app manager's
   `launchDefaultApp {"category":"home"}`, which surface-manager calls on the
   Home key, now opens TV Home.
3. Profile override `/var/webos-profile/override/atvhome_profile.json` sets
   `idleApp` + `defaultApps.categories.home`, so after boot / closing the last
   app the TV lands on TV Home too (`systemprofile/debug/rescan` applies it
   live). The override does *not* accept `blockedApps`.

LG's Flutter home still starts at boot and stays hidden (~100 MB): it is in
the read-only `keepAliveApps` list, ignores `closeByAppId`, and its
`flutter-client` runtime is shared with the screensaver, so it is left alone.

## The launcher

- Data: `launchpoints.sh` (run as root through Homebrew Channel's `exec`
  service, because `listLaunchPoints`/`listApps` are private) returns LG's
  launch points (order, HDMI device names) + installed apps; `cache.js` copies
  icons into the app folder (the web runtime can't load files from other apps).
- Config: `/var/lib/webosbrew/atvhome/config.json`, written via `config.sh`
  (base64 over exec). Shape: `{language, wallpaper, clock, order[],
  folders{id:{name,items[]}}, hidden[], added[]}`; keys are LG `launchPointId`s.
  LG-visible launch points are on the home screen unless in `hidden`; apps LG
  hid / without a launch point appear only if in `added`.
- Rendering: the app lays out at 1920×1080 but the TV draws it at
  **devicePixelRatio 2** (3840×2160) — hence 4K wallpapers and 640×384 tile art.
- Smoothness (measured with `tools/bench.sh`, ~56 → 60 fps, dropped frames per
  run 13-20 → 0-2): every animated element is pre-promoted to its own GPU
  layer (`will-change`), the focus shadow is a `box-shadow` (no `filter: blur`),
  the gloss/label animate on their own layers so a focus change never repaints a
  card, wallpaper + readability gradient are one layer, the dim overlay stays
  promoted (fading the 4K wallpaper itself was measured slower). No infinite
  animations — an idle "tilt" loop cost ~45 % CPU.
- i18n: `STRINGS` in `app.js` (English default, German). The Light and
  App-Updates apps read `language` from the launcher config.

## Privacy / debloat

- Hosts block: `hugobatista/lg-tv-ad-block` base list, duplicated for IPv6
  (`::`) — apps otherwise leak via AAAA records. `init.d/60-lg-ad-block`
  re-appends it on every boot (webosbrew regenerates `/etc/hosts`).
- Services (`tv/debloat.sh`, groups from `/var/lib/webosbrew/debloat.conf`):
  systemd units are stopped and `mask --runtime`d (`/etc` is read-only);
  hub-activated services get their binary bind-mounted with a stub that exits
  1, so callers fail in ~0.1 s instead of the hub respawning them. Kept on
  purpose: casting, `trigger_alexa` (remote button), `sdx` (wired into the
  broadcast stack; its uploads are DNS-blocked anyway).
- `systemctl` takes 10-20 s per call on these TVs → apply/lift run in the
  background (2-3 min); newest call wins.
- App-Updates: `store-mode.sh on` strips the hosts block for 10 min and runs
  `debloat.sh lift`; `off`/timeout restores both.

## App trimming

LG's `preload-manager` starts Netflix, YouTube, browser, LG Channels, voice
and AirPlay at boot (~300 MB on a 1.9 GB TV → heavy swapping). `app-trim.sh`
replaces it: every 3 s it checks the foreground app and closes all *user*
apps except the current and previous one. System apps, inputs, the launcher
and Homebrew are never touched.

## Gotchas (hard-won)

- `luna-send` over SSH prints nothing if its stdin is the SSH pipe — always
  `< /dev/null` (or `ssh -tt`). The first call after idle sometimes gets no
  reply: retry.
- `/var/log/messages` rotates every few minutes (`messages.0.gz`).
- With Quick Start+ off every power-on is a cold boot (uptime resets).
- LG's security manager logs `NL_ABNORMAL_MONITORING program1/program2` for
  telnetd/dropbear — root detection, logging only.
- Load average ~15-20 is normal: LG driver kthreads sleep in D state.
