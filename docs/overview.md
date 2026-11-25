# What Transition Stamper does

## The problem

In a long documentary-style edit, every time the main footage starts or ends (a talking-head block, an interview clip) the editor places a **transition**:

- one or more **adjustment layers** sitting above the footage, packed with keyframes (blur, exposure flash and similar),
- a **whoosh SFX** on an audio track, lined up with the same moment,
- all of it centered on the cut by eye, using a fixed length per transition type (a "flash" is always a flash, never stretched).

Doing this by copy and paste at each cut works, but a video has 50 to 200+ of them. It is slow, repetitive and easy to get subtly wrong.

Earlier attempts failed: a Premiere MCP server can't sense a cut or paste to a marker, and XML/FCP XML exports lose adjustment-layer effects and keyframes.

## What it does

1. You build **one IN transition** and **one OUT transition** by hand, exactly the way you like them, anywhere on the timeline.
2. In the panel you tell it which tracks you use (Setup tab), and pick those two transitions in the dropdowns. Both dropdowns list every transition on the timeline; if you picked them the wrong way round, the **⇄** button swaps your IN and OUT picks without touching the timeline. The About tab shows the version, the author and where to find updates.
3. **Stamp all edges** first works out what it would do and asks you to confirm ("Stamp 75 transitions?"). Only then does it copy your template transitions onto every other edge. (A separate Preview button exists in the Dev tab.)
4. One Ctrl+Z undoes all of it.

## The rule: edges, not cuts

Transitions go only at the **edges of blocks** on the main footage track:

- A **block** is a run of contiguous clips (gaps of 0.1 s or less count as contiguous; configurable).
- **IN** is placed where a block starts, **OUT** where it ends.
- **Inner cuts** between clips inside one block get nothing. (Stamping every hard cut was tried first and was wrong.)

The very first edge at 0 s is skipped, because a transition centered there would start before the timeline does.

## A transition is a group

A transition is every clip around an edge on the transition tracks plus the SFX lane: for example one adjustment layer plus a whoosh for an IN, or two stacked adjustment layers plus a whoosh for an OUT.

To stamp a new edge, the whole group is cloned, shifted by `newEdge - templateEdge`. This means:

- the **hit point is wherever you put it in your template**, so no anchor or marker constants are needed;
- **keyframes, effects and SFX come along** because Premiere clones the real clips;
- different transition types work without code changes: just build a different template.

## Finding the center

Every transition has a **center**: the moment that must land exactly on the cut. The plugin finds it itself instead of trusting where you happened to place the template:

- **Type B (split):** the transition is two halves on a transition track that meet end to end. The meeting point is the center. Only the transition tracks are examined, never the footage lane.
- **Type A (no split):** the effects have keyframes for in, center and out. The center is the keyframe time shared by the effects, placed on the timeline using the clip's in-point and rounded to the nearest frame.
- **Neither found:** the panel says so and suggests cutting the transition in two at its center with the razor (which makes it type B).
- When a split and keyframes are both present, they must agree within one frame, or the panel warns.
- Clip markers can't be read by Premiere's plugin API, so they aren't used. The whoosh can't be detected either; it is copied at the same offset from the video center.

By default (Setup > Options > "Line each transition's center up on its cut") every copy is shifted so its center lands on its own cut, even if the template was a little off its cut. Turn it off to get an exact copy of the template instead.

All of this is computed in **whole ticks** (exact integers), never in decimal seconds, and after every stamp the plugin **audits** the result: it measures each transition's center against its cut and every clip against its template, and reports how many are exact to the tick.

## Collisions

If two transitions would overlap (for example a block ends and another starts 1.2 s later):

- **Video** shifts up as a group to the first free tracks, keeping layer order (an IN colliding with an OUT's two layers lands two tracks higher).
- **Audio** stays on its lane unless occupied, then slides down to the first free lane.
- If nothing is free, that edge is **skipped and reported**, not guessed.

## Feedback

The panel warns about setups that look wrong: transition track not above the footage, no empty tracks above the templates, an SFX track already full of other audio, tracks that don't exist, or a footage track with no clips.

## What it does not do

- It does not invent transitions. You build the IN and OUT.
- It does not stamp the 0 s edge.
- It uses one IN template and one OUT template per run.
- It works on the active sequence only.
