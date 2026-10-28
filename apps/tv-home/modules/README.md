# TV Home modules

Everything beyond the home screen itself is a module: one folder here per
feature. `install.sh` bundles only the chosen ones into TV Home
(`stage_home` in `lib/common.sh`):

- `<id>/<id>.js` files are joined into `modules.js`, `<id>/<id>.css` into
  `modules.css` (both always exist, empty without modules);
- every other file in the folder (Python helpers, the frame's worker) is
  copied next to `app.js`, so their paths are the same as before modules.

A module that isn't chosen has no code on the TV. One that is installed can
still be switched off in Settings, **Features**: then none of its hooks run
and it is hidden (`config.modules[id] = false`). Its settings stay in the
config either way; the core keeps config keys it doesn't know.

| Module | What | Also installs |
|---|---|---|
| `remote` | Settings, Remote Buttons (with the drawing of the remote) | `tv/remote-mapper` |
| `plex` | Continue Watching / New rows, Settings, Plex | `apps/plex-link` |
| `hue` | Light button, Settings, Hue, room cards | `apps/hue-light` |
| `store` | Settings, App Store (part of the privacy lock, not in Features) | `tv/store-mode.sh` |
| `frame` | Picture Frame card, Look, Picture Frame, screensaver guard | `tv/init.d/87-frame-saver` |
| `avr` | AV receiver button (its switch is `config.avrButton`) | – |

The order of `HOME_MODULES` in `lib/common.sh` is the order of their rows in
Settings and of their top buttons.

## Writing one

```js
(function () {
  addModule({
    id: 'thing',
    title: { en: 'Thing', de: 'Ding' },   // the Features row; no title: not switchable there
    strings: { en: { thingRow: 'Thing' }, de: { thingRow: 'Ding' } },
    info: { thing: { title: {...}, lines: [...] } },   // legends for the small "i"
    defaults: { thing: { on: true } },                 // merged into the config defaults
    settingsRows: function () { return [{ label: t('thingRow'), chevron: true, action: openThing }]; }
  });
})();
```

It runs after `app.js` (all core functions and `STRINGS`, `INFO`, `ICONS`
exist) and before `start()`. Hooks, all optional (`claim` hooks return true
when they handled it):

| Hook | Called | Returns |
|---|---|---|
| `available()` | everywhere | false: as if not installed (Hue without its app) |
| `isOn()` / `setOn(on)` | Features | the module keeps its own switch |
| `toggled(on)` | after the Features switch | start / stop what runs on the TV |
| `apps()` | building the app list | cards for the home screen (`virtual: true` = not a real app) |
| `launch(app)` | OK on a card | claim |
| `tile(entry, card, label)` | drawing a card of an unknown type | claim |
| `topButtons()` | top-left buttons | `[{icon, title, action, longAction, cls()}]` |
| `settingsOpen()` / `settingsRows()` | Settings | rows |
| `lookPictures()` / `lookRows()` | Look, under Wallpaper / at the end | rows |
| `remoteActions()` | Remote Buttons' Actions | `[{id, params, title}]` |
| `key(e)` / `ok()` / `longOk()` | home screen keys, before the grid | claim |
| `keydown(e, view)` | every key, before anything | claim (the frame takes all keys) |
| `keep()` / `refresh(kept)` | around rebuilding the grid | its own focus survives |
| `leave()` | focus moved to the grid or the buttons | |
| `load()` / `loaded()` | TV Home reloads / got new data | |
| `reset()` | Home pressed again | |
| `relaunch(params)` | launched again with params | claim |
| `visibility(shown)` | TV Home shown or hidden | |
| `stack()` | a menu opened or closed | |
| `pictureFolderDeleted(id)` | a picture folder was deleted | |
| `start(params)` | once, after the first paint | |

The picture library can be opened for a module: `openPictures(use)` with a
`use` like `WALLPAPER` in `app.js` (`frame.js` has `FRAME_USE`).
