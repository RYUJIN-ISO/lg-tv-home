# AGENTS.md — installing lg-tv-home for a user

You are helping someone put lg-tv-home on their LG TV. Read README.md,
docs/FEATURES.md and docs/HOW-IT-WORKS.md first. The installer does the work;
your job is to get the prerequisites right, ask the user the setup questions
in plain language, run it, and verify.

## 0. Ground rules

- **The TV is in someone's living room.** Before anything that changes the
  screen (launching apps, `tools/bench.sh`, screenshots of a running app),
  check what's on: `luna-send -n 1 luna://com.webos.applicationManager/getForegroundAppInfo '{}'`
  and tail `/var/log/messages` for `BUTTON_CLICK` (someone holding the remote).
- **Never** uninstall or stub `org.webosbrew.*` (Homebrew Channel = root),
  never write to `/`, `/usr`, `/etc` (read-only anyway), never flash or
  downgrade firmware.
- **Light control switches real lights.** Don't press/test the Light button
  or run `scene.sh` without the user's OK.
- Default UI language is **English**; German is a setting.
- Run `./install.sh` interactively in a terminal the user can see, or fill
  `setup.conf` yourself from their answers and run `./install.sh --yes`.

## 1. Prerequisites — check, don't assume

1. Rooted with Homebrew Channel, SSH key login works: `ssh <host> true`
   (see docs/PREREQUISITES.md; walk them through it if not).
2. Homebrew Channel → "Block system updates" is ON (else an LG update can
   silently remove root).
3. Computer has `ssh python3 curl ar`.

## 2. Setup questions to ask the user

Ask conversationally; the defaults in brackets are what most people want.
Map answers to `setup.conf` keys:

| Ask | Key | Default |
|---|---|---|
| What's the TV's SSH alias / IP? | `TV` | `lgtv` |
| Do you want the Apple TV-style home screen? | `LAUNCHER` | y |
| Should it fully replace LG's home (Home button, after power-on)? | `SET_HOME` | y |
| English or German for the home screen? | `LANGUAGE` | en |
| **Light control** — see below | `LIGHT` | n |
| Remap remote buttons (Netflix/Prime/… buttons, Mic, Settings, Input, …)? Configured later in the launcher's Settings → Remote Buttons | `REMOTE` | y |
| Block LG's ads/tracking/ACR domains? | `ADBLOCK` | y |
| …then: want the App-Updates toggle to still update apps from the LG Store? | `APP_UPDATES` | y |
| Stop LG's tracking/profiling background services? | `DEBLOAT` | y |
| …does anyone use **voice search** (mic button)? (y = keep) | `KEEP_VOICE` | n |
| …do they use the **LG ThinQ app, Google Home or Alexa** with the TV? (y = keep) | `KEEP_SMARTHOME` | n |
| Keep only the current + previous app in memory (faster, less swapping)? | `APP_TRIM` | y |
| Turn off the passwordless root telnet? | `TELNET_OFF` | y |

### Light control (central optional feature — ask properly)

The launcher's top-left **Light** button toggles a Philips Hue scene:
1st press saves the room's current lighting and recalls a "movie" scene,
2nd press restores the saved lighting exactly. Ask:

1. *Do you have Philips Hue lights in the TV room, with a Hue bridge?*
   No → `LIGHT=n` (the button simply doesn't appear). Other brands
   (Govee, Nanoleaf, Home Assistant) are not supported yet — say so, and
   offer to note it as a wish.
2. *Which room or zone are the TV lights in, and which scene should play when
   watching?* If they have no fitting scene, ask them to create one in the Hue
   app first (e.g. dim warm light behind the TV).
3. *Are you near the bridge?* `tools/hue-setup.sh` asks them to press its
   link button within 60 s, lists rooms and scenes, and creates the "TV Home
   before" snapshot scene. It needs the computer on the same network as the
   bridge.

## 3. Install and verify

```bash
./install.sh            # or: write setup.conf, then ./install.sh --yes
```

Then verify, and report honestly what you checked:

- `tools/screenshot.sh` → home screen shows (only if nobody is watching).
- Press Home on the remote (ask the user) → TV Home, no LG screen first.
- After 2-3 min: `ssh <tv> cat /tmp/debloat.state` → `applied`;
  `ssh <tv> cat /tmp/app-trim.log` shows closed preloaded apps.
- Ask the user to power-cycle the TV once; everything must come back by
  itself (~2 min after boot for the service block).
- Optional: `tools/bench.sh` (moves focus on screen ~30 s) → ~60 fps, 0-2
  frames > 25 ms on the tested model.

## 4. Different TV model?

Tested: LG OLED 2024 (OLED65G49LS), webOS 10.3.1. On other models:
`debloat.sh` skips units/binaries that don't exist; check
`/var/log/messages` and the user's experience for anything broken (voice,
casting, inputs) and lift with `ssh <tv> sh /var/lib/webosbrew/debloat.sh lift`
if needed. Report differences back to the repo owner.

## 5. Undo

`./uninstall.sh` (asks before deleting the saved layout / Hue pairing), then
reboot the TV.
