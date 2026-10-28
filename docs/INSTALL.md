# Installing

You need a rooted LG TV that you can reach with `ssh` as root, without a
password: [PREREQUISITES.md](PREREQUISITES.md). On the computer: Linux or
macOS with `ssh`, `python3`, `curl` and `ar` (binutils), in the same network
as the TV.

```bash
git clone https://github.com/RYUJIN-ISO/lg-tv-home.git
cd lg-tv-home
./install.sh
```

Nothing on the TV changes until you confirm the summary at the end.

## What the installer does

1. **Checks the TV**: SSH works, Homebrew Channel is there; shows the model
   and webOS version, and finds which modules are already installed.
2. **The checklist**: every module with a number. Type numbers to switch
   items (`4 5`), a letter for a preset, Enter when done.
3. **A few details**: whether TV Home replaces LG's home screen, the
   language, and (with the tracking services) whether voice search and
   ThinQ / Google Home / Alexa are used.
4. **Saves your choices** in `setup.conf` (no secrets) and shows a summary:
   what gets installed and what gets removed.
5. **Installs**, after you confirm.

## The modules

| # | Module | Key in `setup.conf` | Installs on the TV | Details |
|---|---|---|---|---|
| 1 | TV Home, the home screen | `LAUNCHER` | the app `com.iso.atvhome` | [Using TV Home](FEATURES.md) |
| 2 | Picture Frame | `FRAME` | frame code in TV Home, boot hook `87-frame-saver` | [page](modules/picture-frame.md) |
| 3 | Plex | `PLEX` | Plex code in TV Home, helper app `com.iso.plexlink` | [page](modules/plex.md) |
| 4 | Philips Hue | `LIGHT` | Hue code in TV Home, the Light app `com.iso.moviescene` | [page](modules/hue.md) |
| 5 | AV receiver button | `AVR` | a button in TV Home | [page](modules/av-receiver.md) |
| 6 | Remote buttons | `REMOTE` | the key filter in `/var/lib/webosbrew/remote-mapper/`, boot hook `86-remote-mapper` | [page](modules/remote-buttons.md) |
| 7 | Museum prints | `PRINTS` | 16 public-domain paintings as wallpapers (about 49 MB) | [credits](../prints/CREDITS.md) |
| 8 | Privacy lock | `ADBLOCK` | block list in `/etc/hosts` at every boot, the App Store switch | [page](modules/privacy-lock.md) |
| 9 | Tracking services | `DEBLOAT` | `debloat.sh`, boot hook `80-debloat` | [page](modules/tracking-services.md) |
| 10 | App trimming | `APP_TRIM` | `app-trim.sh`, boot hook `85-app-trim` | [page](modules/app-trim.md) |
| 11 | Telnet off | `TELNET_OFF` | Homebrew's telnet switch | [page](modules/telnet-off.md) |

Items 2 to 7 are parts of TV Home and need it. Without TV Home but with the
privacy lock, the small App-Updates app is installed to open the store.

**Presets:**

| Letter | Preset | Modules |
|---|---|---|
| `r` | recommended (the default) | all but Philips Hue and the AV receiver button |
| `e` | everything | all |
| `p` | Pi-hole user | recommended without the privacy lock (your network already blocks LG's servers) |
| `m` | minimal | TV Home and telnet off |

The other answers in `setup.conf`: `TV` (the SSH host), `SET_HOME`,
`LANGUAGE`, `KEEP_VOICE`, `KEEP_SMARTHOME`.

## Updating

```bash
git pull
./install.sh --yes      # the choices from setup.conf, no questions
```

## Changing it later

Run `./install.sh` again and change the checklist. A module that is on the
TV but no longer ticked is **taken off the TV**: its app, scripts and boot
hook go, and what it changed is restored (LG's key handling, the hosts file,
the stopped services, LG's home screen). Its settings, the Hue pairing, the
Plex sign-in and the button map **stay**, so ticking it again brings
everything back. Telnet is left as it is when unticked.

To switch a module off without the installer: on the TV, Settings,
**Features** ([Using TV Home](FEATURES.md#settings)).

## Undo everything

```bash
./uninstall.sh
```

Restores LG's home screen, removes the apps, scripts and boot hooks and
restarts the stopped services. It asks whether to also delete the saved
layout, wallpapers, Hue pairing and Plex sign-in, and whether to turn telnet
back on. Reboot the TV afterwards. Root access itself stays.

## With an AI assistant

Point your assistant (Claude Code, Codex, ...) at this repo:
[AGENTS.md](../AGENTS.md) tells it which questions to ask you, how to install
safely and what to check afterwards.
