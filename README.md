# Saitama 8 Ball Pool Game

A browser-based 8-ball pool game with room-code multiplayer, trick-shot challenges, and a computer opponent. The Node.js server remains authoritative for shots, physics, pocket events, and group assignment. Run it on local Wi-Fi or deploy it to let players connect over the internet.

## What changed

- Reworked the canvas table with a proportion-preserving playfield, dark wood rails, cushion noses, six pocket wells, subtle cloth weave, and table sights.
- Added shaded billiard balls with correct solid/stripe colors and number patches; stripe bands are rendered on the curved ball surface.
- Replaced the block-shaped cue with a tapered, shaded wooden cue. A separate power slider pulls the cue backward; its value determines the server-applied cue-ball velocity.
- Split aiming, charging, and shooting into separate actions. A pointer release never fires; the explicit Shoot action is required, and Cancel charge returns power to the soft minimum.
- Added one server-accepted strike event per shot. Both clients animate the cue tip forward; the host delays the real impulse until the cue reaches contact, then applies the selected velocity.
- Bundled short cue-strike and pocket-drop sound effects locally and added them to the versioned offline cache.
- Added a subtle cue-ball path and approximate first-contact/object-ball direction guide.
- Reworked collisions, drag, rail rebound, and pocket-entry/drop state in the host-authoritative physics engine.
- Added swept-path capture against all six ball-aware pocket openings, cushion gaps at pocket mouths, and synchronized drop-to-well animation; pocketed balls leave collision handling immediately.
- Added a polished procedural cue with a tapered wood shaft, dark lacquered butt, metallic/accent rings, tip and ferrule, power pull-back, strike animation, and impact glint.
- Added a host-authoritative 30-second turn clock. It continues during aiming, pauses for shot physics, passes the turn once on timeout, and is shown as a shared countdown/progress ring with warning colors.
- Added player session recovery; a disconnected active match pauses and resumes with the same player and remaining shot-clock time.
- Added a live player/turn/connection HUD and remaining-ball lists. Groups begin unassigned and the server assigns them after a non-foul object-ball pot on an open table.
- Corrected the old velocity scaling so server speeds are treated as pixels per second and do not jump hundreds of pixels per frame.

## Architecture

- Client: Vite, vanilla JavaScript, Canvas renderer (`src/`)
- Multiplayer: Express and Socket.IO (`server/`)
- Authoritative game state and physics: `server/gameEngine.js`
- Automated tests: Vitest (`tests/`)

The client renders synchronized state; it does not decide the official shot result. The browser connects to Socket.IO on the same origin, so the same room-code flow works locally and from a public deployment.

## Run on a local Wi-Fi network

1. Install Node.js and dependencies on the host computer:
   ```bash
   npm ci
   ```
2. Build the browser client:
   ```bash
   npm run build
   ```
3. Start the local server:
   ```bash
   npm run start
   ```
   It listens on `0.0.0.0:3000` by default. Allow inbound TCP port 3000 on the host's local firewall if needed.
4. Find the host computer's Wi-Fi/LAN IP address. On both phones, open `http://<host-LAN-IP>:3000` while connected to the same router or phone hotspot.
5. The first player selects **Host Game** and creates a room. The second selects **Join Game** and enters the displayed room code. Start once both are connected.

For development, `npm run dev` starts Vite and the local server separately. Open the Vite URL on the host; for phones, use the host's LAN address and the Vite port printed by the command. The production server (`npm run start`) serves the built client from the same port as the game server.

## Play over the internet

The included [`render.yaml`](render.yaml) configures a single Render web service that builds the client and runs the Socket.IO server. Use the [Render deploy link](https://render.com/deploy?repo=https://github.com/SaitamaTech/8ballpool), connect your GitHub account, choose `SaitamaTech/8ballpool`, and deploy the Blueprint. When Render finishes, open the public `onrender.com` URL; players can create and join rooms from different networks using the same room-code flow.

The free Render plan may sleep when idle, so the first visit after inactivity can take a little longer. Rooms are held in server memory and are lost if the service restarts. Keep a single service instance for this version; running multiple instances would require shared room state and a Socket.IO adapter.

## Controls

- Drag anywhere on the cloth to aim; releasing the pointer does not shoot.
- Use the separate **Shot power** slider to pull the cue back and set actual shot power. **Cancel charge** resets to a gentle shot.
- Tap **Shoot** to request one server-validated strike. The synchronized cue animation reaches impact at the same delay as the server's impulse.
- The cue guideline and power meter are visual aids; the server decides the result.

## Automated verification performed

- `npm test`: **36 tests passed**, including pocket approaches, foul penalties and cue placement, timer timeout, reconnect recovery, and legal 8-ball resolution.
- `npm run build`: **passed**.
- Local HTTP smoke test: built app and Socket.IO endpoint served successfully.
- Two-client Socket.IO smoke test: room creation/join, synchronized 30-second timer, one strike event per client, shot-state synchronization, and timer pause during shot passed.
- Live browser check: the cue rotated and pulled back with aim/power input; the clock expired once, passed the turn, and started the opponent's timer.

These checks are not a substitute for testing on physical Android phones.

## Two-phone manual test checklist

- [ ] Put both phones on the same Wi-Fi router or hotspot; internet access may be disabled.
- [ ] Open the host's LAN URL on both phones; create and join the same room code.
- [ ] Start a match and confirm both phones show the same names, turn, and open-table state.
- [ ] Drag around the table to aim; confirm pointer release alone does not shoot. Rotate the cue and guideline together.
- [ ] Move the shot-power slider: confirm cue pull-back and meter change. Use Cancel charge, then confirm it returns to the soft minimum.
- [ ] Tap Shoot once; confirm one cue strike, one sound, and that higher power produces a stronger server-simulated shot on both devices.
- [ ] Observe object-ball collisions and cushion rebounds on both screens.
- [ ] Pot a ball: confirm both clients show the same entry/drop and that the ball stays pocketed.
- [ ] On an open table, pot a solid or stripe and confirm the server-assigned groups and remaining-ball lists agree on both clients.
- [ ] Confirm turn changes and that the non-active player cannot submit a shot.
- [ ] Try a scratch/invalid contact and check the resulting foul/ball-in-hand message.
- [ ] Test the 8-ball outcome and verify both clients show the same winner.
- [ ] Resize/rotate the phones and verify all six pockets remain visible and controls remain usable.
- [ ] Refresh/reconnect only as a resilience check; a disconnected active game now pauses and resumes via the saved room session.

## Known limits

- Contact-point spin/English and full official 8-ball rule edge cases (including call-shot/break variants) are not implemented in this pass.
- The predicted object-ball path is approximate and does not promise a pocket; actual outcomes come from server physics.
- No two physical Android phones were available for a same-router/offline Wi-Fi test; transport, local server behavior, and offline asset bundling were validated locally.
