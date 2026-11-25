# Decisions, findings and known limits

## Findings from real Premiere runs

- **Cloning keeps keyframes.** `createCloneTrackItemAction` on an adjustment layer duplicates its effects with their keyframes (Gaussian Blur, Lumetri Color, VR Chromatic Aberrations all came across with the same keyframe counts). This was the make-or-break spike.
- **Create Actions inside the lock.** Creating the Action before `lockedAccess` / `executeTransaction` throws "The script object is no longer valid". Create it inside `executeTransaction`'s callback, inside `lockedAccess`.
- **Audio clones work the same way.** The SFX clip is cloned as a separate Action; stamped whooshes landed correctly.
- **Vertical offset: positive = toward higher track numbers** for video (up). Verified when a colliding IN landed on V9, above an OUT on V7/V8. Audio is assumed to slide down with a positive offset, and was exercised in real runs only for offset 0.
- **Timecode:** the sequence frame rate comes from `sequence.getSettings().getVideoFrameRate().value`. It worked at 30 and 29.97 fps. Timecodes in the panel are non-drop-frame display.
- **Premiere's own dev-mode switch is separate from UDT's.** Both are needed (see [development](development.md)).

## UXP panel UI quirks (learned the hard way)

Things that behave differently from a browser in Premiere's UXP panels:

- **`<input type="number">` shows `nan` when empty and ignores placeholders.** Use `type="text"` and parse the number yourself.
- **`<button variant="cta">` did not turn blue** in Premiere. The primary action is a styled `<div class="cta">` instead.
- **`classList.toggle(name, force)` is unreliable.** Use explicit `add` / `remove`. An error in code that runs outside a `try` can also leave the panel stuck "busy", so the busy flag is reset in a `finally`.
- **Border radius is NOT clamped.** A radius bigger than half the element's height draws bow-tie shapes (a 50px radius on a 32px pill curled inward). Use a radius a little under half the height.
- **Negative margins and show/hide switching can leave stale pixels or stale click areas** until the window is resized. The panel nudges the body padding by 1px after tab switches and toggles to force a fresh layout (`relayout()` in `index.js`).
- **Not relied on:** CSS grid, `gap`, native `<details>`. Layout uses flexbox and margins.
- Hover states (`:hover`) work on divs.
- Premiere's plugin API has no "add track" command, so the panel tells the editor how many empty video tracks to add.

## Design decisions

- **Edges, not hard cuts.** First version stamped all 85 hard cuts, which put transitions in the middle of continuous talking-head blocks. The editor's rule is block edges only.
- **Clone the whole group, shift by the edge difference.** Replaced a hard-coded 0.83 s "anchor" (a leftover from the first spike) with `newEdge - templateEdge`, so any transition type and hit point works.
- **One transaction per stamp.** One Ctrl+Z undoes everything.
- **No baked-in track numbers.** The panel asks for them; remembering is optional, per project. Editors lay out timelines differently.
- **Preview, then confirm, then write.** Plus warnings for setups that look wrong.
- **Stack, don't skip, on collisions** (video up as a group, audio down), and skip with an explicit reason when nothing is free.
- **Templates must be on the timeline.** They are discovered by scanning for clips touching an edge on the transition tracks. The IN/OUT dropdowns list every edge that has a group, including ones the plugin stamped earlier.

## Known limits and open questions

- **Stamped transitions are not linked.** A hand-built transition usually has its whoosh linked to the adjustment layer (and layers to each other), so nudging one moves the rest. Stamped copies are cloned piece by piece and come out **unlinked**: nudge the adjustment layer and the whoosh stays behind. Premiere's UXP API (checked through 27.0 docs and changelog) has no call to link, unlink or group clips, and `createCloneTrackItemAction` does not carry links over. Linking exists only in the legacy ExtendScript API (`Sequence.linkSelection()` and friends), which a UXP plugin cannot call. Editors can marquee-select across the tracks to move a whole transition, or press Ctrl+L on a transition's clips. Revisit if Adobe adds linking to UXP, or if a companion CEP/ExtendScript piece is ever accepted (it would reverse the UXP-only decision).
- The edge at 0 s is skipped.
- One IN and one OUT template per run.
- The "has a transition" check treats any clip on the transition tracks or SFX lane that touches an edge as a transition. An SFX lane that carries other audio (for example a video clip's linked audio) pollutes the groups. The panel warns when the lane holds far more clips than edges.
- A transition's pieces that overlap a *neighboring* edge can make that edge look like it already has a transition; seen only in dense layouts.
- Negative time offsets are built with `TickTime.subtract` from zero; Adobe's docs don't say whether negative `TickTime` values are supported directly.
- Packaging for other editors (`.ccx`, unsigned plugin install behavior, icons) is untested.
- Tested on Windows, Premiere 27.0 only.

## History

The project started from [CONTEXT.md](../CONTEXT.md), a handoff note written before any code existed. Its "unknowns to test" section is now answered above.
