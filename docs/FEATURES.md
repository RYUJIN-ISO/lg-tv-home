# Features — how to use them

Everything works with the normal LG remote (arrows, OK, Back) and with the
Magic Remote pointer (hover, click, click-and-hold, scroll wheel).

## Home screen

- **App tiles** in the order LG had them; your changes are saved on the TV
  (`/var/lib/webosbrew/atvhome/config.json`) and survive launcher updates.
- **Top-left buttons** — press **Up** from the first row of tiles:
  - **Settings** (gear): Language (English / Deutsch), Wallpaper, Show Clock.
  - **Organize Apps** (squares): turns edit mode on/off (green while on).
  - **Light** (bulb): only shown when Hue light control is installed. A green
    ring flashes when the lights switched, red if the bridge didn't answer.
- **Hold OK** on any app (about half a second) for quick options: Move, Add to
  Folder, Remove from Home Screen.
- **Back** jumps to the top row. **Home** always brings you back here.

## Organize Apps (edit mode)

Every tile gets a dashed outline; **OK on a tile opens its options directly**:

| On an app | On a folder |
|---|---|
| Move · Add to Folder · Remove from Home Screen · **Uninstall** | Open · Move · Rename · Choose Apps · Remove Folder |

Cards at the end of the grid: **Add Apps**, **New Folder**, **Uninstall
Apps**, **Reset Layout**. App choices are always cards, like the home screen:

- **Add Apps** — every installed app (incl. ones LG hid); ✓ = on the home
  screen, dimmed = not. OK toggles, Back is done.
- **Folder → Choose Apps** — ✓ = in this folder.
- **Uninstall Apps** — OK marks apps (red bin), Back asks once for all of them.
- **Remote button → App …** — OK picks the app. **Back** leaves edit mode — every change is already saved.

- **Move**: arrows move the tile, OK drops it.
- **Uninstall** always asks first. Homebrew Channel and the lg-tv-home apps
  are never offered (removing Homebrew would lose root).
- Reinstalling an app needs the Content Store → see App-Updates below.

## Remote buttons

Settings (gear, top left) → **Remote Buttons** shows the Magic Remote. Move
over the drawing with the arrows (or point at a button with the Magic
Remote); the card next to it shows the button and what it does now. **OK**
opens its choices:

- **LG default** / **Do nothing**
- **Home screen**, **Light** (Hue toggle, if installed), **Live TV**, **HDMI 1-4**
- **any installed app** — store apps, Homebrew apps, everything.

Remapped buttons get a green ring. Greyed out and never mappable: power,
volume, mute, home, back, settings, the arrow ring and OK — so the TV always
stays controllable. **Other button …** (bottom) catches a button the drawing
doesn't have (e.g. on another remote): press it within 20 s, then choose.

Changes work immediately — the original app never opens. **Remote mapper:
On/Off** turns it all off (stays off across reboots until switched on again).
Undo from a computer: `ssh <tv> sh /var/lib/webosbrew/remote-mapper/remote-mapper.sh disable`.

## Settings menu navigation

Up/Down move, **OK or Right** opens a submenu (Right only on rows with ›, so a
sideways press never flips a setting), **Left or Back** goes back.

## Wallpapers

Copy JPG/PNG files to `/var/lib/webosbrew/atvhome/wallpapers/` on the TV and
pick them in Settings → Wallpaper. **Use 3840×2160** — the TV draws the home
screen at 4K, smaller images look soft.

## Sharper app logos

LG's app icons are at most 192 px, so some logos look soft at 4K. Put a
640×384 PNG named after the app ID into `/var/lib/webosbrew/atvhome/tiles/`
(e.g. `netflix.png`) and it replaces that app's tile. Netflix ships with one.
To list app IDs: `ssh <tv> "luna-send -n 1 luna://com.webos.applicationManager/listApps '{}' < /dev/null" | grep -o '"id":"[^"]*"'`.

## Light (Philips Hue)

1st press: the current lighting of the chosen room is saved into a scene
called "TV Home before", then your movie scene is recalled. 2nd press: the
saved lighting comes back exactly. Change room/scene any time with
`tools/hue-setup.sh`.

## App-Updates (when the privacy block is on)

The ad/tracking block also blocks LG's store servers. Open **App-Updates**:
the block is lifted for 10 minutes and the LG Store opens — update or install
apps, then press App-Updates again (or wait) and everything locks again. The
stopped background services are restored for that time too.

## What stays off

Depending on your answers: LG viewing-data/ad services, usage log uploads,
promo pushes, recommendations, app preloading, voice search, ThinQ / Google
Home / Alexa linking, car mode, fitness bluetooth. Casting (AirPlay,
Chromecast, screen share) is never touched.
