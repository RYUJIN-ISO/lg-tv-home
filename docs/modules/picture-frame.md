# Picture Frame

Your pictures full screen and dimmable, like a framed picture. Large
pictures pan slowly. Optionally it replaces LG's screensaver.

| | |
|---|---|
| Installer | **Picture Frame** (`FRAME`), part of TV Home |
| Switch | Settings, **Features**, **Picture Frame** |
| On the TV | `framesaver.py`, `keepawake.py`, `frameworker.js` in TV Home's app folder; boot hook `/var/lib/webosbrew/init.d/87-frame-saver` |
| Removed by | unticking it in `install.sh` (stops the guard, removes the hook, turns LG's screensaver back on if the guard had turned it off) |

## Using it

The **Picture Frame** card on the home screen starts it. It is an app card
like the others: move it, put it in a folder or take it off the home screen
(Organize Apps; Add Apps brings it back). A remote button can start it too
([Remote Buttons](remote-buttons.md)).

While it runs:

- **CH+ / CH-**: the next or the previous picture.
- **Arrows**: move the visible area through a large picture. The automatic
  pan stops for that picture and starts again with the next one.
- **OK, Back** or any other button end it.

Settings, **Features**, **Picture Frame** (below its On / Off switch):

| Setting | What it does |
|---|---|
| **Start** | Starts it with the folder used last |
| **Pictures** | The picture library ([Using TV Home](../FEATURES.md#pictures)); the check mark is the folder the frame plays. OK on a picture inside a folder starts the frame there |
| **Change every** | 1, 5, 15, 30 or 60 minutes (when more than one picture). Shuffled; pictures fade into each other |
| **Motion** | **Pan** (default) glides across large pictures, see below. **Still** fills the screen with the picture's crop, or its centre |
| **Brightness** | 20 to 100 % (default 60 %). Dims the picture, not the TV |
| **Instead of Screensaver** | Off by default. When LG's screensaver starts (nothing playing, no key for 3 minutes), LG's shows for about 10 seconds, then the frame takes over. A key ends it and returns to the app you were in |

While a frame runs, LG's screensaver never takes over, with this switch on
or off. LG's own auto power off (if it is on in the TV's settings) still
switches the TV off after a few hours without input.

**Large pictures pan.** A picture bigger than the screen or not 16:9 (a tall
photo, a square painting) fills the screen and glides very slowly:

- **With a crop**, it starts at the far side and glides towards the crop,
  zooming in, so it arrives before the next picture; then it rests there.
- **Without one**, it travels from one corner to the other and back.

A 16:9 picture without a crop only drifts a few pixels now and then, which
protects an OLED panel. Pictures up to about 18 megapixels pan best; bigger
files only cost memory.

## How it works

**Drawing.** WebGL, not CSS (a large CSS animation makes the compositor
rasterise tiles while it moves, which hitches). Each picture is one GPU
texture, never bigger than what the screen can show of it.
`frameworker.js` (a Web Worker) decodes the file once and sends RGB strips
of 64 rows; the main thread copies ready strips into the texture, 4 ms per
frame at most, so loading never touches the motion. Fallbacks: decoding on
the main thread from a blob, or an `<img>` cut by a canvas (cutting straight
from an `<img>` re-decodes the JPEG per strip: 4 fps on the TV). The next
picture is preloaded, so CH+ and the timer switch at once; crossfades take
0.7 s. Every view is a window (x, y, width) into the picture, so travel and
zoom interpolate together, cosine-eased at about 7 screen pixels per second.
The fragment shader runs in `highp` (in `mediump` the lower part of a
picture moved in visible steps). Dimming happens in the shader.

**Keeping LG's screensaver away.** tvpowerd asks registered clients before
its screensaver but starts it whatever they answer, about 3 s later. So:

- `keepawake.py` (started through Homebrew's `exec` when the frame starts)
  answers tvpowerd while TV Home touches `/tmp/atvhome-awake.beat` every
  minute, and quits when the heartbeat is older than 150 s, so it can never
  block the screensaver for good. TV Home also restarts surface-manager's
  idle timer every minute.
- `framesaver.py` (started by `init.d/87-frame-saver` 30 s after boot and by
  TV Home; one copy only) watches tvpowerd's power state. While a frame
  runs, it switches LG's screensaver off (`general.screenSaverEnabled`, which
  tvpowerd follows live) and back on afterwards; a marker file
  (`/var/lib/webosbrew/atvhome/screensaver-off-by-frame`) undoes that after a
  crash or power cut, and a screensaver you switched off yourself stays off.
- **Instead of Screensaver** (`frame.saver` in the config): on "Screen Saver"
  the guard starts the frame behind LG's screensaver and closes LG's after
  10 s, so the frame is already there. A key in those 10 s ends the hidden
  frame and goes back. The switch in Features off also turns this off.

The frame ignores key codes 1536/1537 (the pointer showing or hiding, which
webOS also sends when another window takes the focus) and waits 5 s before
ending when TV Home is hidden. LG's screensaver timer (3 minutes) can't be
changed on the tested model.

**Logs:** `/tmp/atvhome-saver.log` (the guard), `/tmp/atvhome-events.log`
(why a frame ended), `/tmp/atvhome-frame.txt` (frame times per run),
`/tmp/atvhome-awake.log`.

Code: `apps/tv-home/modules/frame/`.
