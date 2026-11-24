# Blitzball

Browser sports toy: underwater sphere arena, 6DOF swim, claim/pass/shoot, an off-ball lunge, wall banks, and a practice teammate. Built with **Vite + Three.js + TypeScript**.

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
| Up / down along the camera (also while aiming a shot) | `Space` / `C` | RB / LT |
| Look (right looks right, up looks up) | Mouse | Right stick |
| Sprint | `Shift` | Left stick click |
| Claim / tackle (along look) | `E` | A |
| Drop (along look) | `Q` | B |
| Pass (tap, or hold to charge) | `F` | X |
| Strafe / aim (3D cursor, over-shoulder camera, slower swim) | Hold RMB | Y |
| Lunge toward your swim, or your look if you are not steering (only when you do not have the ball) | LMB | — |
| Aim an arc (ball stays in the hand; release throws at the power on the meter) | Hold LMB while carrying | RT |
| While aiming: marker left / right | `A` / `D` | Left stick X |
| While aiming: marker up / down | `W` / `S` and `Space` / `C` | Left stick Y, RB / LT |
| Bend the arc, while aiming | Mouse | Right stick |
| Arc range, while aiming | Mouse wheel | — |
| Throw the arc to a teammate | Put the RMB reticle on them, then hold LMB and release | — |
| Zoom out | `V` (hold or toggle via Dev) | LB |
| Call for a pass | `G` | — |
| Reset ball | `R` | Select |
| Dev panel | `` ` `` | — |
| Release mouse | `Esc` | — |

Look axes are standard pointer-lock: mouse-right looks right, mouse-up looks up. The Dev panel can invert each axis (`Invert mouse look X` / `Y`) without resetting the camera. The click that captures the pointer does not shoot and does not lunge. Passes, claim, and drop use the camera look direction. The body turns toward swim velocity, and eases back to the look when you are nearly still. Hold right mouse (or gamepad Y) to strafe: the body stays on the camera aim, the arms reach when your hands are empty, movement stays relative to that aim, and swim speed drops by **Strafe speed** on the dev panel. A world-space cursor rides the look ray. It sticks to a player, the ball, a goal mouth, or the arena shell, and otherwise sits at **Aim cursor distance**. The camera eases onto the shoulder on the side of a held ball (the right shoulder when your hands are empty or the ball is centered in front). **Shoulder offset** is how far it slides, **Shoulder transition** is how quickly, and both ease in and out without a snap. The rig stays inside the sphere. Right-click does not open the browser menu.

Cruise and sprint are slower than the first greybox so a trip across the sphere stays readable. Acceleration, turn rate, and the off-ball lunge stay snappy. Passes and shots are a little slower too. **Cruise speed**, **Sprint mult**, **Pass speed**, **Shot speed min / max**, **Burst speed**, **Burst length**, and **Burst cooldown** are on the dev panel.

While the ball is loose or in flight, an aqua ring and beam mark where it will settle, or the end of a curved shot. The marker hides while someone is holding the ball. Bubbles trail swimmers (thicker in a sprint or a lunge) and the ball (thicker on a fast or bending flight).

Drop a `public/models/blitzball.glb` in place to replace the built-in ball. The procedural ball stays if that file is missing. Do not commit a ripped game asset.

While a shot is held, you coast: `WASD` and `Space` / `C` do not swim. `A`/`D` slide the marker left and right, `W`/`S` (and `Space` / `C`) raise and lower it, the wheel sets range, and the mouse bends the arc instead of looking. That still works while right-click aim is held. Let go of the mouse button to swim and look again. The dev panel can stay open; pointer lock takes the keys back from its sliders.

## Arc shots

The water sim has drag and no gravity, so a shot is not a falling parabola. Hold shoot and the ball stays in the carry pose, in the hands. The camera locks so the yellow marker does not slide around. It starts on the look ray at **Arc aim distance**. While you hold:

- `A`/`D` strafe the marker. `W`/`S` raise and lower it. They do not push it forward and back. `Space` / `C` raise and lower it the same way. **Arc aim speed** is how fast that slide is.
- Mouse (and the right stick) bends the curve. Right bends it to screen-right, up bends it up, through the Bezier control point. **Arc bend speed** is world units of bend per radian. **Arc bend limit** caps that bend as a fraction of the chord.
- The wheel pushes the marker in and out along the look. That bias is the range the next aim starts at (**Arc aim distance**).

A dashed curve previews the throw and updates as the marker moves and the arc bends. Both the marker and the control point are kept inside the sphere, so the whole quadratic stays in the arena.

The hold starts on the default curve immediately: a slight bend toward the throwing hand (screen-right, **Arc hand curve** × chord) plus a small lob (**Arc height** × chord). The body snaps to the camera on that frame, so the arc does not drop or ease in. Mouse bend is added on top and still dominates the shape. **Power fill rate** runs the meter empty-to-full-to-empty while the button is held; release locks the value. That value lerps shot speed from min to max and adds up to **Power angle** × chord of extra loft. It does not replace the mouse bend.

The ball is moved along the parameter of the curve, so it arrives on the marker. If the reticle is on a teammate when you hold the shot, the marker snaps to them and they light up green. Steering the marker or the wheel lets go of the lock. Release throws that arc; the ball tracks them and they catch it. If the curve meets another swimmer, the script ends and the ball keeps the curve's tangent speed (banks and catches still apply).

## What’s playable

- Sphere arena, radius 56, with a translucent shell, caustic shimmer, sunbeams, and a stadium bowl outside the water. Latitude rings mark the sphere without a wireframe cage.
- Human 6DOF swim with sprint and an off-ball lunge; carrier speed/turn damp
- Chase camera that eases to an over-the-shoulder view while you hold aim, on the side of the hand with the ball, and stays inside the sphere
- World-space aim cursor on the look ray while strafing (player, ball, goal, wall, or a set distance)
- Ball claim (facing + radius), laggy hold, pass, charged shoot
- Beginner charge ghost trail
- Sphere wall banks; hard straight hits can fly out → possession reset
- Strict goal rims; continuous play with score + kickoff reset
- Practice: one green-ring teammate who gets open, receives a pass, and passes back after **Teammate pass delay** or when you press `G`. The orange defender holds position unless **Defense chases** is on.
- **3v3 scaffolding**: six roster slots (human + teammate + one defender active; three stubs inactive)
- Dev toggles: goal-axis vs world-up, zoom mode, invert look X/Y, shoulder offset / transition, aim cursor distance, arc hand curve, power fill rate / angle, teammate lock radius, wall/claim/hold/accel/drag/assist knobs

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
