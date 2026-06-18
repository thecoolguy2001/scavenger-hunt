# SHOW ME — speed scavenger hunt 🎪

Part of **#30for30** (a project every day in June).

The AI calls out an everyday object. Hold the real thing up to your webcam
before the timer runs out. Find it fast — leftover time and combo streaks
multiply your score.

All vision runs **on-device** with TensorFlow.js + COCO-SSD. The webcam feed
never leaves your browser.

## Run it

The webcam needs a *secure context*, so it must be **served** (not opened as a
`file://`). From this folder:

```bash
python3 -m http.server 8000
```

Then open **http://localhost:8000** and hit *Start the show*.

(Any static server works — e.g. `npx serve`.)

## How it plays

- **Score** = base points × object rarity + 15 per leftover second, all
  multiplied by your current combo.
- **Combo** climbs with every consecutive find (+25% each); a miss or skip
  resets it.
- Rounds get shorter the more you find (down to a 9-second floor).
- **Space** or the *Skip* button passes an item for a 4-second penalty.

## Detectable objects

The model recognizes ~80 COCO classes; the game uses a curated set of grabbable
ones (phone, cup, bottle, book, scissors, banana, keyboard, teddy bear, …).
Edit the `ITEMS` array in `app.js` to add or tune them.

## Files

| file | purpose |
|------|---------|
| `index.html` | markup + CDN script tags |
| `style.css`  | the marquee / game-show look |
| `app.js`     | camera, detection loop, scoring |
