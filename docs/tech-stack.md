# Tech stack

| Layer | Choice |
| --- | --- |
| Host | Adobe Premiere Pro **27.0** (tested on 27.0.0.88), Windows |
| Plugin type | **UXP panel** (manifest v5, `host.app = premierepro`, `minVersion 25.6.0`) |
| Runtime | UXP 9.4 (ships with Premiere 27.0) |
| Language | Plain **JavaScript** (`index.js`) and HTML/CSS (`index.html`). No build step, no bundler, no dependencies |
| Premiere API | `require("premierepro")` UXP module |
| Dev tooling | **UXP Developer Tool (UDT)**: Load & Watch auto-reloads on save |
| Storage | `localStorage` for optional per-project preferences |
| Dev-only I/O | `require("uxp").storage.localFileSystem`: writes `log.txt`, reads `cmd.json` (dev mode only) |

Node.js is used only for `node --check index.js` (a syntax check). There is no automated test suite (see [development](development.md)).

## Why UXP

- **ExtendScript** (JSX) is frozen by Adobe: no new APIs.
- **CEP** panels are being phased out.
- **UXP** is the supported path: GA in Premiere since 25.6 and gets new APIs every release.
- **XML / FCP XML** exports are lossy (no custom adjustment-layer effects or keyframes), and `.prproj` is undocumented and version-specific, so neither can carry the transitions.
- **Presets** (`.prfpset`) are reported unreliable to apply from UXP.

## Premiere API surface used

- `Project.getActiveProject()`, `project.getActiveSequence()`
- `Sequence.getVideoTrack(i)`, `getAudioTrack(i)`, `getSettings().getVideoFrameRate()`, `getTimebase()`
- `track.getTrackItems(TrackItemType.CLIP, false)`, `trackItem.getStartTime()`, `getEndTime()`
- `trackItem.getComponentChain()` plus component and param keyframe getters (dev-only inspection)
- `SequenceEditor.getEditor(sequence).createCloneTrackItemAction(trackItem, timeOffset, videoTrackVerticalOffset, audioTrackVerticalOffset, alignToVideo, isInsert)`
- `project.lockedAccess(cb)` with `project.executeTransaction(cb, name)`, one transaction per stamp run (one undo step)
- `TickTime.createWithSeconds()`, `subtract()`

## Version caveat

**Developed on Premiere 27.0; also tried on Premiere 2026.** `manifest.json` declares `minVersion 25.6.0`, which is when UXP plugins became available and when every API this plugin relies on appeared (`createCloneTrackItemAction`, `lockedAccess`, `executeTransaction`, track getters, `TickTime`). It deliberately avoids the 27.0-only calls (it formats timecode itself instead of using `TickTime.timeToTimecode`), and reads the frame rate with `getSettings().getVideoFrameRate()` (26.2+) falling back to `getTimebase()` (25.6+).

The **release build** sets the minimum to Premiere 2026 (26.0.0). It has been run on 27.0 (all development and testing) and the author has also tried it on Premiere 2026 (26.x) and reports it works, but the exact 26.x build wasn't recorded and nothing older than 26.0 has been tried. UXP's UI behaviour (see the quirks in [decisions](decisions.md)) may differ between UXP versions. Separately, a *project* saved in 27.0 won't open in 26.x, which matters for sharing templates. Supported: 27.0 and 2026 (26.x); older versions untested.

## Files

```
manifest.json   panel entry point and permissions
index.html      panel UI
index.js        all logic (analysis, planning, stamping, dev tools)
docs/           documentation
CONTEXT.md      original handoff notes
```
