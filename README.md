# Blitzball

Browser sports toy: underwater sphere arena, 6DOF swim, claim/pass/shoot, an off-ball shoulder check, wall banks, and a practice teammate. Built with **Vite + Three.js + TypeScript**.

Design locked from the Blitzball questionnaire / game plan (chase camera, free 6DOF, goal-axis up toggle, arcade movement + precision ball).

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`). Click the canvas to capture the mouse.

```bash
npm run build    # typecheck + production bundle
npm run preview  # serve the build
```

## Controls

| Action | Keyboard | Gamepad (sketch) |
|--------|----------|------------------|
| Swim (camera-relative, including when pitched) | `WASD` | Left stick |
| Up / down along the camera | `Space` / `C` | RB / LT |
| Look (right looks right, up looks up) | Mouse | Right stick |
| Sprint | `Shift` | Left stick click |
| Claim / tackle (along look) | `E` | A |
| Drop (along look) | `Q` | B |
| Pass (tap, or hold to charge) | `F` | X |
| Reach to catch (wider mitt). With the ball: landing marker on the straight throw, no curve | Hold RMB | Y |
| Shoulder check along your swim, or your facing if you are not steering (only when you do not have the ball). A quick click is a short lunge. Hold to charge a power tackle and release to fire | Tap or hold `LMB` | — |
| Throw an arc. The aim direction locks to you, the ball stays in the hand, and the marker slides with power. Meter and Hold throw on release. Tap waits for extra clicks | Hold LMB while carrying | RT |
| While throwing: creep (about 30% speed). The trajectory and the marker move with you | `WASD` and `Space` / `C` | Left stick, RB / LT |
| Bend the arc, while throwing. Meter, Hold, and Tap: both mouse axes bend. Target and Pull: horizontal bends, vertical sets distance or pull | Mouse | Right stick |
| Full-power reach, while throwing. The wheel sets how far a full-power shot lands. In Target mode the wheel slides the landing spot instead | Mouse wheel | — |
| Power mode: Meter, Tap, Hold, Target (aim the landing spot), or Pull (drag back to charge). Saved in the browser | Dev panel, Power mode | — |
| Cancel a throw, including the Tap window. The ball stays in the hand and letting go of LMB does not fire | `RMB` while the throw is held | — |
| Throw the arc to a teammate | Put the landing marker on them, then hold LMB and release | — |
| Wide / overview camera | Middle mouse toggles. `V` still zooms (hold, or toggle when Dev says so) | LB |
| Call for a pass | `G` | — |
| Reset ball | `R` | Select |
| Dev panel | `` ` `` | — |
| Release mouse | `Esc` | — |

Look axes are standard pointer-lock: mouse-right looks right, mouse-up looks up. The Dev panel can invert each axis (`Invert mouse look X` / `Y`) without resetting the camera. The click that captures the pointer does not shoot and does not shoulder-check. Passes, claim, and drop use the camera look direction. The body turns toward swim velocity, and eases back to the look when you are nearly still. Hold right mouse (or gamepad Y) to aim: the body stays on the camera aim, movement stays relative to that aim, and swim speed drops by **Strafe speed** on the dev panel. With the ball, that aim is the mouse only. The landing marker sits on the straight throw, along the look at **Arc aim distance**, or on a teammate that ray meets. It stays inside the shell. `WASD` does not move it, and right-click does not show the throw curve. The camera eases onto the shoulder on the side of a held ball (the right shoulder when the ball is centered in front). **Shoulder offset** is how far it slides, **Shoulder ease** is how quickly, and both ease in and out without a snap. The Camera section of the dev panel also sets follow distance, height, pitch, FOV, follow lag, look-ahead (aim, movement, or the ball), auto-recenter, ball cam, wide-view distance, and shell collision. Presets are Close, Default, Broadcast, Ball cam, and Cinematic. Editing a slider after a preset switches the menu to Custom. Reset restores Default. The choice is saved in the browser. Middle click and `V` still open the wide view, using **Wide distance**. Without the ball, the same right-click hold reaches both arms forward to catch, hides the landing marker, and eases the camera back onto the center line so the hands and the ball in front of them stay in frame. With shell collision on, the rig stays inside the sphere. Right-click does not open the browser menu.

Cruise and sprint are slower than the first greybox so a trip across the sphere stays readable. Acceleration and turn rate stay snappy. Passes and shots are a little slower too. **Cruise speed**, **Sprint mult**, **Pass speed**, **Shot speed min / max**, and the light and power tackle knobs are on the dev panel.

A shoulder check is a thrust along your current swim, or along facing when you are not steering. Tap left mouse (release within about 0.15s) for a light check: a shorter lunge, less knockback, and a cooldown of about half a second. Hold to charge a power tackle. A small bar by the reticle fills in about 0.55s and hides when you let go. That charge sets the lunge, the knockback, and the chance to pop a held ball loose. A full power tackle cools down for about 1.15s and leaves you briefly staggered. Either check hits teammates. During the hit window, contact knocks them back and staggers their control. Bodies also push apart so swimmers cannot overlap. A hit you land or take flashes and throws a bubble burst, and the camera shakes. **Light speed**, **Light knock**, **Tap time**, **Charge time**, **Power speed**, **Power knock**, **Pop chance**, and **Self stagger** are in the Tackle / Checking section of the dev panel.

While the ball is loose or in flight, an aqua ring and beam mark where it will settle, or the end of a curved shot, including a carry into the net. The marker hides while someone is holding the ball. Bubbles trail swimmers (thicker in a sprint or a check) and the ball (thicker on a fast or bending flight).

`public/models/blitzball.glb` is the ball. It is recentered on the physics pivot and scaled to the gameplay radius on load. The procedural ball stays if that file fails to load.

While a throw is held, the camera locks on the direction you were looking when the button went down. That direction stays relative to you: `WASD` and `Space` / `C` still swim, at about 30% speed, and the whole trajectory, including the landing marker, drifts with you. The mouse bends the arc instead of looking, and that bend starts at 0 on every press. The wheel sets how far full power can reach. Meter and Hold throw when you let go. Tap mode keeps the aim and opens a short click window instead. The dev panel can stay open; pointer lock takes the keys back from its sliders.

## Arc shots

The water sim has drag and no gravity, so a shot is not a falling parabola. Right-click with the ball shows the landing marker on the straight throw and no curve. Hold shoot and the ball stays in the carry pose, in the hands. The camera locks. The landing marker sits on that aim direction, at a distance set by the current power: low power is a short lob, full power reaches **Arc aim distance** (plus the wheel). The curve appears only during the hold. While you hold:

- Mouse (and the right stick) bends the curve, starting from 0 on the press. A click or a hold with no mouse movement throws straight. Right bends it to screen-right, up bends it up, through the Bezier control point. **Arc bend speed** is world units of bend per radian. **Arc bend limit** caps that bend as a fraction of the chord.
- The marker slides in and out as power changes, and the dashed curve follows it. The number on the marker is the projected distance. Two faint rings sit at the minimum and maximum reach along that aim.
- The wheel changes how far full power lands. That bias is the range the next aim starts at (**Arc aim distance**).
- `WASD` creeps the swimmer. The aim direction stays locked to you, so the marker and the curve move with the body.

Both the marker and the control point are kept inside the sphere, so the whole quadratic stays in the arena.

The body snaps to the camera on the press, so the arc does not drop or ease in. A small lob (**Arc height** × chord) is the resting height. **Arc hand curve** is an optional side bias and defaults to 0. Mouse bend is added on top and still dominates the shape. **Power mode** in the dev panel picks how power is chosen, and the choice is saved in `localStorage`:

- **Meter** (default). **Power fill rate** runs the meter empty-to-full-to-empty while the button is held. Release throws at the current value, and the marker is sliding the whole time.
- **Hold**. Power rises linearly while the button is held, stops at full, and release throws. No oscillation.
- **Tap**. The hold still aims and bends. Release opens a **Tap window** (about 0.45s). Each extra click adds power: zero taps is a soft touch, and **Max taps** (about 5) is full power and throws immediately. The marker pulses and jumps outward, a pip lights in the HUD, and a short click plays. Those clicks do not shoulder-check or start a new aim. The throw fires when the window closes if you have not filled it.
- **Target**. You pick the landing spot and power follows it. On the press the marker starts at the current aim distance, clamped between the short lob and full reach. Mouse left/right still bends the curve. Mouse up pushes the marker out along that aim, mouse down brings it in, and the wheel does the same. Power is whatever throw reaches that spot, clamped at full reach. A spot past full power leaves the marker red and dim, and the throw stops at the far ring. Release throws to the chosen in-range spot.
- **Pull**. Drag the mouse down, back toward you, to draw the sling. Power is the pull length up to a max, so a small drag is a soft toss. Sideways drift bends the curve. A faint band stretches back from the hand, and the landing marker slides out as the pull grows. Release throws.

Right-click while the throw is held, in every mode and during the Tap window, cancels it. The ball stays in the hand, power resets, the windup eases back to the carry, and the curve preview goes away (or back to the straight right-click aim if that button is still down). Letting go of left-click afterward does not fire, and that right-click does not shoulder-check or start a catch.

Power lerps shot speed from min to max, slides the landing distance from the short lob out to the aim range, and adds up to **Power angle** × chord of extra loft. It does not replace the mouse bend.

The ball is moved along the parameter of the curve, so it arrives on the marker. If that marker is on a teammate when you hold the shot, it stays on them and they light up green. The wheel lets go of that lock. Release throws that arc; the ball tracks them and they catch it. If the curve meets another swimmer, the script ends and the ball keeps the curve's tangent speed (banks and catches still apply).

## What’s playable

- Sphere arena, radius 68, with a translucent shell, caustic shimmer, and a stadium bowl outside the water. Sunbeams hug the shell and fade out in the play volume so they do not wash the chase view. **Arena radius** rebuilds the shell, sunbeams, bowl, and goals, and scales whoever is already swimming. Each end is a bowed triangular frame in coral, orange, and tan, with teal and blue trim, chunky corners, a fin on the bottom point, and a shallow tunnel of nested triangles with a faint crest on the back. A shot scores through that opening. Latitude rings mark the sphere without a wireframe cage.
- Human 6DOF swim with sprint and an off-ball shoulder check; carrier speed/turn damp
- Chase camera that eases to an over-the-shoulder view while you aim with the ball, and eases back and centers while you reach to catch
- Landing marker on the straight throw while right-click is held with the ball (look ray at arc aim distance, or a teammate on that ray). No throw curve until left-click. During a throw the marker shows the projected distance, slides with power, and faint rings mark min and max reach. Hidden while reaching off-ball. The marker keeps a steady size on screen and draws in front of swimmers
- Ball claim (forward mitt; wider while reaching), laggy hold, pass, charged shoot. Shots aimed or bent into a triangle carry through the opening.
- Beginner charge ghost trail
- Sphere wall banks. A hit reflects off the glass with a little speed lost and the curve kept. Close to the shell the water ripples, glows, and throws bubbles and a splash ring. A hard straight shot breaches: the ball arcs out through a spray, then a throw-in brings it back from that spot. It does not vanish.
- The triangular frame is solid. A clip or an outside hit bounces off the post; only the opening scores. A goal lights the frame, bursts bubbles, holds a GOAL banner, and leaves the ball settling in the net before kickoff.
- **Team roster** (its own card on the dev panel, saved in the browser): a match menu rebuilds both sides. **1v1** is you against one field bot. **1v1 + goalies** adds a goalie each. **3v3**, **4v4**, and **5v5** count field players (you included on home) and start with a goalie; **With goalies** turns that keeper off. Add or remove bots yourself and the menu switches to Custom. Six swimmers a side is the cap. Each bot is **Field**, **Goalie**, or **Test chaser**. A test chaser slowly chases the ball and then wanders with it — they never pass or shoot. A goalie stays in front of their own triangle, steps onto the line between the ball and the goal, reads a straight or curved shot, and catches or parries based on **Goalie skill** (0–100, in Teams, with a per-team override). After a save they pass to a teammate or clear. Removing a bot who is carrying drops the ball loose. The default roster, before you pick a match, is no home bots and one away test chaser.
- **Normal AI**: a home bot gets open, receives a pass, and passes back after **Teammate pass delay** or when you press `G`. An away bot holds position unless **Normal defense chases** is on.
- Rosters grow up to six a side. Spare slots start inactive and wake when you add a bot.
- Dev panel sections (Throwing / Power, Movement, Tackle / Checking, Camera, Arena, Ball / Physics, Teams, Visual / Debug) collapse from their headers, and that state is saved in the browser. The Camera section has follow distance, height, pitch, shoulder, FOV, lag, look-ahead, auto-recenter, ball cam, wide distance, and shell collision, plus Close / Default / Broadcast / Ball cam / Cinematic presets (a manual edit becomes Custom; Reset restores Default). Other toggles and sliders: goal-axis vs world-up, V/LB zoom hold vs toggle, invert look X/Y, arena radius, sunbeams and sunbeam strength, arc hand curve, power mode (meter / tap / hold / target / pull, saved in the browser) with fill rate, tap window, max taps, and power angle, teammate lock radius, light and power tackle knobs, wall/claim/hold/accel/drag/assist knobs, and the team roster.

## Not in Phase 0

- Full tech tree / overdrive / RPG stats
- Online multiplayer
- Ripped Final Fantasy models (the ball and swimmers are original procedural meshes)
- Mobile touch
- Win-condition settings UI (score-to-N vs timed)
- Full 3v3 roles and keepers (bots are normal teammates, normal defense, or test chasers)
- Remappable inputs UI (constants are tunable in code / Dev panel)

## Project layout

```
src/
  main.ts
  game/       # loop, constants, types
  input/      # keyboard + gamepad intents
  sim/        # fixed-step physics, possession, walls
  render/     # Three.js greybox scene
  ai/         # dummy opponent
  ui/         # Dev panel
```
