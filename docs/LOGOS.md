# Sharp logos

LG gives the launcher app icons of at most 192 px, which look soft on a 4K
screen. TV Home fixes that by itself:

- **Automatic.** Most apps show their logo large on their splash screen (the
  picture while they start, 1920x1080). TV Home cuts the logo out once, when
  it has sat still for a few seconds, and uses it instead of the icon. The
  result is kept in `/var/lib/webosbrew/atvhome/autotiles/<appId>.<size-time>.png`;
  when an app update brings a new splash, it is cut again. Apps whose splash
  has no logo (Prime Video, for example) keep their icon; that is remembered
  as an empty `<appId>.<size-time>.none`.
- **Tile art** wins over everything: a 640x384 PNG named after the app
  (for example `netflix.png`) in `/var/lib/webosbrew/atvhome/tiles/`.
  The repo ships no tile art: app logos belong to their owners, so you
  make your own for your TV.

## A logo looks wrong

1. Find the app's ID:
   `ssh <tv> "luna-send -n 1 luna://com.webos.applicationManager/listApps '{}' < /dev/null" | grep -o '"id":"[^"]*"'`
2. Let TV Home cut it again: `ssh <tv> "rm /var/lib/webosbrew/atvhome/autotiles/<appId>.*"`,
   then press Home and leave the remote alone for a few seconds. (An app
   tried in the last two minutes waits until those are over.)
3. Still wrong, or the app has no logo in its splash: make a 640x384 PNG (the
   logo centred on its brand colour or black) and copy it to
   `/var/lib/webosbrew/atvhome/tiles/<appId>.png`. Keep it on your TV; please
   don't send app logos as pull requests (they are the brands' property).

## How it works

LG's launch points carry icons of at most 192 px; the TV draws TV Home at
devicePixelRatio 2, so a 192 px icon is stretched to 384 px. Most apps'
`splashBackground` (from `listApps`) is a 1920x1080 picture with the logo
large in the middle.

1. `cache.js` (root) copies each app's splash into the app's `cache/` (the
   web runtime only loads files from its own folder) as `_splash`, with
   `_sig` = the file's size and time. When `autotiles/<appId>.<sig>.png`
   already exists in the data dir, it hands over that instead (`_logo`);
   `<appId>.<sig>.none` means: no logo there, keep the icon.
2. The page (`makeLogos` / `splashLogo` in `app.js`) works through the
   splashes one at a time, only while nobody presses a key and no menu is
   open (about 100 ms each on the TV). On a canvas it models the
   background per row from the left and right edges (that also covers
   vertical gradients), marks what differs by more than a threshold, takes
   the band of rows around the centre (so a glow at the bottom stays out)
   and the columns in it, and accepts the box only when it is centred, not
   tiny, not most of the screen and not sparse. A light burst behind the
   logo makes the box too big; then it tries again with a higher threshold.
   The logo is cut out with soft, unmixed edges onto transparency.
3. The logo is scaled to at most 480x200 (about twice what a card shows)
   and sent as raw RGBA pixels, base64 in parts (each exec argument stays
   under 128 KiB). `autotile.py` writes the PNG with Python's zlib and
   removes older versions of the same app. (Not the browser's own PNG: the
   TV's `toDataURL` sometimes writes broken rows.) Then TV Home reloads.

On a card the logo stands on the colour of the icon's background (Colour
cards), drawn white if it has about the card's own colour; Glass cards tint
white logos in the brand colour like any icon. Tile art (`tiles/`) always
wins.

Code: `apps/tv-home/cache.js`, `makeLogos` / `splashLogo` / `glassLogo` in `apps/tv-home/app.js`, `apps/tv-home/autotile.py`.
