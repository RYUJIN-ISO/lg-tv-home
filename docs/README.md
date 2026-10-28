# lg-tv-home documentation

**Getting started**

- [Before you start](PREREQUISITES.md): rooting the TV, SSH with a key
- [Installing](INSTALL.md): the checklist, presets, updating, changing modules, undo
- [Using TV Home](FEATURES.md): home screen, Settings, Look, Features, Organize Apps, pictures
- [Troubleshooting](TROUBLESHOOTING.md): common problems, logs, reporting

**Modules**: what each does, exactly what it changes on the TV, how it works

| Module | |
|---|---|
| [Picture Frame](modules/picture-frame.md) | pictures full screen; instead of LG's screensaver |
| [Plex](modules/plex.md) | Continue Watching above the apps |
| [Philips Hue](modules/hue.md) | Light button, rooms and lights |
| [Remote Buttons](modules/remote-buttons.md) | any app or action on the remote's buttons |
| [AV receiver button](modules/av-receiver.md) | sound to the receiver with one press |
| [Privacy lock](modules/privacy-lock.md) | LG's ad, tracking and ACR servers blocked; App Store switch |
| [Tracking services](modules/tracking-services.md) | LG's tracking services stopped (the exact list) |
| [App trimming](modules/app-trim.md) | two apps in memory instead of LG's preloads |
| [Telnet off](modules/telnet-off.md) | closes the passwordless root shell |

**Inside**

- [How it works](HOW-IT-WORKS.md): where everything lives on the TV, boot scripts, replacing LG's home screen, the launcher, the installer
- [Sharp logos](LOGOS.md): how logos are cut from the apps' splash screens, and fixing one
- [Writing a module](../apps/tv-home/modules/README.md): the hooks TV Home offers
- [AGENTS.md](../AGENTS.md): instructions for AI assistants installing it for someone

**Tools** (run on the computer, `TV=<ssh host>` in front)

| Script | Use |
|---|---|
| `tools/hue-setup.sh` | Pair a Hue bridge and set up the Light button from a computer |
| `tools/bench.sh` | Measure how smooth the home screen is (moves the focus on screen for about 30 seconds) |
| `tools/screenshot.sh` | Save a screenshot of the TV (nothing on screen changes) |
