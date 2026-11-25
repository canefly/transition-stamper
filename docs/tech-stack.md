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

Node.js is used only for `node --check index.js` and for an old simulated test rig (see [development](development.md)).

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

The plugin targets Premiere 27.0. Some calls (such as `TickTime.timeToTimecode`) are 27.0-only, and a template made in 27.0 won't open in 26.x. Check an editor's Premiere version before sharing.

## Files

```
manifest.json   panel entry point and permissions
index.html      panel UI
index.js        all logic (analysis, planning, stamping, dev tools)
docs/           documentation
tests/          simulated test rig (out of date since the panel rewrite)
CONTEXT.md      original handoff notes
```
