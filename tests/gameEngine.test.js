import { describe, expect, test } from 'vitest';
import { TABLE, createRoom, joinRoom, resumeRoom, startMatch, applyShot, createRack, detectPocketEntry, updateRoomPhysics } from '../server/gameEngine.js';

describe('room management', () => {
  test('creates a room with a host player', () => {
    const room = createRoom('Host', 'socket-1');
    expect(room.players).toHaveLength(1);
    expect(room.players[0].name).toBe('Host');
  });

  test('joins a second player and rejects a third', () => {
    const room = createRoom('Host', 'socket-1');
    expect(joinRoom(room, 'socket-2', 'Guest').ok).toBe(true);
    expect(joinRoom(room, 'socket-3', 'Extra').ok).toBe(false);
  });

  test('starts a match only when two players are present', () => {
    const room = createRoom('Host', 'socket-1');
    expect(startMatch(room).ok).toBe(false);
    joinRoom(room, 'socket-2', 'Guest');
    expect(startMatch(room).ok).toBe(true);
    expect(room.status).toBe('playing');
  });

  test('pauses a disconnected match and restores the same player on reconnect', () => {
    const room = createRoom('Host', 'socket-1');
    const guest = joinRoom(room, 'socket-2', 'Guest');
    startMatch(room);
    room.players[1].connected = false;
    room.players[1].id = null;
    room.resumeStatus = 'playing';
    room.status = 'paused';
    const resumed = resumeRoom(room, 'socket-2-new', guest.token);
    expect(resumed.ok).toBe(true);
    expect(room.status).toBe('playing');
    expect(room.players[1].id).toBe('socket-2-new');
    expect(room.players[1].connected).toBe(true);
  });

  test('uses a realistic table geometry with a cue head spot and rails', () => {
    const rack = createRack();
    const cueBall = rack.find((ball) => ball.isCue);

    expect(cueBall.x).toBeCloseTo(TABLE.headSpot.x, 1);
    expect(cueBall.y).toBeCloseTo(560 / 2, 1);
    expect(TABLE.railWidth).toBeGreaterThan(10);
    expect(TABLE.headSpot.x).toBeGreaterThan(0);
    expect(TABLE.headSpot.y).toBeGreaterThan(0);
  });
});

describe('game rules', () => {
  test('builds a full rack with fifteen balls plus the cue ball', () => {
    const rack = createRack();
    expect(rack.filter((ball) => !ball.isCue)).toHaveLength(15);
    expect(rack.find((ball) => ball.isCue)?.number).toBe(0);
    expect(rack.find((ball) => ball.number === 8)?.type).toBe('eight');
    expect(rack.find((ball) => ball.number === 10)?.type).toBe('stripe');
    expect(rack.find((ball) => ball.number === 3)?.type).toBe('solid');
  });

  test('starts with a tightly packed rack without overlapping balls', () => {
    const balls = createRack().filter((ball) => !ball.isCue);
    for (let firstIndex = 0; firstIndex < balls.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < balls.length; secondIndex += 1) {
        const first = balls[firstIndex];
        const second = balls[secondIndex];
        expect(Math.hypot(first.x - second.x, first.y - second.y))
          .toBeGreaterThanOrEqual(first.radius + second.radius - .01);
      }
    }
  });

  test('detects invalid shots if the player is not active', () => {
    const room = createRoom('Host', 'socket-1');
    joinRoom(room, 'socket-2', 'Guest');
    startMatch(room);
    const result = applyShot(room, 'socket-2', { angle: 0, power: 0.4 });
    expect(result.ok).toBe(false);
  });

  test('stops physics when balls settle', () => {
    const room = createRoom('Host', 'socket-1');
    joinRoom(room, 'socket-2', 'Guest');
    startMatch(room);
    const cue = room.match.balls.find((ball) => ball.isCue);
    cue.vx = 120;
    cue.vy = 0;
    updateRoomPhysics(room, 1 / 30);
    expect(room.match.shotInProgress || room.match.message).toBeTruthy();
  });

  test('rolling resistance slows balls at a steady rate and brings them to rest', () => {
    const room = createRoom('Host', 'socket-1');
    joinRoom(room, 'socket-2', 'Guest'); startMatch(room);
    const cue = room.match.balls.find((ball) => ball.isCue);
    cue.vx = 160;
    for (let frame = 0; frame < 60; frame += 1) updateRoomPhysics(room, 1 / 60);
    expect(cue.vx).toBeCloseTo(80, 5);
    for (let frame = 0; frame < 60; frame += 1) updateRoomPhysics(room, 1 / 60);
    expect(cue.vx).toBe(0);
  });

  test('server delays one power-scaled cue impulse until the strike reaches the ball', () => {
    const room = createRoom('Host', 'socket-1');
    joinRoom(room, 'socket-2', 'Guest'); startMatch(room);
    expect(applyShot(room, 'socket-1', { angle: 0, power: 0.25 }).ok).toBe(true);
    const cue = room.match.balls.find(ball => ball.isCue);
    expect(cue.vx).toBe(0);
    expect(room.match.pendingShot.vx).toBeCloseTo(180);
    updateRoomPhysics(room, 4 / 60);
    expect(cue.vx).toBe(0);
    expect(applyShot(room, 'socket-1', { angle: 0, power: 1 }).ok).toBe(false);
    updateRoomPhysics(room, 4 / 60);
    expect(cue.vx).toBeGreaterThan(178);
    expect(cue.vx).toBeLessThan(180);
  });

  test('captured balls remain synchronized through a visible pocket drop', () => {
    const room = createRoom('Host', 'socket-1');
    joinRoom(room, 'socket-2', 'Guest'); startMatch(room);
    const ball = room.match.balls.find(b => b.number === 1);
    room.match.balls.filter(b => b !== ball).forEach(b => { b.pocketed = true; });
    ball.x = 100; ball.y = 89; ball.vx = -100; ball.vy = -100;
    updateRoomPhysics(room, 1 / 60);
    expect(ball.pocketed).toBe(true);
    expect(ball.dropProgress).toBeGreaterThan(0);
    expect(ball.dropProgress).toBeLessThan(1);
  });

  test('all six pocket mouths capture balls moving in from the cloth', () => {
    const directions = [
      [40, 40], [0, 40], [-40, 40], [40, -40], [0, -40], [-40, -40],
    ];
    TABLE.pockets.forEach((pocket, index) => {
      const [dx, dy] = directions[index];
      const ball = { x: pocket.x + dx * .5, y: pocket.y + dy * .5, vx: -dx, vy: -dy, radius: 14, pocketed: false };
      const captured = detectPocketEntry(ball, pocket.x + dx, pocket.y + dy);
      expect(captured).toBe(pocket);
      expect(ball.pocketed).toBe(true);
      expect(ball.pocketX).toBe(pocket.x);
      expect(ball.pocketY).toBe(pocket.y);
    });
  });

  test('pocketed balls are removed from collision calculations immediately', () => {
    const room = createRoom('Host', 'socket-1');
    joinRoom(room, 'socket-2', 'Guest'); startMatch(room);
    const ball = room.match.balls.find(b => b.number === 1);
    const neighbor = room.match.balls.find(b => b.number === 2);
    ball.x = 96; ball.y = 87; ball.vx = -60; ball.vy = -60;
    neighbor.x = 100; neighbor.y = 87; neighbor.vx = 0; neighbor.vy = 0;
    const neighborBefore = { x: neighbor.x, y: neighbor.y, vx: neighbor.vx, vy: neighbor.vy };
    updateRoomPhysics(room, 1 / 60);
    expect(ball.pocketed).toBe(true);
    expect(neighbor.x).toBe(neighborBefore.x);
    expect(neighbor.y).toBe(neighborBefore.y);
    expect(neighbor.vx).toBe(neighborBefore.vx);
    expect(neighbor.vy).toBe(neighborBefore.vy);
  });

  test('starts each turn with a 30-second authoritative timer and pauses it for a shot', () => {
    const room = createRoom('Host', 'socket-1');
    joinRoom(room, 'socket-2', 'Guest'); startMatch(room);
    expect(room.match.timer.running).toBe(true);
    expect(room.match.timer.durationMs).toBe(30_000);
    expect(room.match.timer.deadline - room.match.timer.remainingMs).toBeGreaterThan(0);
    const startedAt = Date.now();
    expect(applyShot(room, 'socket-1', { angle: 0, power: .3 }, startedAt).ok).toBe(true);
    expect(room.match.timer.running).toBe(false);
    expect(room.match.timer.remainingMs).toBeLessThanOrEqual(30_000);
  });

  test('times out once, passes the turn, and starts the opponent clock', () => {
    const room = createRoom('Host', 'socket-1');
    joinRoom(room, 'socket-2', 'Guest'); startMatch(room);
    const deadline = room.match.timer.deadline;
    updateRoomPhysics(room, 1 / 60, deadline);
    expect(room.match.timeoutCount).toBe(1);
    expect(room.match.lastTimeout.playerName).toBe('Host');
    expect(room.match.turnIndex).toBe(1);
    expect(room.match.timer.running).toBe(true);
    updateRoomPhysics(room, 1 / 60, deadline + 1);
    expect(room.match.timeoutCount).toBe(1);
  });

  test('awards the legal 8-ball win after the synchronized drop completes', () => {
    const room = createRoom('Host', 'socket-1');
    joinRoom(room, 'socket-2', 'Guest'); startMatch(room);
    room.players[0].group = 'solid'; room.players[1].group = 'stripe';
    for (const ball of room.match.balls) {
      if (!ball.isCue) { ball.pocketed = true; ball.dropProgress = 1; }
    }
    const eight = room.match.balls.find(ball => ball.number === 8);
    eight.pocketedThisTurn = true;
    room.match.shotInProgress = true;
    room.match.firstContact = true;
    updateRoomPhysics(room, 1 / 60);
    expect(room.status).toBe('finished');
    expect(room.match.winner).toBe('Host');
    expect(room.match.timer.running).toBe(false);
  });
});
