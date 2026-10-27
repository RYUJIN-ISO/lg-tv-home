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
| **Settings** (gear) | Language, wallpaper, picture frame, remote buttons, Hue, App Store, clock |
| **Organize Apps** (squares) | Switches edit mode on and off (green while on) |
| **Light** (bulb) | Switches between cinema and the lighting from before (or a scene you chose). It glows warm while cinema is on; a green ring flashes when it worked, a red one if the bridge didn't answer. **Hold OK** opens the Hue menu. Only shown when Hue is installed. |

**Help.** Screens that do something a normal TV doesn't have a small **i**
(next to the title; **Up** from the top
row reaches it). It shows a small legend in a corner: the remote keys drawn as
key caps and a few words. It doesn't block anything; **i** again or leaving
the screen closes it. The home screen's keys are in Settings' **i**. The
hints under titles use the same key caps.

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

## Pictures (Wallpaper and Picture Frame)

Settings, **Wallpaper** and Picture Frame, **Pictures** open the same picture
library: the same folders, the same crops, the same screens.

- **Folders** as cards with a mosaic of their pictures: **All pictures**, your
  folders, **New Folder**, **From USB** (and **None** for the wallpaper).
  **Favourites** (right after All pictures) is built in: it holds the
  pictures marked ★, can be the frame's pictures, and can't be renamed or
  deleted.
  **OK** opens a folder. **Hold OK** on a folder: **Choose Pictures** (OK puts
  a picture in or takes it out), **Rename**, **Delete Folder** (the pictures
  stay). A picture can be in several folders.
- **Inside a folder**, OK does what the menu is for: from Wallpaper it sets
  the picture as the wallpaper (check mark), from Picture Frame it starts the
  frame with that folder, beginning at that picture.
- **Hold OK on a picture**: **Favourite** (☆/★), **Crop**, which **folders** it is in, and
  **Delete Picture** (asks first; removes it from the TV and all folders;
  not offered for the pictures that come with the app).
- **Crop**: a 16:9 frame over the whole picture. It opens in the bar:
  smaller, larger, how sharp it is (**4K**, or how much it gets enlarged),
  **Reset**. **Up** moves to the frame: the arrows move it (or drag it with
  the Magic Remote, the wheel resizes), **OK** saves and goes back to the bar,
  **Back** goes back without saving. **✂** (pictures stored on the TV) cuts
  the file to the frame for good, after a confirmation, to save space when
  only the crop is worth keeping; it can't be undone. The crop is remembered, never cut into the file, and
  used everywhere: the home screen shows it, the picture frame rests on it
  (Still) or glides towards it (Pan).
- **From USB** shows the pictures (JPG, PNG) on a USB stick. OK opens the crop
  screen; **OK** in the frame adds the whole picture (scaled down to about 18 megapixels
  when it is bigger) with its crop and a preview. From Wallpaper it also
  becomes the wallpaper.

**Museum prints** (installer question, or copy `prints/` from the repo): 16
public-domain paintings by Monet, Turner, Henri-Edmond Cross and Twachtman,
uncropped, up to 16 megapixels, with previews. Ten have enough detail for a
sharp 4K frame across their width; the smaller six get enlarged slightly when
they fill the screen. Credits: `prints/CREDITS.md`.

Wallpapers can also be copied straight to `/var/lib/webosbrew/atvhome/wallpapers/`
on the TV (3840x2160 looks best: the TV draws the home screen at 4K).

## Picture Frame

Settings, **Picture Frame** shows your wallpapers full screen and dimmed, so
the TV looks like a framed picture.

- **Start** begins it. While it runs:
  - **CH+ / CH-** show the next or the previous picture.
  - **Arrows** move the visible area through a large picture. The automatic
    pan stops for that picture and starts again with the next one.
  - **OK, Back** or any other button end it.
- **Pictures**: the picture library (see above). The check mark shows the
  folder the frame plays; OK on a picture inside a folder starts the frame
  there with that folder. **Start** plays the folder used last.
- **Change every** 1, 5, 15, 30 or 60 minutes (Left and Right), when more than
  one picture is shown. The order is shuffled and pictures fade into each other.
- **Motion**: **Pan** (default) glides across large pictures, see below.
  **Still** shows every picture without panning, filling the screen: with
  its crop if one is set, otherwise centred (a tall photo or a square
  painting is zoomed in to 16:9).
- **Brightness** 20 to 100% (default 60%). It dims the picture, not the TV's
  picture settings.
- **Instead of Screensaver** (default off): when the TV starts LG's
  screensaver (nothing playing, no key pressed for 3 minutes), LG's shows for
  about 10 seconds and then hands over to the frame. A key ends it and goes
  back to the app you were in. While a frame
  runs, LG's screensaver never takes over, with this switch on or off.

**Large pictures pan** (Motion: Pan). A picture that is bigger than the
screen or not 16:9 (a tall photo, a square painting, a 15000 pixel camera
shot) fills the screen and glides very slowly:

- **With a crop**, it starts at the far side of the picture and glides
  towards the crop, zooming in, so it arrives before the next picture comes;
  then it rests on the crop. If the whole way would take longer, it starts
  closer, so the speed stays just as slow.
- **Without one**, it travels from one corner to the other and back, easing
  into each turn, until the next picture.

A 16:9 picture without a crop only drifts a few pixels now and then,
which protects an OLED panel.

For the best panning, copy large pictures to the TV at up to about 18
megapixels (for example 4800x3700, or 3840 wide for tall ones): much bigger
files only cost memory, the TV can't show more detail. A 640x360 preview with
the same name in `wallpapers/thumbs/` keeps the picture cards quick.

LG's screensaver stays away while it runs. LG's own auto power off (if it is
on in the TV settings) still switches the TV off after a few hours without
input. A remote button can also start it (Remote Buttons, **Picture Frame**).

## Remote buttons

Settings, **Remote Buttons** shows a drawing of the Magic Remote. Move over it
with the arrows or point at a button; the card next to it shows the button
and what it does now. **OK** opens its choices:

- **LG default** or **Do nothing**
- **Home screen**, **Picture Frame**, **Light**, **Live TV**, **HDMI 1** to **4**
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

## Hue

Settings, **Hue** (or holding OK on the Light button) shows your rooms and zones as cards: warm when the lights
are on (warmer the brighter), dark when they are off.

- **OK** switches a room on or off.
- **Hold OK** opens the room: power, **brightness** (Left and Right change it
  in 10% steps), its **scenes** (OK starts one) and every **light** (OK
  switches it, Left and Right change its brightness).
- The **Light button** card sets up the top-left button: the **room**, the
  **cinema scene**, and what the next press goes **back to**: the lighting
  from just before cinema (default) or a scene you pick.

A TV without a paired bridge shows **Connect** instead: it finds the bridge
(or asks for its IP) and waits for you to press the button on the bridge.

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
