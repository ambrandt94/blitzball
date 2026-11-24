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
| Shoulder check along your swim, or your facing if you are not steering (only when you do not have the ball). Knocks any swimmer back, staggers them, and pops a held ball loose | LMB | — |
| Throw an arc (aim locks, ball stays in the hand, power charges; release throws) | Hold LMB while carrying | RT |
| While throwing: creep (about 30% speed). Does not move the marker | `WASD` and `Space` / `C` | Left stick, RB / LT |
| Bend the arc, while throwing | Mouse | Right stick |
| Arc range, while throwing | Mouse wheel | — |
| Throw the arc to a teammate | Put the landing marker on them, then hold LMB and release | — |
| Zoom out | `V` (hold or toggle via Dev) | LB |
| Call for a pass | `G` | — |
| Reset ball | `R` | Select |
| Dev panel | `` ` `` | — |
| Release mouse | `Esc` | — |

Look axes are standard pointer-lock: mouse-right looks right, mouse-up looks up. The Dev panel can invert each axis (`Invert mouse look X` / `Y`) without resetting the camera. The click that captures the pointer does not shoot and does not shoulder-check. Passes, claim, and drop use the camera look direction. The body turns toward swim velocity, and eases back to the look when you are nearly still. Hold right mouse (or gamepad Y) to aim: the body stays on the camera aim, movement stays relative to that aim, and swim speed drops by **Strafe speed** on the dev panel. With the ball, that aim is the mouse only. The landing marker sits on the straight throw, along the look at **Arc aim distance**, or on a teammate that ray meets. It stays inside the shell. `WASD` does not move it, and right-click does not show the throw curve. The camera eases onto the shoulder on the side of a held ball (the right shoulder when the ball is centered in front). **Shoulder offset** is how far it slides, **Shoulder transition** is how quickly, and both ease in and out without a snap. Without the ball, the same hold reaches both arms forward to catch, hides the landing marker, and eases the camera back onto the center line so the hands and the ball in front of them stay in frame. The rig stays inside the sphere. Right-click does not open the browser menu.

Cruise and sprint are slower than the first greybox so a trip across the sphere stays readable. Acceleration and turn rate stay snappy. Passes and shots are a little slower too. **Cruise speed**, **Sprint mult**, **Pass speed**, **Shot speed min / max**, **Check speed**, **Check window**, and **Check cooldown** are on the dev panel.

A shoulder check is a strong thrust along your current swim, or along facing when you are not steering. The shoulder leads for a short window (about a quarter of a second) and the click then cools down for about 0.9 seconds. During that window, hitting any swimmer — teammate included — knocks them back, staggers their control, and if they are carrying, the ball pops loose along the check. Bodies also push apart so swimmers cannot overlap. A hit you land or take flashes and throws a bubble burst, and the camera shakes.

While the ball is loose or in flight, an aqua ring and beam mark where it will settle, or the end of a curved shot, including a carry into the net. The marker hides while someone is holding the ball. Bubbles trail swimmers (thicker in a sprint or a check) and the ball (thicker on a fast or bending flight).

`public/models/blitzball.glb` is the ball. It is recentered on the physics pivot and scaled to the gameplay radius on load. The procedural ball stays if that file fails to load.

While a throw is held, the camera and the landing marker freeze on the direction you were looking when the button went down. The mouse bends the arc instead of looking. `WASD` and `Space` / `C` still swim, at about 30% of the speed you would otherwise have, and they do not move the marker. The wheel sets range. Let go of the mouse button to throw, look, and swim at full speed again. The dev panel can stay open; pointer lock takes the keys back from its sliders.

## Arc shots

The water sim has drag and no gravity, so a shot is not a falling parabola. Right-click with the ball shows the landing marker on the straight throw and no curve. Hold shoot and the ball stays in the carry pose, in the hands. The camera locks, and that same marker locks on the look ray at **Arc aim distance**. The curve appears only during the hold. While you hold:

- Mouse (and the right stick) bends the curve. Right bends it to screen-right, up bends it up, through the Bezier control point. **Arc bend speed** is world units of bend per radian. **Arc bend limit** caps that bend as a fraction of the chord.
- The wheel pushes the marker in and out along the locked look. That bias is the range the next aim starts at (**Arc aim distance**).
- `WASD` creeps the swimmer. The marker stays where the aim locked.

A dashed curve previews the throw and updates as the swimmer creeps and the arc bends. Both the marker and the control point are kept inside the sphere, so the whole quadratic stays in the arena.

The hold starts on the default curve immediately: a slight bend toward the throwing hand (screen-right, **Arc hand curve** × chord) plus a small lob (**Arc height** × chord). The body snaps to the camera on that frame, so the arc does not drop or ease in. Mouse bend is added on top and still dominates the shape. **Power fill rate** runs the meter empty-to-full-to-empty while the button is held; release locks the value. That value lerps shot speed from min to max and adds up to **Power angle** × chord of extra loft. It does not replace the mouse bend.

The ball is moved along the parameter of the curve, so it arrives on the marker. If that marker is on a teammate when you hold the shot, it stays on them and they light up green. The wheel lets go of that lock. Release throws that arc; the ball tracks them and they catch it. If the curve meets another swimmer, the script ends and the ball keeps the curve's tangent speed (banks and catches still apply).

## What’s playable

- Sphere arena, radius 68, with a translucent shell, caustic shimmer, and a stadium bowl outside the water. Sunbeams hug the shell and fade out in the play volume so they do not wash the chase view. **Arena radius** rebuilds the shell, sunbeams, bowl, and goals, and scales whoever is already swimming. Each end is a bowed triangular frame in coral, orange, and tan, with teal and blue trim, chunky corners, a fin on the bottom point, and a shallow tunnel of nested triangles with a faint crest on the back. A shot scores through that opening. Latitude rings mark the sphere without a wireframe cage.
- Human 6DOF swim with sprint and an off-ball shoulder check; carrier speed/turn damp
- Chase camera that eases to an over-the-shoulder view while you aim with the ball, and eases back and centers while you reach to catch
- Landing marker on the straight throw while right-click is held with the ball (look ray at arc aim distance, or a teammate on that ray). No throw curve until left-click. Hidden while reaching off-ball. The marker keeps a steady size on screen and draws in front of swimmers
- Ball claim (forward mitt; wider while reaching), laggy hold, pass, charged shoot. Shots aimed or bent into a triangle carry through the opening.
- Beginner charge ghost trail
- Sphere wall banks. A hit reflects off the glass with a little speed lost and the curve kept. Close to the shell the water ripples, glows, and throws bubbles and a splash ring. A hard straight shot breaches: the ball arcs out through a spray, then a throw-in brings it back from that spot. It does not vanish.
- The triangular frame is solid. A clip or an outside hit bounces off the post; only the opening scores. A goal lights the frame, bursts bubbles, holds a GOAL banner, and leaves the ball settling in the net before kickoff.
- **Test opponent** (on by default): one orange swimmer slowly chases the ball, well under cruise speed. With the ball they wander and never pass or shoot, so a shoulder check can pop it loose. The teammate and any other enemy stay parked. Turn the toggle off to restore practice.
- Practice, with the test opponent off: one green-ring teammate who gets open, receives a pass, and passes back after **Teammate pass delay** or when you press `G`. The orange defender holds position unless **Defense chases** is on.
- **3v3 scaffolding**: six roster slots (human + teammate + one defender active; three stubs inactive)
- Dev toggles: goal-axis vs world-up, zoom mode, invert look X/Y, test opponent, arena radius, sunbeams and sunbeam strength, shoulder offset / transition, arc hand curve, power fill rate / angle, teammate lock radius, wall/claim/hold/accel/drag/assist knobs

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
