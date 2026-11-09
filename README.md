# Flip Cup — phone-only flick game

Two modes, both driven by your phone's motion sensors (gyroscope + accelerometer):

- **Flip Cup**: a red cup sits on the table edge. Hold your phone flat, screen up, and flick your wrist to flip it rim-down. Flip 6 cups as fast as you can; best time is saved.
- **Bottle Flip**: a water bottle sits in your palm. Pancake-toss it so it does a full flip and lands on its base. Streaks, double flips, and the legendary cap flip.

Phone only. Desktop shows a "Phone only" screen. On iPhone, Safari asks for motion permission on the first mode tap.
If a phone has no gyro (or permission is denied), it falls back to swipe-up-to-flick.

## Run
No build step. Serve the folder statically (motion sensors need HTTPS or localhost):
```
python3 -m http.server 8000
```

## How the flick works
The game waits until the phone lies flat (gravity mostly on the Z axis) for ~0.35 s, then watches the gyro.
A spike over ~230°/s starts a 170 ms capture; the peak pitch/roll rate maps to flick power.
Power sets launch speed and spin; the green zone on the meter is the range that lands.

## Files
- `index.html`, `style.css`: UI
- `js/audio.js`: synthesized sound effects
- `js/game.js`: physics, sensors, rendering, game flow

## Debug
- `?desk=1`: allow desktop and use swipe-up to flick.
