# Lantern River: open issues (for the next round)

Shipped on 2026-11-04 with a "Game still in development" note on the game page.

## From the owner's play test
1. **Water line too high:** the boat and especially the crocodile sit too deep; nothing reads as floating. Lower the draught and the croc's surfaced/lurk water lines.
2. **Boat shrinks too much** when it moves toward the far bank (perspective too strong: far is 0.45× near).
3. **Hard cut-out edges:** the water doesn't merge with the docks, the banks and the background. Needs soft waterline blending, contact shadows / foam where objects meet the water, reflections of the dock and banks, and a soft far-bank edge instead of a straight line.
4. **Floating lantern:** some lanterns look like they hang from nothing (rope or branch not drawn, or not reaching).

## Spotted in screenshots
5. The mid layer (palm bank) still has the moon and cloud repeated; the owner needs to redo it in Gemini ("Remove the moon and the cloud at the top left, fill with flat magenta").
6. The foreground plants sit on a dark strip with a hard straight top edge.
7. A pale hard-edged shape in the water (moon reflection).
8. A stray dark diagonal line from a lantern pole (branch limb).
9. The near half of the river is large and empty.

## Next feature: a real crocodile lunge
The croc should jump out of the water to attack, with its parts moving physically:
- Body as a chain of 6–8 point masses (Verlet, distance + bend constraints). The head is driven toward the boat; the tail follows and whips.
- The sprite is bent along that chain with a Pixi `MeshRope`, so the body arcs and the tail swings.
- The lunge is ballistic: upward velocity in the heave integrator, gravity takes it out of the water and back, and a big Rust-water disturbance on take-off and re-entry (splash ring).
- The jaw opens on a hinge: needs a separate lower-jaw sprite (Gemini: the same croc with its mouth wide open, or the head split into upper and lower jaw).
- Optional: spray particles on take-off and landing.
