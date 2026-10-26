# lg-tv-home

A calmer, faster home for rooted LG webOS TVs. It replaces LG's home screen
with an Apple TV style launcher, switches off LG's tracking, trims background
bloat, lets you give the remote's buttons new jobs and adds an optional
Philips Hue movie lighting button. One interactive installer, fully reversible.

![TV Home](docs/screenshot.jpg)

Tested on an **LG OLED 2024 (OLED65G49LS) with webOS 25 (10.3.1)**. Other
webOS 22+ TVs will most likely work; parts that depend on the model are
skipped when they are missing. The TV must be rooted first, see
[docs/PREREQUISITES.md](docs/PREREQUISITES.md).

## What you get

| Feature | In short |
|---|---|
| **TV Home** | Wallpaper, large app tiles, folders, a smooth 60 fps. It becomes the TV's real home screen (Home button, after power on) without the old one flashing up first. |
| **Organize Apps** | Move apps, make folders, add or remove apps, uninstall, reset. App choices are always cards, never text lists. |
| **Wallpapers** | Your own pictures, from the TV or a USB stick, cropped on the TV to 16:9 at up to 4K. Optional: 16 public-domain museum prints (Monet, Turner, Cross, Twachtman), see [prints/CREDITS.md](prints/CREDITS.md). |
| **Picture Frame** | Wallpapers full screen and dimmed, like a framed picture. Large pictures pan slowly and smoothly; CH+/CH- change the picture, the arrows look around; a still frame per picture can be set on the TV. |
| **Remote buttons** | Netflix, Prime, Mic, Input, colour and number keys and more can open any app or action. Set up on a drawing of the remote. |
| **Hue** *(optional)* | Rooms and lights in Settings, and a Light button that switches between cinema and the lighting from before (or a chosen scene). Paired on the TV, no computer needed. |
| **Privacy** | Blocks LG's ad, tracking and ACR servers and stops the tracking services on the TV. An App Store switch in Settings opens the LG Store for 10 minutes when apps need updating. |
| **Speed** | Only the current and previous app stay in memory instead of 5 or 6 preloaded ones. Unused voice and smart home services can go too. |
| **Security** | Turns off the passwordless root telnet that rooting leaves open. |

How to use everything: **[docs/FEATURES.md](docs/FEATURES.md)**.
How it works inside: [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md).

## Install

On a Linux or macOS computer in the same network as the TV, with `ssh`,
`python3`, `curl` and `ar` (binutils) available:

```bash
git clone https://github.com/RYUJIN-ISO/lg-tv-home.git
cd lg-tv-home
./install.sh
```

The installer checks the TV, asks a few questions (each with a sensible
default), shows a summary and only then changes anything. Your answers are
saved in `setup.conf`, so after pulling an update `./install.sh --yes`
applies it without asking again.

Hue is paired on the TV (Settings, Hue). From a computer, `TV=<your-tv> tools/hue-setup.sh` does the same.

## Undo

```bash
./uninstall.sh
```

This brings back LG's home screen, removes the apps and boot scripts and
restarts the stopped services. A reboot returns the rest to stock. The root
access itself stays.

## Installing with an AI agent

Point your agent (Claude Code, Codex and others) at this repo.
[AGENTS.md](AGENTS.md) tells it which questions to ask you, how to install
safely and what to watch out for.

## Tools

| Script | Use |
|---|---|
| `tools/hue-setup.sh` | Pair a Hue bridge, pick the room and the movie scene |
| `tools/bench.sh` | Measure how smooth the home screen is (moves the focus on screen for about 30 seconds) |
| `tools/screenshot.sh` | Save a screenshot of the TV |
