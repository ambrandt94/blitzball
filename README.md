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
| Up / down along the camera | `Space` / `C` | D-pad up / down |
| Look (right looks right, up looks up) | Mouse | Right stick |
| Sprint | `Shift` | Left stick click |
| Claim (along look). While squared up with empty hands, toggles catch-ready | `E` | A or X |
| Drop (along look) | `Q` | Y |
| Pass (tap, or hold to charge). Squared up with the ball: hold to drop-kick. Empty hands: hold and meet the ball to volley | `F` | B |
| Square up: upright tread, slowed swim, with or without the ball. With the ball, the landing marker sits on the straight throw and no curve is shown | Hold RMB | LT |
| Shoulder check along your swim, or your facing if you are not steering (only when you do not have the ball). Knocks any swimmer back, staggers them, and pops a held ball loose. While catch-ready, this click deflects a nearby ball along your aim and does not catch it. A hold is a power tackle | LMB | RB (tap light, hold power) |
| Throw an arc. The aim direction locks to you, the ball stays in the hand, and the marker slides with power. Meter and Hold throw on release. Tap waits for extra clicks | Hold LMB while carrying | RT |
| While throwing: creep (about 30% speed). The trajectory and the marker move with you | `WASD` and `Space` / `C` | Left stick, d-pad |
| Bend the arc, while throwing. Meter, Hold, and Tap: both mouse axes bend. Target and Pull: horizontal bends, vertical sets distance or pull | Mouse | Right stick |
| Full-power reach, while throwing. The wheel sets how far a full-power shot lands. In Target mode the wheel slides the landing spot instead | Mouse wheel | — |
| Power mode: Meter, Tap, Hold, Target (aim the landing spot), or Pull (drag back to charge). Saved in the browser | Dev panel, Power mode | — |
| Cancel a throw, including the Tap window, or a kick that is still charging. The ball stays in the hand and letting go of the trigger does not fire | `RMB` while the throw or kick is held | Release LT (a charging kick) |
| Throw the arc to a teammate | Put the landing marker on them, then hold LMB and release | — |
| Wide / overview camera | Middle mouse toggles. `V` still zooms (hold, or toggle when Dev says so) | LB |
| Call for a pass | `G` | — |
| Reset ball | `R` | Select |
| Dev panel | `` ` `` | — |
| Release mouse | `Esc` | — |

Look axes are standard pointer-lock: mouse-right looks right, mouse-up looks up. The Dev panel can invert each axis (`Invert mouse look X` / `Y`) without resetting the camera. The click that captures the pointer does not shoot and does not shoulder-check. Passes, claim, and drop use the camera look direction. The body turns toward swim velocity, and eases back to the look when you are nearly still. Hold right mouse (or LT) to square up: the body stays on the camera aim, movement stays relative to that aim, and swim speed drops by **Strafe speed** on the dev panel. With the ball, that aim is the mouse only. The landing marker sits on the straight throw, along the look at **Arc aim distance**, or on a teammate that ray meets. It stays inside the shell. `WASD` does not move it, and right-click does not show the throw curve. The camera eases onto the shoulder on the side of a held ball (the right shoulder when the ball is centered in front). **Shoulder offset** is how far it slides, **Shoulder transition** is how quickly, and both ease in and out without a snap. Without the ball, the same hold squares you up (upright tread, camera centered) and hides the landing marker. `E` then toggles catch-ready: both hands reach toward the ball, a pass inside the cone is caught, and a shot faster than **Fumble speed** can pop loose. A ring marks catch-ready. Letting go of right-click leaves the stance, and cancels a kick that is still charging. With the ball, hold `F` instead of left-click to drop-kick: the same marker, curve, and power mode, then the ball drops and leaves the foot. A kick goes about 25% farther and faster than a throw and bends about half as much. Hold `F` with empty hands and swim into a loose ball to volley it along your aim; you never catch it, and a faster arrival sprays wider. **Catch radius**, **Catch cone**, **Fumble speed**, **Deflect strength**, and the Kick section (**Kick range**, **Kick speed**, **Kick curve**, **Kick windup**, **Volley cone**, **Volley spread**, **Throw speed scale**) are on the dev panel. The rig stays inside the sphere. Right-click does not open the browser menu.

Cruise and sprint are slower than the first greybox so a trip across the sphere stays readable. Acceleration and turn rate stay snappy. Passes and shots are a little slower too. **Cruise speed**, **Sprint mult**, **Pass speed**, **Shot speed min / max**, **Check speed**, **Check window**, and **Check cooldown** are on the dev panel.

A shoulder check is a strong thrust along your current swim, or along facing when you are not steering. The shoulder leads for a short window (about a quarter of a second) and the click then cools down for about 0.9 seconds. During that window, hitting any swimmer — teammate included — knocks them back, staggers their control, and if they are carrying, the ball pops loose along the check. Bodies also push apart so swimmers cannot overlap. A hit you land or take flashes and throws a bubble burst, and the camera shakes.

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
- Chase camera that eases to an over-the-shoulder view while you aim with the ball, and eases back and centers while you square up off-ball
- Landing marker on the straight throw while right-click is held with the ball (look ray at arc aim distance, or a teammate on that ray). No throw curve until left-click. During a throw the marker shows the projected distance, slides with power, and faint rings mark min and max reach. Hidden while reaching off-ball. The marker keeps a steady size on screen and draws in front of swimmers
- Ball claim (forward mitt). Squared up, `E` toggles catch-ready: a wider cone in front catches a slow pass, and a hard shot can fumble. While catch-ready, left-click deflects a nearby ball along the aim without taking it. Laggy hold, pass, charged shoot. Shots aimed or bent into a triangle carry through the opening.
- Beginner charge ghost trail
- Sphere wall banks. A hit reflects off the glass with a little speed lost and the curve kept. Close to the shell the water ripples, glows, and throws bubbles and a splash ring. A hard straight shot breaches: the ball arcs out through a spray, then a throw-in brings it back from that spot. It does not vanish.
- The triangular frame is solid. A clip or an outside hit bounces off the post; only the opening scores. A goal lights the frame, bursts bubbles, holds a GOAL banner, and leaves the ball settling in the net before kickoff.
- **Test opponent** (on by default): one orange swimmer slowly chases the ball, well under cruise speed. With the ball they wander and never pass or shoot, so a shoulder check can pop it loose. The teammate and any other enemy stay parked. Turn the toggle off to restore practice.
- Practice, with the test opponent off: one green-ring teammate who gets open, receives a pass, and passes back after **Teammate pass delay** or when you press `G`. The orange defender holds position unless **Defense chases** is on.
- **3v3 scaffolding**: six roster slots (human + teammate + one defender active; three stubs inactive)
- Dev toggles: goal-axis vs world-up, V/LB zoom hold vs toggle, invert look X/Y, test opponent, arena radius, sunbeams and sunbeam strength, shoulder offset / transition, arc hand curve, power mode (meter / tap / hold / target / pull, saved in the browser) with fill rate, tap window, max taps, and power angle, teammate lock radius, wall/claim/hold/accel/drag/assist knobs

## Not in Phase 0

- Full tech tree / overdrive / RPG stats
- Online multiplayer
- Ripped Final Fantasy models (the ball and swimmers are original procedural meshes)
- Mobile touch
- Win-condition settings UI (score-to-N vs timed)
- Full 3v3 roles and keepers (one practice teammate only; other slots stay stubs)
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
