# Changelog

## 0.1.1

**It now finds each transition's center and puts it exactly on the cut.**

- **Center detection.** A transition built as two halves meeting at the cut (a "split") uses the meeting point as its center. A transition with in/center/out keyframes uses the keyframe shared by its effects. If neither is found the panel says so and suggests cutting the transition in two at its center. Split and keyframes must agree within 1 frame or you get a warning.
- **"Line each transition's center up on its cut"** option in Setup, on by default. Turn it off for an exact copy of the template.
- **Exact math.** Everything is computed in whole ticks, not decimal seconds. Shifts are checked to be whole frames.
- **Audit after every stamp.** Every transition is measured against its template and its cut: "Checked: N of N transitions are exactly centered and identical to their template, to the tick."
- **Stamp, Ctrl+Z, swap, stamp again now works.** Templates are found by style on the live timeline, and Stamp rescans first. (Before, an undo left the dropdowns pointing at a stamped copy that no longer existed, and the panel said nothing could be stamped.)
- **Clearer messages.** "Nothing to stamp" now says why (no template picked vs edges already have a transition).
- **Style grouping.** The IN/OUT dropdowns list each distinct transition once with a count (`×24`), with clearer labels (`V7 split`, `V7 (3 clips)`).
- **⇄ swap** button to exchange the IN and OUT picks, an About tab, a setup card and scroll fixes.
- **Setup hint:** the "transitions start" track and every track above it is searched for transitions.

Known limit: stamped copies are not linked (Premiere's plugin API has no linking). See [docs/decisions.md](docs/decisions.md).

## 0.1.0

First public release: stamps your IN and OUT transitions (adjustment layers, keyframes and whoosh) onto every block edge of the main footage track, in one undoable step.
