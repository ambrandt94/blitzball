# Blitzball — Phase 0 Greybox

Browser sports toy: underwater sphere arena, 6DOF swim, claim/pass/shoot, wall banks, and a dummy AI opponent. Built with **Vite + Three.js + TypeScript**.

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
| Strafe / aim (body stays on look, slower swim) | Hold RMB | Y |
| Aim an arc (ball stays in the hand; release throws) | Hold LMB | RT |
| Move the aim marker, while aiming | `WASD` (and `Space` / `C`) | Left stick |
| Bend the arc, while aiming | Mouse | Right stick |
| Arc range, while aiming | Mouse wheel | — |
| Zoom out | `V` (hold or toggle via Dev) | LB |
| Call for a pass | `G` | — |
| Reset ball | `R` | Select |
| Dev panel | `` ` `` | — |
| Release mouse | `Esc` | — |

Look axes are standard pointer-lock: mouse-right looks right, mouse-up looks up. The Dev panel can invert each axis (`Invert mouse look X` / `Y`) without resetting the camera. Passes, claim, and drop use the camera look direction. The body turns toward swim velocity, and eases back to the look when you are nearly still. Hold right mouse (or gamepad Y) to strafe: the body stays on the camera aim, movement stays relative to that aim, and swim speed drops by **Strafe speed** on the dev panel. Right-click does not open the browser menu.

While a shot is held, `WASD` does not swim. It slides the aim marker, and the mouse bends the arc instead of looking. Let go of the mouse button to swim and look again.

## Arc shots

The water sim has drag and no gravity, so a shot is not a falling parabola. Hold shoot and the ball stays in the carry pose, in the hands. The camera locks so the yellow marker does not slide around. It starts on the look ray at **Arc aim distance**. While you hold:

- `WASD` moves the marker the same way it swims. `W`/`S` push it forward and back along the look, `A`/`D` strafe it, and `Space` / `C` raise and lower it. **Arc aim speed** is how fast that slide is.
- Mouse (and the right stick) bends the curve. Right bends it to screen-right, up bends it up, through the Bezier control point. **Arc bend speed** is world units of bend per radian. **Arc bend limit** caps that bend as a fraction of the chord.
- The wheel also pushes the marker in and out along the look, on top of `W`/`S`. That bias is the range the next aim starts at (**Arc aim distance**).

A dashed curve previews the throw and updates as the marker moves and the arc bends. Both the marker and the control point are kept inside the sphere, so the whole quadratic stays in the arena.

The resting lob, before any mouse bend, is still the chord midpoint pushed along camera-up by **Arc height** × chord length. **Arc charge flatten** lowers that resting lob as the charge meter fills. It does not undo the mouse bend. Charge also shortens the flight by lerping between the min and max shot speeds. The ball is moved along the parameter of the curve, so it arrives on the marker. If the curve meets another swimmer, the script ends and the ball keeps the curve's tangent speed (banks and catches still apply).

## What’s playable

- Sphere arena, radius 56, with wireframe + equator / goal-axis cues. Swim, pass, and shot speeds are scaled with it so a trip across the sphere takes about as long as before.
- Human 6DOF swim with sprint; carrier speed/turn damp
- Chase / over-shoulder camera; zoom-out hold or toggle
- Ball claim (facing + radius), laggy hold, pass, charged shoot
- Beginner charge ghost trail
- Sphere wall banks; hard straight hits can fly out → possession reset
- Strict goal rims; continuous play with score + kickoff reset
- Practice: one green-ring teammate who gets open, receives a pass, and passes back after **Teammate pass delay** or when you press `G`. The orange defender holds position unless **Defense chases** is on.
- **3v3 scaffolding**: six roster slots (human + teammate + one defender active; three stubs inactive)
- Dev toggles: goal-axis vs world-up, zoom mode, invert look X/Y, wall/claim/hold/accel/drag/assist knobs

## Not in Phase 0

- Full tech tree / overdrive / RPG stats
- Online multiplayer
- Polished art / FF model rips
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
