# Using lg-tv-home

Everything works with the normal LG remote (arrows, OK, Back) and with the
Magic Remote pointer (hover, click, click and hold, scroll wheel). Lists and
menus wrap around: Up on the first entry jumps to the last one and back.

## Home screen

- App tiles start in the order LG had them. Your changes are saved on the
  TV (`/var/lib/webosbrew/atvhome/config.json`) and survive updates.
- **Back** jumps to the first row. **Home** always brings you back here.
- **Hold OK** on an app (about half a second) for quick options: move it, put
  it in a folder, remove it from the home screen.
- **Up** from the first row reaches three buttons in the top left:

| Button | What it does |
|---|---|
| **Settings** (gear) | Language, wallpaper, remote buttons, App Store, clock |
| **Organize Apps** (squares) | Switches edit mode on and off (green while on) |
| **Light** (bulb) | Toggles the Hue movie scene. A green ring flashes when it worked, a red one if the bridge didn't answer. Only shown when the Light is set up. |

## Organize Apps

Every tile gets a dashed outline and **OK opens its options directly**:

| On an app | On a folder |
|---|---|
| Move, Add to Folder, Remove from Home Screen, Uninstall | Open, Move, Rename, Choose Apps, Remove Folder |

The cards at the end of the grid:

- **Add Apps**: every installed app as a card, including the ones LG hid.
  A check mark means it is on the home screen, dimmed means it is not.
  OK switches it, Back is done.
- **New Folder**: give it a name, then tick its apps the same way.
- **Uninstall Apps**: OK marks apps (red bin), Back asks once for all of
  them. Homebrew Channel and the lg-tv-home apps are never offered, because
  removing Homebrew would lose root.
- **Reset Layout**: folders, order and the app selection go back to LG's.

**Move** works with the arrows; OK drops the tile. **Back** leaves edit mode,
every change is already saved.

## Wallpapers

Settings, **Wallpaper** shows your wallpapers as cards, plus **None** and
**From USB**.

- **OK** uses a wallpaper (check mark on the active one).
- **Hold OK** crops it. A 16:9 frame lies over the picture; the arrows move
  it (or drag it with the Magic Remote, the wheel resizes). **OK** goes to the
  bar below: smaller, larger, resolution, **Save**.
- **From USB** shows the pictures (JPG, PNG) on a USB stick as cards. OK opens
  the same crop screen and Save adds the picture as a new wallpaper.
- Saved wallpapers are **4K (3840x2160) by default** whenever the framed area
  is big enough. The resolution button steps down to 2560 and 1920 wide.
  Pictures are never enlarged. The best source is 3840x2160 or larger.
- The full size original of every imported picture is kept, so cropping
  again later never loses quality. The bundled default wallpaper is never
  overwritten; a crop of it is saved as a new one.

Wallpapers can also be copied straight to `/var/lib/webosbrew/atvhome/wallpapers/`
on the TV (3840x2160 looks best: the TV draws the home screen at 4K).

## Remote buttons

Settings, **Remote Buttons** shows a drawing of the Magic Remote. Move over it
with the arrows or point at a button; the card next to it shows the button
and what it does now. **OK** opens its choices:

- **LG default** or **Do nothing**
- **Home screen**, **Light**, **Live TV**, **HDMI 1** to **4**
- **App**: every installed app as a card on the right, next to the remote.

Remapped buttons get a green ring. Power, volume, mute, home, back, settings,
the arrows and OK are greyed out and can't be changed, so the TV always stays
under control. Below the card:

- **Remote mapper: On / Off** switches all remaps off and on (it stays off
  across reboots until you switch it on again).
- **Other button**: for a button the drawing doesn't have, for example on a
  different remote. Press it within 20 seconds, then choose.
- **Reset** sets every button back to LG default.

Changes work at once and the original app never opens.

## App Store

LG's store shares its servers with the blocked tracking servers, so it is
locked by default. Settings, **App Store** opens it for 10 minutes (the LG
Store starts right away) and also restarts the stopped LG services for that
time. Press it again when you are done, or wait; it locks itself again.

## Sharper app logos

LG's app icons are at most 192 px, so some logos look soft on a 4K screen. A
640x384 PNG named after the app (for example `netflix.png`) in
`/var/lib/webosbrew/atvhome/tiles/` replaces that app's tile. Netflix comes
with one. To list app IDs:
`ssh <tv> "luna-send -n 1 luna://com.webos.applicationManager/listApps '{}' < /dev/null" | grep -o '"id":"[^"]*"'`

## What stays off

Depending on the setup answers: LG viewing data and ad services, usage log
uploads, promo pushes, recommendations, app preloading, voice search, ThinQ,
Google Home and Alexa linking, car mode and fitness Bluetooth. Casting
(AirPlay, Chromecast, screen sharing) is never touched.
