# App trimming (speed)

Keeps only the app you are using and the one before it in memory, instead
of LG preloading five or six at boot.

| | |
|---|---|
| Installer | **Keep only the current and previous app in memory** (`APP_TRIM`) |
| Switch | none: on while installed |
| On the TV | `/var/lib/webosbrew/app-trim.sh`; boot hook `init.d/85-app-trim`; log `/tmp/app-trim.log` |
| Removed by | unticking it in `install.sh` |

## Why

LG's `preload-manager` starts Netflix, YouTube, the browser, LG Channels,
voice and AirPlay at boot: about 300 MB on a TV with 1.9 GB, which leads to
heavy swapping and a sluggish interface. With app trimming, the
[tracking services](tracking-services.md) module also stops `preload-manager`.

## How it works

Every 3 seconds `app-trim.sh` checks the app on screen and closes all user
apps except the current and the previous one. Never closed: system apps,
inputs, TV Home, LG's home, Live TV, the screensaver, Homebrew Channel and
every `com.iso.*` app (so Plex stays ready). Only one copy runs at a time
(`/tmp/app-trim.pid`). `init.d/85-app-trim` starts it 60 s after boot.

Check it: `ssh <tv> cat /tmp/app-trim.log` lists what it closed.

Code: `tv/app-trim.sh`, `tv/init.d/85-app-trim`.
