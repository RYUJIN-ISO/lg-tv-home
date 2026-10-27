# Backlog

Ideas saved for later. Nothing here is built yet.

## Crop and originals: needs proper UX design

**What happened (2026-10-26):** before version 0.23, cropping in the
Wallpaper menu cut a new file and saved it under the same name, so the
uncut picture was gone. On TV #1 that hit three pictures: Capriccio-Ruins
(3840x5120 became 3840x2160), Reclining-Youth (5079x3544 became 3840x2160)
and simsim (3840x2160 became 2560x1440). Since 0.23 a crop is only a stored
position and never changes the file, so this can't happen again. Reset
cannot bring these three back.

**Recovered (2026-10-26):** the three originals are back on TV #1 with their
cuts stored as crops (found with `find_crop.py`). simsim's camera file carries
EXIF orientation 3 (upside down); it went back as an upright copy, because the
matcher (and possibly the WebGL frame) reads raw pixels. Watch for EXIF
rotation in USB imports too.

**Crop UX, status (0.29, 2026-10-27):**
- Done: the crop screen opens in its bar with the keys shown (key caps) and
  an **i** legend; Up edits the frame, OK saves, Back cancels; previews show
  the crop; Reset shows the whole picture again; ✂ cuts a file for good
  (asks first).
- Open: a picture card could show whether it has a crop (a small mark).
- **Leftovers:** remove `wallpapers/originals/` and the old `orig` handling
  in `cache.js` once nothing needs them (only simsim's old original, 6 MB,
  is left on TV #1).

## Pictures copied in directly

USB imports are scaled to about 18 megapixels; pictures copied straight into
`wallpapers/` are not (nor turned upright, nor given a preview). TV Home
could check the folder and do that itself.

## Free space guard for imports

Imports go to `/var` (about 966 MB, shared with webOS's own settings and
logs) and don't check free space. Refuse an import when less than about
150 MB would be left, with a short message.

## Instead of Screensaver: settings

The 10 seconds LG's screensaver shows before the frame takes over are fixed
(`LG_FIRST` in `framesaver.py`); could be a setting. LG's own 3 minute timer
can't be changed on the tested model.
