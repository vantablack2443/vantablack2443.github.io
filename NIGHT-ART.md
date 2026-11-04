# Lantern River: Gemini art prompts

Make each image in its own Gemini chat. **Attach `portfolio/public/light/poster.jpg` every time** as the style reference, so night matches day.

Save the results in `~/Downloads/night/` with the names below (png or jpg is fine). Claude cuts out the magenta, resizes, makes the layers tile, and converts them to webp.

Rules for every image:
- No text, no logos, no people, no borders, no watermark.
- "Magenta background" means **pure flat #FF00FF**, nothing else in the background, no shadows or gradients on it. That colour is cut out, so don't use pink or magenta anywhere in the subject.
- If Gemini adds a ground shadow or a frame, ask it to remove it.

---

## Shared style (paste at the start of every prompt)

```
Hand-painted anime landscape art in the style of a Studio Ghibli background painting,
soft watercolor and gouache textures, the same painting style and palette as the attached
reference image, but at night: deep indigo and teal-blue shadows, cool moonlight from the
upper left, warm amber lantern light as the only warm colour.
```

---

## 1. Sky — `sky.png` (16:9, no magenta)

```
[shared style]
A night sky over the Kerala backwaters, filling the whole image. Deep indigo at the top fading
to a soft teal glow near the horizon at the bottom. Many small stars, a faint milky band, a few
soft moonlit clouds low on the right. No moon, no land, no water, no trees: sky only.
```

## 2. Moon — `moon.png` (1:1)

```
[shared style]
A single full moon, pale cream with soft painted craters and a gentle glow, centred, on a flat
pure magenta (#FF00FF) background. Nothing else in the image.
```

## 3. Far bank — `far.png` (widest ratio available, 21:9 or 16:9)

```
[shared style]
A very wide, distant tree line seen across a river at night: low silhouettes of coconut palms
and small village houses with a few tiny warm windows, misty and faded by distance, in muted
blue tones. The tree line sits only in the bottom third of the image. Everything above it is a
flat pure magenta (#FF00FF) background. The left and right edges should continue naturally so
the image can be repeated side by side. No water, no sky.
```

## 4. Mid bank — `mid.png` (21:9 or 16:9)

```
[shared style]
A wide river bank at night seen from the side: tall leaning coconut palms, banana plants, a
couple of small Kerala houses with tiled roofs and warm glowing windows, dense dark foliage.
Moonlight rims the leaves. The bank fills the bottom half of the image and ends in a straight
horizontal edge at the very bottom (where the water will be). Everything above the trees is a
flat pure magenta (#FF00FF) background. Edges should continue naturally for repeating.
No water, no sky.
```

## 5. Foreground — `front.png` (21:9 or 16:9)

```
[shared style]
Foreground plants seen very close, at night: tall reeds, grass blades, a few deep red hibiscus
flowers and leaves, dark and slightly blurred like a near layer of a painting, moonlight on the
edges. The plants rise from the bottom edge and fill only the bottom quarter. Everything above
is a flat pure magenta (#FF00FF) background. Edges should continue naturally for repeating.
```

## 6. Boat — `boat.png` (16:9)

```
[shared style]
A small traditional Kerala wooden country boat (vallam) seen exactly from the side, facing right,
with a curved raised bow and stern and a low arched canopy of woven bamboo and palm leaves over
the middle. Dark wood with moonlit edges, a small warm lantern glow inside the canopy. Only the
boat, from the waterline up; the hull bottom is cut by a straight horizontal line (no water,
no reflection, no shadow). Flat pure magenta (#FF00FF) background.
```

## 7. Lanterns — `lantern-off.png` and `lantern-on.png` (1:1)

First image:
```
[shared style]
A single small hanging brass and paper lantern, traditional Kerala style, seen from the side,
with a short ring on top for a rope. Unlit: dark, cool moonlight on its edges. Centred on a
flat pure magenta (#FF00FF) background. Nothing else.
```
Then in the same chat:
```
The exact same lantern, same size and position, but lit: warm amber light glowing from inside.
Keep the background flat pure magenta (#FF00FF), no glow spilling onto the background.
```

## 8. Dock — `dock.png` (1:1)

```
[shared style]
A small wooden jetty at night seen exactly from the side: a short plank walkway on stilts with
one tall mooring post at the right end, a blank wooden sign board on a pole (no text on it), and
a small unlit lamp on the sign. The stilts end in a straight horizontal line at the bottom (no
water). Flat pure magenta (#FF00FF) background.
```

## 9. Floating things — `log.png` and `hyacinth.png` (16:9)

```
[shared style]
A single old floating wooden log seen from the side, moss on top, cut by a straight horizontal
line at the bottom (no water). Flat pure magenta (#FF00FF) background.
```
```
[shared style]
A small floating raft of water hyacinth with glossy leaves and two pale blue-white flowers, seen
from the side, cut by a straight horizontal line at the bottom (no water). Flat pure magenta
(#FF00FF) background.
```

---

**Don't make:** the water (it is drawn from the physics so it moves with the boat), fireflies and lantern glow (drawn in code), or any video.
