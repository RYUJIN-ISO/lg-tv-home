# lg-tv-home

Make a rooted LG webOS TV feel like an Apple TV: a fast custom home screen,
LG's tracking switched off, less background bloat, optional Philips Hue
"movie lighting" button. One interactive installer, fully reversible.

![TV Home](docs/screenshot.jpg)

> Tested on an **LG OLED 2024 (OLED65G49LS), webOS 25 / 10.3.1**. Other
> 2022+ webOS TVs will probably work; anything model-specific is skipped
> when missing. Rooting is required — see [docs/PREREQUISITES.md](docs/PREREQUISITES.md).

## What you get

| Feature | What it does |
|---|---|
| **TV Home launcher** | Apple TV-style home screen: wallpaper, big app tiles, folders, 60 fps on the tested TV. Replaces LG's home screen properly (Home button, after boot) — no flash of the old one. |
| **Organize Apps** | Move apps, Android-style folders, add/remove apps, uninstall, reset — all with the remote. |
| **Remote buttons** | Remap the Magic Remote's buttons (app buttons, Mic, Settings, Input, …) to any app or action from the launcher's Settings — instant, no flash of the old app. |
| **Light button** *(optional)* | One press: save the current Hue lighting and switch to your movie scene. Press again: back to how it was. |
| **Privacy** | Blocks LG's ad/tracking/ACR domains and stops the on-TV tracking services (viewing profiling, usage uploads, promos). |
| **App-Updates** *(with privacy)* | One app to unlock the LG Content Store for 10 minutes so apps can update, then everything re-locks. |
| **Speed** | Only the current and previous app stay in RAM instead of LG preloading 5-6; optional removal of voice / smart-home services you don't use. |
| **Security** | Turns off the passwordless root telnet that rooting leaves open. |

Details for everyday use: **[docs/FEATURES.md](docs/FEATURES.md)**.
How it works under the hood: [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md).

## Install

On a Linux or macOS computer on the same network as the TV
(needs `ssh`, `python3`, `curl`, `ar` from binutils):

```bash
git clone https://github.com/RYUJIN-ISO/lg-tv-home.git
cd lg-tv-home
./install.sh
```

The installer checks the TV, asks a few questions (everything has a sane
default), shows a summary and only then changes anything. Answers are saved to
`setup.conf`, so `./install.sh --yes` re-applies them, e.g. after an update of
this repo.

Hue light control can be set up later at any time:
`TV=<your-tv> tools/hue-setup.sh`.

## Undo

```bash
./uninstall.sh
```

Restores LG's home screen, removes the apps and boot hooks, and lifts the
service block; a reboot returns everything else to stock. Rooting itself is
left alone.

## Using an AI agent to install

Point your agent (Claude Code, Codex, …) at this repo — **[AGENTS.md](AGENTS.md)**
tells it which questions to ask you, how to install safely, and the gotchas.

## Tools

| Script | Use |
|---|---|
| `tools/hue-setup.sh` | Pair a Hue bridge and pick the room + movie scene |
| `tools/bench.sh` | Measure home screen smoothness on the TV (moves the focus on screen for ~30 s) |
| `tools/screenshot.sh` | Save a screenshot of the TV screen |
