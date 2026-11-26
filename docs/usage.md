# How to use Transition Stamper

## What it is for

In a documentary-style edit, every block of main footage (a talking head, an interview) starts and ends with a **transition**: adjustment layers with keyframes, plus a whoosh. A video can have 50 to 200 of them, and placing each by hand is slow and easy to get subtly wrong.

Transition Stamper copies **your own** hand-built IN and OUT transition onto every block start and block end, exactly centered on the cut, in one step. It does not invent transitions. You make the look; it does the repetition.

## Before you start

You need, on the active sequence:

1. A **main footage track** (for example V4). Its clips form the blocks.
2. **One IN transition** built by hand at a block start and **one OUT transition** at a block end. Each is the adjustment layer(s) plus the whoosh. A transition can be one clip, or two halves that meet at the cut (a "split").
3. **Empty video tracks above your transitions**, so copies have somewhere to land. Premiere's plugin API can't add tracks, so add them yourself if the panel warns.

Install it first: see [install.md](install.md). Open it from **Window > UXP Plugins > Transition Stamper**.

## Step by step

1. **Setup tab.** Enter three numbers:
   - **Footage track (V):** the track with your main footage.
   - **Transitions start (V):** the lowest track your transitions live on. This track and every track above it is searched for transitions.
   - **Whoosh SFX (A):** the audio track your whooshes sit on.

   Tap **Done**. (Under **Show options** you can have it remember these per project.) Also under **Show options**, **SFX lanes (A)** is how many audio lanes a transition uses, starting at the whoosh lane and going down. Leave it at 1 unless your transitions carry more than one SFX (for example a whoosh on A3 and a second sound on A4); set it to 2 and both are copied together.
2. **Stamp tab.** The panel scans and tells you what it found: how many blocks, how many edges already have a transition.
3. **Pick your templates.** The IN dropdown is the transition used at block starts; OUT is used at block ends. Each distinct transition on your timeline is listed once, with a count (`×24`). If you picked them the wrong way round, tap **⇄** to swap IN and OUT. Nothing on the timeline changes.
4. Check the line under the dropdowns, for example "IN: center found at the split, exactly on the cut".
5. Tap **Stamp**. The panel works out the plan and asks you to confirm ("Stamp 45 transitions (22 IN, 23 OUT)?"). Any warnings show in that box.
6. Confirm. After a moment it reports what it did, and then checks the result: "Checked: N of N transitions are exactly centered and identical to their template, to the tick."

**Ctrl+Z undoes the whole stamp in one step.** After an undo you can swap and stamp again.

## What gets stamped (and what doesn't)

- **Block edges only.** A block is a run of contiguous footage clips (gaps of 0.1 s or less count as contiguous). IN goes at each block start, OUT at each block end. Cuts inside a block get nothing.
- **Edges that already have a transition are left alone.** An edge with only a stray whoosh doesn't count as having one.
- **The 0 s edge is skipped,** because a transition centered there would start before the timeline does.
- **If two transitions would overlap,** video lifts to the first free tracks above (keeping layer order) and the whoosh slides to a free audio track. If nothing is free, that edge is skipped and reported.

## How the center is found

The plugin finds each template's **center** itself and lines it up with the cut:

- **Split (two halves meeting at the cut):** the meeting point is the center.
- **No split:** the keyframe shared by the effects (in, center, out) is the center.
- **Neither found:** the panel says so. Cut the transition in two at its center with the razor, and it becomes a split.

This is on by default. **Setup > Show options > "Line each transition's center up on its cut"** turns it off, which gives an exact copy of the template instead. Details in [overview.md](overview.md).

## Good to know

- **Stamped transitions are not linked.** The whoosh is a separate clip from the adjustment layer, so nudging one doesn't move the other. Marquee-select across the tracks, or press Ctrl+L on a transition's clips, to move it as a unit. (Premiere's plugin API has no way to link clips; see [decisions.md](decisions.md).)
- **It works on the active sequence only,** with one IN and one OUT template per run.
- **Switching project or sequence** refreshes the panel by itself. Tap the refresh icon if you changed the timeline by hand and want fresh numbers (Stamp also rescans before it plans).

## If something looks wrong

| You see | Likely cause |
|---|---|
| "Fill in your tracks first" | Setup is empty. Enter the three numbers and tap Done. |
| "Nothing to stamp: N of M edges already have a transition" | They really do. Ctrl+Z the last stamp, or delete the old ones, then stamp again. |
| "No IN or OUT transition is picked" | Build one by hand, tap the refresh icon, and pick it. |
| Warning: no empty tracks above | Add empty video tracks above your transitions. |
| "center not found" | Cut the template in two at its center, or use keyframes (in, center, out). |
| An unexpected transition style in the dropdown | Something on the transition tracks (that track or above) touches a block edge. Move it away or delete it. |

Developer tools (a log, previews, a command bridge) are in [development.md](development.md); editors don't need them.
