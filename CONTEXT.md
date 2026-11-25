# Premiere Transition Stamper: full context / handoff

Written 2026-11-25. Target: Premiere Pro 27.0 (UXP 9.4), Windows. Folder: D:\Codes\premiere-stamper

## Goal
Auto-stamp a pre-built transition onto EVERY hard cut on V1 (200+ per video), with zero per-cut manual work.
User can already do it by hand (copy/paste at each cut); the whole point is doing 200+ automatically.

## The transition (what must be reproduced)
- An adjustment layer sits on TOP of the V1 clips (e.g. V2), small, with keyframes (in + out) packed into one layer.
- Fixed length per transition type. NOT mathematically centered: a marker marks the visual "center/hit point" (placed by eye) and that marker must line up on the cut.
- A linked whoosh/flash SFX on an audio track, also aligned relative to that marker.
- Some transitions are split: 2 adjustment layers (one in, one out) + 2 whoosh SFX.
- Different videos use different transition types, but within one video it's one type applied to all cuts.
- Fixed lengths: a "flash" is always a flash, never stretched.
- Previous attempt via Premiere MCP failed: MCP can't sense the cut, can't copy/paste to the marker center.

## Decisions made
- Build as a **UXP plugin** ("Transition Stamper"). NOT ExtendScript/JSX runner, NOT CEP.
  - ExtendScript API is frozen by Adobe; CEP being phased out; UXP is GA since Premiere 25.6 and gets new APIs every release.
- NOT parsing XML / FCP XML / .prproj:
  - XML/FCP XML exports are lossy (no custom adjustment layer effects/keyframes). Fine for cut times only.
  - .prproj is gzip-compressed XML (not encrypted) but undocumented, version-specific, can't be safely written into a live project. Premiere itself can import it and expose it through the API instead.
- NOT using presets: applying .prfpset presets from UXP is reported unreliable on Adobe's community forum.
- FX Console clone (Ctrl+Space effect search) is PARKED. UXP can list effects (VideoFilterFactory.getDisplayNames/getMatchNames, createComponent(matchName)) but attaching to a clip is unconfirmed and a forum user hit "The script object is no longer valid". No confirmed way to register a global hotkey.
- Rainy / MCP stay out of the effects part. Stamping must happen inside Premiere via the plugin.
- Templates are version-locked: a prproj/template made in 27.0 won't open in 26.x. Plugin using 27.0 APIs will error on older builds. Check editors' versions before sharing.

## Planned flow
1. User builds each transition ONCE as a template on spare tracks in the timeline (adjustment layer(s), SFX, marker). Name pieces (IN, OUT, SFX1...).
2. Plugin UI: pick transition, press "Apply to all cuts", progress bar.
3. Plugin loops every V1 cut, clones/places all template pieces relative to the template marker offset.
4. New transition = new template, no code.

## Build order
1. **SPIKE (make-or-break):** one button that clones the template adjustment layer onto the FIRST V1 cut via `SequenceEditor.createCloneTrackItemAction`. Answer: do keyframes carry over? Does cloning work for adjustment layers? Same-sequence only? How are Actions executed?
2. Loop all V1 cuts (`VideoTrack.getTrackItems(Constants.TrackItemType.Clip, false)`), skip first/last clip and cuts closer together than the transition length, batch for speed (200+ items).
3. SFX placement (`createOverwriteItemAction` / `createInsertProjectItemAction`) and marker-offset alignment (`Markers.getMarkers`).
4. Multi-piece templates (in/out layers + 2 whooshes) as a group relative to the marker.
5. Small UI.

## Fallbacks if the spike fails
- Read keyframes off the template with ComponentParam and rebuild them on each new layer.
- If adjustment layers can't be inserted via overwrite, test alternatives.
- Do NOT rely on presets.

## UXP API facts found (Premiere 25.6 to 27.0 docs)
SequenceEditor (25.6+):
- `SequenceEditor.getEditor(sequence)`
- `createCloneTrackItemAction(trackItem, timeOffset: TickTime, videoTrackVerticalOffset, audioTrackVerticalOffset, alignToVideo, isInsert): Action`  <- the key method; duplicates a track item at an offset
- `createInsertProjectItemAction(projectItem, time, videoTrackIndex, audioTrackIndex, limitShift)`
- `createOverwriteItemAction(projectItem, time, videoTrackIndex, audioTrackIndex)`
- `createRemoveItemsAction(...)`, `insertMogrtFromPath`, `insertMogrtFromLibrary`
- No copy/paste methods exist.
- The page does not say how Actions get executed (check project/transaction docs).

VideoTrack: `getTrackItems(trackItemType, includeEmptyTrackItems)`, `getIndex()`, `name`, `id`. No insert/overwrite on the track itself.

ComponentParam keyframes:
- Read: `getKeyframeListAsTickTimes()`, `getKeyframePtr(time)`, `getValueAtTime(time)`, `getStartValue()`, `findNearestKeyframe/NextKeyframe/PreviousKeyframe`, `isTimeVarying()`, `areKeyframesSupported()`
- Write: `createKeyframe(value)`, `createAddKeyframeAction(keyframe)`, `createSetInterpolationAtKeyframeAction(time, mode, updateUI)`, `createSetTimeVaryingAction(bool)`, `createSetValueAction(keyframe, safeForPlayback)`, `createRemoveKeyframeAction`, `createRemoveKeyframeRangeAction`
- Note: no `createSetValueAtKeyframeAction` or `setTimeVarying` (those names are wrong).
- 27.0: PointKeyframe values read as { value: [x, y] }, set with PointF; getValueAtTime returns PointF as [x,y] tuple.

Markers: `Markers.getMarkers(owner: Sequence | ClipProjectItem): Promise<Markers>`; instance `getMarkers(filters?)`, `createAddMarkerAction`, `createMoveMarkerAction`, `createRemoveMarkerAction`. Markers live on sequences and project items, NOT on placed timeline clips, so the center marker belongs on the template sequence/project item. The Marker object page (start time, name) was not loaded, so reading exact marker time is unconfirmed (very likely present).

Other: 27.0 has `TickTime.timeToTimecode()/timecodeToTime()`, `uxp.host.buildNumber`. Breaking in 27.0: `Application` removed from the `premierepro` module exports. Premiere version decides which Premiere DOM APIs exist; UXP version (9.4 in 27.0) decides core UXP APIs.

## Unknowns to test
- Does createCloneTrackItemAction keep keyframes? Work across sequences? Work on adjustment layers?
- How to run/commit Actions (likely transaction on the project, confirm in docs).
- Marker object start time property.
- Performance/freezing with 200+ clones (batch it).
- Whether adjustment layer project items can be overwritten onto a track.

## Working notes
- Claude cannot run Premiere. Loop: Claude writes the plugin, user loads it with UXP Developer Tool (UDT) and reports results/errors.
- Plugins sideload via UDT or a .ccx file. They appear under Window > UXP Plugins. No marketplace listing needed.
- User tone preference: witty, gen z, short.

## Sources
- https://developer.adobe.com/premiere-pro/uxp/changelog
- https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequenceeditor
- https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/componentparam
- https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/videotrack
- https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/markers
- https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/videofilterfactory
- https://forums.creativeclouddeveloper.com/t/premiere-27-0-api-updates/12436
- https://blog.developer.adobe.com/en/publish/2025/12/uxp-arrives-in-premiere-a-new-era-for-plugin-development
- https://community.adobe.com/questions-729/applying-presets-via-click-in-uxp-developer-tools-1550963
- https://forums.creativeclouddeveloper.com/t/error-the-script-object-is-no-longer-valid-when-trying-to-append-video-filter-component/11984
