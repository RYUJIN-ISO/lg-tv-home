# Backlog

Ideas saved for later. Nothing here is built yet.

## Info cards for everything non-standard

**Goal:** wherever TV Home does something a normal LG or Apple TV user would
not expect, a short info card explains what it does and which buttons to
press. The one-line hints under titles (`pickhint`) are easy to miss and
can't hold more than one sentence.

**Idea:**
- An **info card** (an "i" card, same size as the other cards) at the end of
  each grid or menu that has special controls. OK opens a short sheet: a
  title, two or three lines of explanation, and the buttons drawn as small
  remote keys (OK, hold OK, CH+/CH-, arrows, Back).
- **First visit:** the sheet opens once by itself the first time a screen is
  opened, then only via the "i" card. Remembered per screen in the config
  (`seenInfo: []`).
- Same look everywhere; English and German like all other text.
- When the info cards exist, the `pickhint` lines can become shorter or go.

**Screens that need one** (what to explain):

| Screen | Explain |
|---|---|
| Home screen | Hold OK on an app for options; Up reaches Settings, Organize Apps, Light |
| Organize Apps | Dashed outlines mean edit mode; OK opens options; Back saves and leaves |
| Light button | Press: cinema / back; it glows while cinema is on; hold OK: Hue menu |
| Hue rooms | OK switches a room; hold OK opens it; Left/Right change brightness |
| Remote Buttons | Point or move to a button, OK to set it; greyed buttons can't change; Other button; Reset |
| Pictures (library) | Folders shared by Wallpaper and Picture Frame; OK opens; hold OK on folders and pictures; one crop per picture used everywhere |
| Crop screen | Arrows move, wheel resizes, OK reaches the bar; what 4K / Upscaled means; the file is never cut |
| Picture Frame (settings) | What Pan and Still do; pan glides towards the crop; screensaver stays away |
| Picture Frame (running) | CH+/CH- next and previous, arrows look around (auto pan pauses), OK ends |
| App Store | Opens the LG Store for 10 minutes, then locks again; why it is locked |

**Open questions:** should the first-visit sheet also appear for friends who
install the repo (probably yes), and should Settings get a "Show tips again"
switch?
