import { randomUUID } from 'node:crypto';

const TABLE_WIDTH = 980;
const TABLE_HEIGHT = 560;
const TABLE_WIDTH_HALF = TABLE_WIDTH / 2;
export const TURN_DURATION_MS = 30_000;

export const TABLE = {
  width: TABLE_WIDTH, height: TABLE_HEIGHT, cushion: 88, railWidth: 22,
  bounds: { left: 98, right: 882, top: 87, bottom: 473 },
  headSpot: { x: 300, y: 280 },
  pockets: [
    { x: 82, y: 72, radius: 21, kind: 'corner' }, { x: 490, y: 68, radius: 18, kind: 'side' }, { x: 898, y: 72, radius: 21, kind: 'corner' },
    { x: 82, y: 488, radius: 21, kind: 'corner' }, { x: 490, y: 492, radius: 18, kind: 'side' }, { x: 898, y: 488, radius: 21, kind: 'corner' },
  ],
  diamonds: [180, 285, 390, 590, 695, 800].map(x => ({ x, y: 52 })),
};
export const BALL_RADIUS = 14;
export const SHOT_IMPACT_DELAY = 0.12;
const BASE_SHOT_SPEED = 480;
const ROLLING_DECELERATION = 80;
const DROP_DURATION_SECONDS = 0.31;

export function randomRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

export function createRack() {
  const pattern = [1, 9, 2, 12, 8, 11, 3, 10, 5, 13, 6, 14, 7, 15, 4];
  const balls = [];
  const cx = TABLE.width * .72, cy = TABLE.height / 2;
  const rowSpacing = BALL_RADIUS * Math.sqrt(3), ballSpacing = BALL_RADIUS * 2;
  let index = 0;
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col <= row; col += 1) {
      const number = pattern[index++];
      balls.push({ id: `ball-${number}`, number, isCue: false, type: number === 8 ? 'eight' : number <= 7 ? 'solid' : 'stripe',
        x: cx + row * rowSpacing, y: cy + (col - row / 2) * ballSpacing, vx: 0, vy: 0, radius: BALL_RADIUS,
        pocketed: false, pocketedThisTurn: false, visible: true, dropProgress: 0, pocketX: null, pocketY: null });
    }
  }
  balls.push({ id: 'cue-ball', number: 0, isCue: true, type: 'cue', x: TABLE.headSpot.x, y: TABLE.headSpot.y, vx: 0, vy: 0, radius: BALL_RADIUS,
    pocketed: false, pocketedThisTurn: false, visible: true, dropProgress: 0, pocketX: null, pocketY: null });
  return balls;
}

export function createGameState() {
  return { balls: createRack(), turnIndex: 0, shotInProgress: false, shotCount: 0, status: 'waiting', winner: null,
    message: 'Open table — groups not assigned.', lastEvent: 'Rack set.', pocketsHit: [], ballInHand: false, foul: false,
    firstContact: false, pendingShot: null, timer: { durationMs: TURN_DURATION_MS, running: false, remainingMs: TURN_DURATION_MS, deadline: null, turnSerial: 0 },
    timeoutCount: 0, lastTimeout: null };
}

function startTurnTimer(match, now = Date.now(), remainingMs = TURN_DURATION_MS) {
  if (match.status !== 'playing' || match.shotInProgress) return;
  const durationMs = Math.max(0, Math.min(TURN_DURATION_MS, remainingMs));
  match.timer = { durationMs: TURN_DURATION_MS, running: true, remainingMs: durationMs, deadline: now + durationMs, turnSerial: (match.timer?.turnSerial || 0) + 1 };
}

function stopTurnTimer(match, now = Date.now()) {
  if (!match.timer) return;
  if (match.timer.running && Number.isFinite(match.timer.deadline)) match.timer.remainingMs = Math.max(0, match.timer.deadline - now);
  match.timer.running = false;
  match.timer.deadline = null;
}

export function createRoom(hostName, socketId) {
  return { code: randomRoomCode(), status: 'waiting', createdAt: Date.now(), resumeStatus: null,
    players: [{ id: socketId, name: hostName, token: randomUUID(), host: true, connected: true, group: null, score: 0 }], match: createGameState() };
}

export function serializeRoom(room, now = Date.now()) {
  const timer = room.match.timer || { durationMs: TURN_DURATION_MS, running: false, remainingMs: TURN_DURATION_MS, deadline: null, turnSerial: 0 };
  const remainingMs = timer.running && Number.isFinite(timer.deadline) ? Math.max(0, timer.deadline - now) : Math.max(0, timer.remainingMs ?? TURN_DURATION_MS);
  return { code: room.code, status: room.status, players: room.players.map(p => ({ id: p.id, name: p.name, host: p.host, connected: p.connected, group: p.group, score: p.score })),
    match: { turnIndex: room.match.turnIndex, status: room.match.status, winner: room.match.winner, message: room.match.message, lastEvent: room.match.lastEvent,
      shotCount: room.match.shotCount, shotInProgress: room.match.shotInProgress, ballInHand: room.match.ballInHand, foul: room.match.foul,
      timeoutCount: room.match.timeoutCount || 0, lastTimeout: room.match.lastTimeout || null,
      timer: { durationMs: timer.durationMs || TURN_DURATION_MS, running: !!timer.running, remainingMs, turnSerial: timer.turnSerial || 0 },
      balls: room.match.balls.map(b => ({ id: b.id, number: b.number, isCue: b.isCue, type: b.type, x: +b.x.toFixed(2), y: +b.y.toFixed(2), vx: +b.vx.toFixed(2), vy: +b.vy.toFixed(2),
        radius: b.radius, pocketed: b.pocketed, visible: b.visible, dropProgress: b.dropProgress || 0, pocketX: b.pocketX ?? null, pocketY: b.pocketY ?? null })) } };
}

export function joinRoom(room, socketId, playerName) {
  if (room.players.length >= 2) return { ok: false, error: 'This room is full.' };
  const player = { id: socketId, name: playerName, token: randomUUID(), host: false, connected: true, group: null, score: 0 };
  room.players.push(player);
  return { ok: true, token: player.token };
}

export function resumeRoom(room, socketId, token) {
  const player = room?.players.find(p => p.token && p.token === token);
  if (!player) return { ok: false, error: 'This room session could not be restored.' };
  if (player.connected && player.id !== socketId) return { ok: false, error: 'This player session is already connected.' };
  const wasDisconnected = !player.connected;
  player.id = socketId;
  player.connected = true;
  if (wasDisconnected && room.status === 'paused') {
    room.status = room.resumeStatus || 'playing';
    room.resumeStatus = null;
    if (room.status === 'playing' && !room.match.shotInProgress && !room.match.timer.running) {
      startTurnTimer(room.match, Date.now(), room.match.timer.remainingMs);
    }
    room.match.message = `${player.name} reconnected. Play resumed.`;
    room.match.lastEvent = 'Player reconnected; match resumed.';
  }
  return { ok: true, player };
}

export function startMatch(room) {
  if (room.players.length < 2 || room.players.some(player => !player.connected)) return { ok: false, error: 'Two connected players are required to start a match.' };
  room.status = 'playing'; room.resumeStatus = null; room.match = createGameState(); room.match.status = 'playing';
  room.players.forEach(p => { p.group = null; p.score = 0; });
  room.match.message = 'Break shot — open table'; room.match.lastEvent = 'Starting the match.';
  startTurnTimer(room.match);
  return { ok: true };
}

export function endMatch(room, socketId) {
  if (!room?.players.some(player => player.id === socketId)) return { ok: false, error: 'Player is not in this room.' };
  if (!['playing', 'paused', 'finished'].includes(room.status)) return { ok: false, error: 'There is no active match to end.' };
  room.status = 'waiting'; room.resumeStatus = null; room.match = createGameState();
  room.players.forEach(player => { player.group = null; player.score = 0; });
  return { ok: true };
}

function collide(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy) || .0001, min = a.radius + b.radius;
  if (distance >= min) return;
  const nx = dx / distance, ny = dy / distance, overlap = min - distance;
  a.x -= nx * overlap * .51; a.y -= ny * overlap * .51; b.x += nx * overlap * .51; b.y += ny * overlap * .51;
  const rvx = b.vx - a.vx, rvy = b.vy - a.vy, vn = rvx * nx + rvy * ny;
  if (vn >= 0) return;
  const impulse = -(1 + .94) * vn / 2;
  a.vx -= impulse * nx; a.vy -= impulse * ny; b.vx += impulse * nx; b.vy += impulse * ny;
}

function segmentDistanceSquared(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay, lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)) : 0;
  const x = ax + t * dx, y = ay + t * dy;
  return { distanceSquared: (px - x) ** 2 + (py - y) ** 2, t, x, y, dx, dy };
}

/** Marks a moving ball captured when its swept center path intersects a pocket's ball-aware opening. */
export function detectPocketEntry(ball, fromX = ball.x, fromY = ball.y) {
  if (ball.pocketed) return null;
  for (const pocket of TABLE.pockets) {
    const sweep = segmentDistanceSquared(fromX, fromY, ball.x, ball.y, pocket.x, pocket.y);
    // The center may enter the visible opening by up to its radius; a small lip allowance keeps edge shots playable.
    const captureRadius = pocket.radius + ball.radius * .82;
    const movedTowardPocket = sweep.dx * (pocket.x - fromX) + sweep.dy * (pocket.y - fromY) > 0.0001;
    if (movedTowardPocket && sweep.distanceSquared <= captureRadius * captureRadius) {
      ball.pocketed = true;
      ball.pocketedThisTurn = true;
      ball.dropProgress = 0.001;
      ball.pocketX = pocket.x;
      ball.pocketY = pocket.y;
      ball.vx *= .12;
      ball.vy *= .12;
      return pocket;
    }
  }
  return null;
}

function hasCushionOpening(axis, ball, coordinate) {
  return TABLE.pockets.some(p => {
    const alignsWithRail = axis === 'horizontal'
      ? (p.y < TABLE_HEIGHT / 2 ? Math.abs(coordinate - TABLE.bounds.top) < 1 : Math.abs(coordinate - TABLE.bounds.bottom) < 1)
      : (p.x < TABLE_WIDTH / 2 ? Math.abs(coordinate - TABLE.bounds.left) < 1 : Math.abs(coordinate - TABLE.bounds.right) < 1);
    const along = axis === 'horizontal' ? Math.abs(ball.x - p.x) : Math.abs(ball.y - p.y);
    return alignsWithRail && along < p.radius + ball.radius * .95;
  });
}

function rail(ball) {
  const { left, right, top, bottom } = TABLE.bounds, r = ball.radius;
  if (ball.x < left + r && !hasCushionOpening('vertical', ball, left)) { ball.x = left + r; ball.vx = Math.abs(ball.vx) * .88; }
  if (ball.x > right - r && !hasCushionOpening('vertical', ball, right)) { ball.x = right - r; ball.vx = -Math.abs(ball.vx) * .88; }
  if (ball.y < top + r && !hasCushionOpening('horizontal', ball, top)) { ball.y = top + r; ball.vy = Math.abs(ball.vy) * .88; }
  if (ball.y > bottom - r && !hasCushionOpening('horizontal', ball, bottom)) { ball.y = bottom - r; ball.vy = -Math.abs(ball.vy) * .88; }
}

function passTurn(room, now = Date.now()) {
  room.match.turnIndex = (room.match.turnIndex + 1) % room.players.length;
  if (room.status === 'playing' && room.match.status === 'playing') startTurnTimer(room.match, now);
}

function expireTurnTimer(room, now = Date.now()) {
  const match = room.match, timer = match.timer;
  if (room.status !== 'playing' || match.status !== 'playing' || !timer?.running || match.shotInProgress || now < timer.deadline) return false;
  const player = room.players[match.turnIndex];
  stopTurnTimer(match, now);
  match.timeoutCount = (match.timeoutCount || 0) + 1;
  match.lastTimeout = { playerId: player?.id || null, playerName: player?.name || 'Player', count: match.timeoutCount };
  match.message = `${player?.name || 'Player'} timed out — turn passed.`;
  match.lastEvent = `Turn timeout #${match.timeoutCount}; turn passed.`;
  passTurn(room, now);
  return true;
}

export function updateRoomPhysics(room, dt = 1 / 60, now = Date.now()) {
  if (!room || room.status !== 'playing') return;
  const match = room.match, balls = match.balls;
  if (expireTurnTimer(room, now)) return;
  const steps = Math.max(1, Math.min(4, Math.ceil(dt / (1 / 60)))); const step = dt / steps;
  for (let s = 0; s < steps; s += 1) {
    if (match.pendingShot) {
      match.pendingShot.remaining -= step;
      if (match.pendingShot.remaining <= 0) {
        const cue = balls.find(b => b.isCue);
        if (cue) { cue.vx = match.pendingShot.vx; cue.vy = match.pendingShot.vy; }
        match.pendingShot = null;
      }
    }
    for (const b of balls) {
      if (b.pocketed) { if (b.dropProgress < 1) b.dropProgress = Math.min(1, b.dropProgress + step / DROP_DURATION_SECONDS); continue; }
      const fromX = b.x, fromY = b.y;
      b.x += b.vx * step; b.y += b.vy * step;
      const speed = Math.hypot(b.vx, b.vy);
      const nextSpeed = Math.max(0, speed - ROLLING_DECELERATION * step);
      if (nextSpeed === 0) b.vx = b.vy = 0;
      else { b.vx *= nextSpeed / speed; b.vy *= nextSpeed / speed; }
      if (!detectPocketEntry(b, fromX, fromY)) rail(b);
    }
    for (let i = 0; i < balls.length; i += 1) for (let j = i + 1; j < balls.length; j += 1) {
      const a = balls[i], b = balls[j];
      if (a.pocketed || b.pocketed) continue;
      if ((a.isCue || b.isCue) && Math.hypot(a.x - b.x, a.y - b.y) < a.radius + b.radius && Math.hypot(a.vx - b.vx, a.vy - b.vy) > .05) match.firstContact = true;
      collide(a, b);
    }
  }
  const moving = balls.some(b => !b.pocketed && Math.hypot(b.vx, b.vy) > .12);
  const droppingThisShot = balls.some(b => b.pocketedThisTurn && b.dropProgress < 1);
  if (!moving && !match.pendingShot && !droppingThisShot && match.shotInProgress) finalizeShot(room, now);
  if (match.timer?.running) match.timer.remainingMs = Math.max(0, match.timer.deadline - now);
  expireTurnTimer(room, now);
}

export function applyShot(room, socketId, payload = {}, now = Date.now()) {
  expireTurnTimer(room, now);
  const playerIndex = room.players.findIndex(p => p.id === socketId);
  if (playerIndex < 0) return { ok: false, error: 'Player is not in this room.' };
  if (room.status !== 'playing') return { ok: false, error: 'The match is not active.' };
  if (playerIndex !== room.match.turnIndex) return { ok: false, error: 'It is not your turn.' };
  if (room.match.shotInProgress) return { ok: false, error: 'A shot is already in progress.' };
  const cue = room.match.balls.find(b => b.isCue);
  if (!cue || cue.pocketed) return { ok: false, error: 'The cue ball is not available.' };
  const angle = Number(payload.angle ?? 0), rawPower = Number(payload.power ?? .45);
  if (!Number.isFinite(angle) || !Number.isFinite(rawPower)) return { ok: false, error: 'Invalid shot values.' };
  const power = Math.min(1, Math.max(.08, rawPower));
  const speed = BASE_SHOT_SPEED * Math.sqrt(power);
  stopTurnTimer(room.match, now);
  cue.vx = 0; cue.vy = 0;
  room.match.pendingShot = { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, remaining: SHOT_IMPACT_DELAY };
  room.match.shotInProgress = true; room.match.shotCount += 1; room.match.foul = false; room.match.ballInHand = false; room.match.firstContact = false;
  room.match.message = `${room.players[playerIndex].name} shoots.`; room.match.lastEvent = 'Cue ball in motion.';
  room.match.balls.forEach(b => { b.pocketedThisTurn = false; }); return { ok: true };
}

function assignGroups(room, ball, current) {
  if (!current.group && (ball.type === 'solid' || ball.type === 'stripe')) {
    current.group = ball.type; room.players[1 - room.match.turnIndex].group = ball.type === 'solid' ? 'stripe' : 'solid';
    room.match.lastEvent = `${ball.type === 'solid' ? 'Solids' : 'Stripes'} assigned by the server.`;
  }
}

function finalizeShot(room, now = Date.now()) {
  const match = room.match, current = room.players[match.turnIndex], pocketed = match.balls.filter(b => b.pocketedThisTurn), cueScratch = pocketed.some(b => b.isCue);
  const eight = pocketed.find(b => b.number === 8); match.shotInProgress = false; match.foul = cueScratch;
  if (eight) {
    const remaining = current.group && match.balls.some(b => b.type === current.group && !b.pocketed);
    const foul = cueScratch || remaining;
    stopTurnTimer(match, now);
    room.status = 'finished'; match.status = 'finished'; match.winner = foul ? room.players[1 - match.turnIndex].name : current.name;
    match.message = `${match.winner} wins${foul ? ' — early 8-ball foul' : ''}.`; match.lastEvent = 'Eight ball pocketed; server resolved match.'; return;
  }
  const legal = pocketed.filter(b => !b.isCue && b.number !== 8);
  if (!cueScratch && match.firstContact && !current.group && legal.length) assignGroups(room, legal[0], current);
  const own = legal.some(b => b.type === current.group);
  if (cueScratch) {
    match.message = `${current.name} scratched — ball in hand.`; match.lastEvent = 'Cue ball pocketed.'; match.ballInHand = true;
    const cue = match.balls.find(b => b.isCue); cue.pocketed = false; cue.visible = true; cue.dropProgress = 0; cue.pocketX = null; cue.pocketY = null;
    cue.x = TABLE.headSpot.x; cue.y = TABLE.headSpot.y; cue.vx = cue.vy = 0;
    passTurn(room, now); return;
  }
  if (!match.firstContact) {
    match.foul = true; match.ballInHand = true; match.message = `${current.name} foul — ball in hand.`; match.lastEvent = 'No object ball contacted.'; passTurn(room, now); return;
  }
  if (own) { match.message = `${current.name} continues.`; match.lastEvent = 'Own-group ball pocketed.'; startTurnTimer(match, now); return; }
  match.message = `${room.players[1 - match.turnIndex].name}'s turn.`;
  match.lastEvent = legal.length ? 'Turn ended.' : 'No ball pocketed; turn passes.';
  passTurn(room, now);
}

export function getRoomByCode(rooms, code) { return rooms.get(String(code || '').toUpperCase()); }
