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
| Up / down along the camera (also while aiming a shot) | `Space` / `C` | RB / LT |
| Look (right looks right, up looks up) | Mouse | Right stick |
| Sprint | `Shift` | Left stick click |
| Claim / tackle (along look) | `E` | A |
| Drop (along look) | `Q` | B |
| Pass (tap, or hold to charge) | `F` | X |
| Strafe / aim (3D cursor, over-shoulder camera, slower swim) | Hold RMB | Y |
| Aim an arc shot (origin locks on press; release throws) | Hold LMB | RT |
| While aiming: marker left / right | `A` / `D` | Left stick X |
| While aiming: marker up / down | `W` / `S` | Left stick Y |
| Arc range, while aiming | Mouse wheel | — |
| Zoom out | `V` (hold or toggle via Dev) | LB |
| Call for a pass | `G` | — |
| Reset ball | `R` | Select |
| Dev panel | `` ` `` | — |
| Release mouse | `Esc` | — |

Look axes are standard pointer-lock: mouse-right looks right, mouse-up looks up. The Dev panel can invert each axis (`Invert mouse look X` / `Y`) without resetting the camera. Passes, claim, and drop use the camera look direction. The body turns toward swim velocity, and eases back to the look when you are nearly still. Hold right mouse (or gamepad Y) to strafe: the body stays on the camera aim, movement stays relative to that aim, and swim speed drops by **Strafe speed** on the dev panel. A world-space cursor rides the look ray. It sticks to a player, the ball, a goal mouth, or the arena shell, and otherwise sits at **Aim cursor distance**. The camera eases onto the shoulder on the side of a held ball (the right shoulder when your hands are empty or the ball is centered in front). **Shoulder offset** is how far it slides, **Shoulder transition** is how quickly, and both ease in and out without a snap. The rig stays inside the sphere. Right-click does not open the browser menu.

## Arc shots

The water sim has drag and no gravity, so a shot is not a falling parabola. Hold shoot to lock the ball where it is. The mouse still looks. The yellow marker starts on the look ray at **Arc aim distance**. While the shot is held, `A`/`D` slide that marker left and right, `W`/`S` raise and lower it, and the mouse wheel sets the range. Those WASD keys do not swim during the aim — horizontal movement waits until you release. `Space` and `C` still swim you up and down. The marker is clamped inside the sphere. A dashed curve previews the throw. Release to send the ball along that curve. On a gamepad, the left stick steers the marker the same way while RT is held.

The curve is a quadratic Bezier. The control point is the midpoint of the chord from the locked origin to the marker, pushed out along the camera's up by **Arc height** × chord length. **Arc charge flatten** lowers the lob as the charge meter fills, and charge also shortens the flight by lerping between the min and max shot speeds. The ball is moved along the parameter of the curve, so it arrives on the marker. If the curve meets the sphere wall or another swimmer, the script ends and the ball keeps the curve's tangent speed (banks and catches still apply).

## What’s playable

- Sphere arena, radius 56, with wireframe + equator / goal-axis cues. Swim, pass, and shot speeds are scaled with it so a trip across the sphere takes about as long as before.
- Human 6DOF swim with sprint; carrier speed/turn damp
- Chase camera that eases to an over-the-shoulder view while you hold aim, on the side of the hand with the ball, and stays inside the sphere
- World-space aim cursor on the look ray while strafing (player, ball, goal, wall, or a set distance)
- Ball claim (facing + radius), laggy hold, pass, charged shoot
- Beginner charge ghost trail
- Sphere wall banks; hard straight hits can fly out → possession reset
- Strict goal rims; continuous play with score + kickoff reset
- Practice: one green-ring teammate who gets open, receives a pass, and passes back after **Teammate pass delay** or when you press `G`. The orange defender holds position unless **Defense chases** is on.
- **3v3 scaffolding**: six roster slots (human + teammate + one defender active; three stubs inactive)
- Dev toggles: goal-axis vs world-up, zoom mode, invert look X/Y, shoulder offset / transition, aim cursor distance, wall/claim/hold/accel/drag/assist knobs

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
