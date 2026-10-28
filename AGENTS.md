# AGENTS.md: installing lg-tv-home for someone

You are helping a person put lg-tv-home on their LG TV. Read README.md,
docs/INSTALL.md and the module pages in docs/modules/ first (index:
docs/README.md). The installer does the
work. Your job: get the prerequisites right, ask the setup questions in plain
words, run the installer and check the result.

## 1. Ground rules

- **The TV stands in someone's room.** Before anything that changes the
  screen (launching apps, `tools/bench.sh`), check what is on:
  `luna-send -n 1 luna://com.webos.applicationManager/getForegroundAppInfo '{}'`,
  and look at `/var/log/messages` for `BUTTON_CLICK` (someone is holding the
  remote).
- **Never** uninstall or stub `org.webosbrew.*` (Homebrew Channel is the root
  access). Never write to `/`, `/usr` or `/etc` (read only anyway). Never
  flash or downgrade firmware.
- **The Light switches real lights.** Don't press it or run `scene.sh`
  without asking.
- **Boot scripts must return at once.** Homebrew Channel keeps its failsafe
  flag armed until every `init.d` script has finished; a slow one means a
  "crash" message after the next power cycle. Put slow work in the background.
- The interface language defaults to **English**; German is a setting.
- Run `./install.sh` in a terminal the person can see, or fill in
  `setup.conf` from their answers and run `./install.sh --yes`.

## 2. Check the prerequisites

1. The TV is rooted with Homebrew Channel and SSH key login works:
   `ssh <host> true` (docs/PREREQUISITES.md walks through it).
2. Homebrew Channel's **Block system updates** is on (otherwise an LG update
   can silently remove root).
3. The computer has `ssh`, `python3`, `curl` and `ar`.

## 3. The setup questions

Everything is a module; the person picks what they want. Ask in a
conversation (the installer's checklist shows the same list); the defaults are
the **recommended** preset. They map to the keys in `setup.conf`:

| Ask | Key | Default |
|---|---|---|
| What is the TV's SSH name or IP? | `TV` | `lgtv` |
| Do you want the Apple TV style home screen (TV Home)? | `LAUNCHER` | y |
| ...the Picture Frame (wallpapers full screen, optionally instead of LG's screensaver)? | `FRAME` | y |
| ...Plex rows (Continue Watching)? Only if they use Plex | `PLEX` | y |
| ...**Light** (Philips Hue): see below | `LIGHT` | n |
| ...a button that sends the sound to an AV receiver on HDMI eARC? | `AVR` | n |
| ...remappable remote buttons (set up later in TV Home's Settings)? | `REMOTE` | y |
| ...the 16 museum prints (public-domain paintings, about 49 MB) as wallpapers? | `PRINTS` | y |
| **Privacy lock**: block LG's ad, tracking and ACR servers on the TV? See below | `ADBLOCK` | y |
| Stop LG's tracking and profiling services on the TV? | `DEBLOAT` | y |
| ...does anyone use **voice search** with the mic button? (y keeps it) | `KEEP_VOICE` | n |
| ...do they use the **LG ThinQ app, Google Home or Alexa** with the TV? (y keeps it) | `KEEP_SMARTHOME` | n |
| Keep only the current and previous app in memory (faster)? | `APP_TRIM` | y |
| Turn off the passwordless root telnet? | `TELNET_OFF` | y |
| With TV Home: should it replace LG's home completely (Home button, after power on)? | `SET_HOME` | y |
| With TV Home: English or German? | `LANGUAGE` | en |

The parts marked "..." under TV Home need it. Without TV Home but with the
privacy lock, the installer adds the small App-Updates app to open the store.

**Privacy lock and Pi-hole.** The lock writes LG's ad and tracking servers
into the TV's `/etc/hosts`; LG's store shares servers with them, so the
store is locked too (TV Home's Settings, App Store opens it until the Store is left).
Someone with a Pi-hole, AdGuard Home or a similar network-wide block doesn't
need it: `ADBLOCK=n` (the installer's **p** preset) leaves the TV's hosts
and the store alone. The tracking services block (`DEBLOAT`) is separate and
still worth having.

**Changing it later.** Run `./install.sh` again and change the checklist: an
unticked module is taken off the TV (its settings, the Hue pairing and the
Plex sign-in stay). On the TV, Settings, **Features** switches installed
modules off and on without the installer.

### The Light (ask properly, it is the main optional feature)

The top-left **Light** button switches a Philips Hue room between a cinema
scene and a "back to" target: by default the lighting from just before cinema
(saved on the first press), or a scene they choose. TV Home's Settings also
has a Hue section to switch rooms and single lights and set brightness. Ask:

1. *Are there Philips Hue lights in the TV room, with a Hue bridge?*
   If not, `LIGHT=n` and the button simply doesn't appear. Other systems
   (Govee, Nanoleaf, Home Assistant) are not supported yet; say so and note
   the wish.
2. *Which room or zone are the TV lights in, and which scene should play when
   watching?* If no scene fits, they should create one in the Hue app first
   (for example dim warm light behind the TV).
3. *Can you get to the bridge?* Pairing happens on the TV: TV Home,
   Settings, Features, Philips Hue, **Rooms and lights** finds the bridge and
   waits for its button (60 seconds); then **Light button** in the same menu
   sets the room, cinema scene and "back to" target.
   (`tools/hue-setup.sh` does the same from a computer in the bridge's network.)
4. *Should the second press bring back the lighting from before cinema
   (default), or always a particular scene?*

### Plex (`PLEX`)

The Plex rows stay invisible until someone signs in. Ask: *Do you watch
Plex on this TV?* If not, `PLEX=n`. If yes, after the install they open TV
Home, Settings, Features, Plex, **Account**, and enter the code shown on the
TV at **plex.tv/link**. That works for their own server and for a
server a friend shared with them; each person signs in with their own
account and sees their own Continue Watching.

- **Never ask for, copy or print a Plex token.** The sign-in on the TV
  creates one for that TV only. The files `plex-token`, `plex-server.json`
  and `plex-pin.json` in `/var/lib/webosbrew/atvhome/` hold secrets; don't
  `cat` them.
- Check it (nothing on screen changes): `ssh <tv> python3
  /media/developer/apps/usr/palm/applications/com.iso.atvhome/plex.py account`
  prints the account and server name, `... plex.py refresh` the rows.
- OK on a card opens Plex through the hidden helper app `com.iso.plexlink`;
  `/var/lib/webosbrew/atvhome/plex-play.log` says what the last OK did. How
  it works: docs/modules/plex.md.
- "Keep Plex ready" (Settings, Features, Plex; on by default) keeps that helper
  started in the background, about 115 MB. On a TV that is short of memory,
  switch it off.

### Logos (no setup question)

Sharp logos are automatic: TV Home cuts them out of the apps' splash screens
a few seconds after it is shown (only while nobody presses keys). Check:
`ssh <tv> ls /var/lib/webosbrew/atvhome/autotiles` (`.png` = a logo, `.none` =
the splash had none, the icon stays). If a logo looks wrong, delete that
app's files there (they are cut again) or add tile art; the steps are in
docs/LOGOS.md. Don't edit the `.png` files by hand:
they are replaced when the app's splash changes.

## 4. Install and check

```bash
./install.sh            # or: write setup.conf, then ./install.sh --yes
```

Then check, and report honestly what you actually verified:

- `tools/screenshot.sh` shows the home screen (only if nobody is watching).
- Ask them to press Home: TV Home appears, without LG's screen first.
- After 2 to 3 minutes: `ssh <tv> cat /tmp/debloat.state` says `applied`,
  `ssh <tv> cat /tmp/app-trim.log` lists the preloaded apps it closed.
- Ask them to power the TV off and on once: everything must come back by
  itself, with no Homebrew failsafe message.
- Optional: `tools/bench.sh` (moves the focus on screen for about 30 seconds)
  should show about 60 fps and 0 to 2 frames over 25 ms on the tested model.

## 5. A different TV model?

Tested: LG OLED 2024 (OLED65G49LS), webOS 10.3.1. On other models,
`debloat.sh` skips services and programs that don't exist. Watch
`/var/log/messages` and ask whether voice, casting and inputs still work; if
something broke, lift the block with `ssh <tv> sh /var/lib/webosbrew/debloat.sh lift`.
The remote mapper's button names come from LG's key constants and work on
any remote; buttons the drawing lacks can be set with **Other button**.
Report differences to the repo owner.

## 6. Undo

`./uninstall.sh` (it asks before deleting the saved layout and the Hue
pairing), then a reboot of the TV.
