# lg-tv-home

A calmer, faster home screen for rooted LG webOS TVs, in the style of the
Apple TV, plus switches for LG's tracking and bloat. Pick only the parts you
want; everything can be undone.

![TV Home](docs/screenshot.jpg)

## What you get

| | |
|---|---|
| **TV Home** | Large app cards with sharp logos, on dark glass or in brand colours; folders; your own wallpapers; a smooth 60 fps |
| [Picture Frame](docs/modules/picture-frame.md) | Your pictures full screen like a framed picture, optionally instead of LG's screensaver |
| [Plex](docs/modules/plex.md) | Continue Watching above the apps; OK resumes at once |
| [Philips Hue](docs/modules/hue.md) | A Light button for a cinema scene, rooms and lights on the TV |
| [Remote Buttons](docs/modules/remote-buttons.md) | Netflix, Prime, Mic, colour keys ... open any app you choose |
| [AV receiver button](docs/modules/av-receiver.md) | Sound to the receiver on HDMI eARC with one press |
| [Privacy lock](docs/modules/privacy-lock.md) | LG's ad, tracking and ACR servers blocked on the TV (skip it with a Pi-hole) |
| [Tracking services](docs/modules/tracking-services.md) | LG's tracking and profiling services stopped |
| [App trimming](docs/modules/app-trim.md) | Two apps in memory instead of LG's five or six preloads |
| [Telnet off](docs/modules/telnet-off.md) | Closes the passwordless root shell that rooting leaves open |

Everything except TV Home is a module: choose them in the installer, switch
installed ones on and off on the TV (Settings, Features).

## Install

Your TV must be rooted with SSH access first: [Before you start](docs/PREREQUISITES.md).
Then, on a Linux or macOS computer in the same network:

```bash
git clone https://github.com/RYUJIN-ISO/lg-tv-home.git
cd lg-tv-home
./install.sh
```

Pick modules from the checklist or a preset (recommended, everything,
Pi-hole user, minimal). Nothing changes until you confirm.
[More about installing](docs/INSTALL.md), updating and changing modules later.

**Undo:** `./uninstall.sh`, then reboot the TV.

**With an AI assistant:** point it at this repo; [AGENTS.md](AGENTS.md) tells it what to do.

## Documentation

[All documentation](docs/README.md): using TV Home, every module in detail
(what it changes on the TV, how it works), troubleshooting.

Tested on an **LG OLED 2024 (OLED65G49LS) with webOS 25 (10.3.1)**. Other
webOS 22+ TVs will most likely work; parts that depend on the model are
skipped when they are missing. Differences are welcome as an issue.

## Credits

- Root access: [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel)
  and [dangbro-autoroot](https://azoffshowy.github.io/dangbro); see
  [webosbrew.org](https://www.webosbrew.org).
- Block list: [hugobatista/lg-tv-ad-block](https://github.com/hugobatista/lg-tv-ad-block).
- Museum prints: public-domain paintings from Wikimedia Commons,
  [prints/CREDITS.md](prints/CREDITS.md).
