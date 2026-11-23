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
| Thrust | `WASD` | Left stick |
| Up / down | `Space` / `C` | RB / LT |
| Look | Mouse | Right stick |
| Sprint | `Shift` | Left stick click |
| Claim / tackle | `E` | A |
| Drop | `Q` | B |
| Pass (hold to charge) | `F` | X |
| Shoot (hold to charge) | LMB | RT |
| Zoom out | `V` (hold or toggle via Dev) | LB |
| Reset ball | `R` | Select |
| Dev panel | `` ` `` | — |

## What’s playable

- Sphere arena with wireframe + equator / goal-axis cues
- Human 6DOF swim with sprint; carrier speed/turn damp
- Chase / over-shoulder camera; zoom-out hold or toggle
- Ball claim (facing + radius), laggy hold, pass, charged shoot
- Beginner charge ghost trail
- Sphere wall banks; hard straight hits can fly out → possession reset
- Strict goal rims; continuous play with score + kickoff reset
- 1vAI dummy opponent
- **3v3 scaffolding**: six roster slots (human + AI active; four stubs inactive)
- Dev toggles: goal-axis vs world-up, zoom mode, wall/claim/hold/accel/drag/assist knobs

## Not in Phase 0

- Full tech tree / overdrive / RPG stats
- Online multiplayer
- Polished art / FF model rips
- Mobile touch
- Win-condition settings UI (score-to-N vs timed)
- Full teammate AI / keeper roles (stubs only)
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
