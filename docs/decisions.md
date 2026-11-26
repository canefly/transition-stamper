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
- **There is no `window.innerHeight` / `innerWidth`** (both `undefined`), and `document.documentElement.clientHeight` is **not** the viewport: it is the larger of the viewport and the page's content. Sizing a box from it feeds back on itself (the box grew to thousands of pixels). To make a region fill the panel and scroll, use CSS instead: `html, body { height: 100% }`, `body { display: flex; flex-direction: column; box-sizing: border-box }`, and the scroller as `flex: 1; min-height: 0; overflow-y: auto`. JS only toggles `overflow-y` and resets `scrollTop` when the content fits.
- **No resize event for a dragged panel**, so anything that must react to size is either pure CSS (preferred) or re-checked on a short timer.
- **`overflow-y: auto` draws a heavy scrollbar and leaves `scrollTop` where it was** even when the content then fits. Switch it to `hidden` and reset `scrollTop` to 0 when nothing overflows.
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
- **Templates must be on the timeline, and a transition needs a video layer.** They are discovered by scanning for clips touching an edge on the transition tracks. An edge only counts as having a transition if its group contains at least one video clip: a lone whoosh is not a transition (an early version counted it, so "Nothing to stamp" appeared on a timeline full of leftover whooshes).
- **The IN/OUT dropdowns list styles, not copies.** Transitions are grouped into distinct styles (same tracks, same timing around the edge, same effects), each shown once with a count (for example `V7 + A3 · Blur, Lumetri  x24`). Listing every stamped copy produced a 48-row dropdown. Both dropdowns list the same styles so the swap button can exchange the two picks.
- **Swap exchanges roles, not the timeline.** The swap button exchanges which style is used at block starts and which at block ends. When the picks are the exchanged versions of the defaults, both labels show a swapped tag.

## Finding and aligning the center (measured, not assumed)

The first versions never looked for the center. They copied the template shifted by the distance between two cuts, which is only right if the template's center was exactly on its own cut, and nothing checked that. This was changed after a read-only probe on real templates showed the center is detectable:

- **Split transitions:** the two halves meet exactly on the cut (0 frames), on every track.
- **Keyframes:** every animated effect shares one keyframe at the same instant, about 0.08 of a frame (2.7 ms) before the cut, in both transition types. Keyframe times are in the clip's *source* time (with a 1-hour offset in these templates): sequence time = clip start + (keyframe time - clip in-point). The two halves of a split map each keyframe to the same sequence position to within 0.01 frame, which independently confirms the conversion.
- **Not readable:** clip markers (`getProjectItem()` returns nothing for adjustment layers); the whoosh has no keyframes.

Decisions (agreed with the editor): split wins, then the peak keyframe, otherwise "not found" with the advice to cut the transition at its center (no marker support); a split and the keyframes must agree within 1 frame; the whoosh follows the video center at the same offset; and centering each copy on its cut is a **setting that is on by default**, because the plugin now has the center data and the footage-edge data.

Arithmetic is integer **ticks** (BigInt) end to end. Ticks per frame come from `sequence.getTimebase()`. A shift is `new cut - template anchor` in ticks, where the anchor is the template's detected center (or its own cut when center alignment is off or no center is found). The plugin checks that every shift is a whole number of frames, and after a stamp it **audits** every transition: center-to-cut offset and tick-exact equality with its template, ignoring which track a copy sits on.

## Template lookup and the transition track range

- **Templates are found by style, on the live timeline.** The dropdowns used to store an edge number from the last scan. After a stamp the rescan picked a stamped copy as each style's representative, so after Ctrl+Z that edge was empty and every edge came out as "no template" (reported misleadingly as "already has a transition"). Stamp now rescans first, keeps the picks by style signature (so a swap survives), and resolves the template from a fresh `buildStyles`.
- **The Setup "transitions start" track is a floor, not a single lane.** That track and every track above it are searched for transitions at block edges; a stray pair of clips on V10/V11 counted as a transition. A "highest transition track" limit was considered and dropped.
- **Overlay mode (stamp on edges that already have a transition) is parked.** It would reuse the stacking logic, but rejected copies would have to be deleted by hand, piece by piece, because stamped copies are unlinked (see below). Revisit if Adobe adds linking to UXP.
- **Audio: one lane by default, more on request.** Video is scanned from the transitions track up, but audio below the whoosh lane usually holds music and dialogue, so scanning down automatically would copy unrelated clips. Setup > Options > "SFX lanes" (default 1) says how many lanes from the whoosh lane down belong to a transition. On a collision the whole audio group slides down together, keeping its lane order, the same way the video group slides up.
- **A CEP/ExtendScript helper for linking was considered and not built.** UXP can't call ExtendScript, CEP is the deprecated platform, and an unsigned CEP panel needs a debug flag.

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
