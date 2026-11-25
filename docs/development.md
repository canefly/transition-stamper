# Development workflow

## One-time setup

1. Premiere Pro 27.0: **Settings > Plugins > Enable developer mode**, then **restart Premiere**. UDT alone is not enough: without Premiere's own switch, UDT reports "No applications are connected to the service".
2. Install **UXP Developer Tool** (Creative Cloud > All apps).
3. Start with Premiere running and fully loaded, then open UDT.
4. UDT: **Add Plugin** > `manifest.json`, then **Load & Watch**. Edits to the files reload the panel automatically.
5. Premiere: **Window > UXP Plugins > Transition Stamper**.

If UDT can't connect: quit UDT fully (check Task Manager for leftover `Adobe UXP Developer Tools` processes), keep only one Premiere instance running, reopen UDT.

## The development loop

1. Claude (or you) edits `index.js` / `index.html`; Load & Watch reloads the panel.
2. In the panel, tick **Developer mode** and click the button under test.
3. The panel writes everything to **`log.txt`** in this folder; read it there instead of copying from the panel.
4. Iterate.

Premiere can't be run by Claude, so the loop depends on a human clicking in Premiere.

## Developer mode

A checkbox at the bottom of the panel. It reveals:

- **List edges**: every detected block edge with timecode and any transition group on it.
- **Inspect templates**: components and keyframe counts of the picked templates.
- **Track census**: per track, clip count, time range, number of blocks and first clip names. Used to work out which track holds the main footage on an unfamiliar project.
- **Log box** and the **command bridge** (below).

Dev mode writes to `D:/Codes/premiere-stamper` (hard-coded as `DEV_DIR` in `index.js`) and needs the `localFileSystem` permission in `manifest.json`. A release build should drop that permission; the plugin catches the failure silently.

### Command bridge (dev mode only)

While dev mode is on, the panel checks `cmd.json` in the project folder every 1.5 s:

```json
{ "id": "t1", "action": "scan" }
```

Actions: `scan`, `listEdges`, `preview`, `inspect`, `census`, `stamp`. Results go to `log.txt` and `bridge-result.json`. `stamp` is refused unless **Allow bridge to STAMP** is ticked in the panel. `cmd.json`, `log.txt` and `bridge-result.json` are git-ignored.

## Panel preferences

Optional and off by default (editors have their own track layouts, so nothing is baked in):

- **Remember these per project**: the three track numbers and the block gap.
- **Remember my picks per project**: the IN and OUT template choice (stored as their timecodes).

Projects are keyed by project path or name, in `localStorage`.

## Tests

`tests/` holds a simulated Premiere (fake timeline, fake panel DOM, fake file system) and 12 scenario tests (`node tests/run.js`). It caught real logic bugs early (an SFX-detection margin, a false "expected N clips" warning), but:

- it only encodes our own understanding of the API and can't prove Premiere behaves the same;
- it is **out of date** since the panel rewrite (new elements and flow), and nobody is maintaining it.

Treat it as history, not a gate.

## Checks

```
node --check index.js
```

Real verification is running it in Premiere and reading `log.txt`: the line `clips on transition lanes: A -> B (added N, expected N)` confirms every planned clip landed.
