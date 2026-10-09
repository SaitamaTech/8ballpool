import { describe, expect, test } from 'vitest';
import { TABLE, createRoom, joinRoom, resumeRoom, startMatch, startChallenge, getChallenges, endMatch, removePlayerFromRoom, addComputerPlayer, chooseComputerShot, applyShot, createRack, detectPocketEntry, updateRoomPhysics } from '../server/gameEngine.js';

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

  test('adds a connected computer player as the second room member', () => {
    const room = createRoom('Player', 'socket-1');
    const result = addComputerPlayer(room);

    expect(result.ok).toBe(true);
    expect(result.player.computer).toBe(true);
    expect(room.players).toHaveLength(2);
    expect(startMatch(room).ok).toBe(true);
  });

  test('computer selects a server-valid opening shot', () => {
    const room = createRoom('Player', 'socket-1');
    addComputerPlayer(room); startMatch(room);
    room.match.turnIndex = 1;

    const shot = chooseComputerShot(room);

    expect(shot).not.toBeNull();
    expect(applyShot(room, room.players[1].id, shot).ok).toBe(true);
  });

  test('loads solo challenge presets and starts a target-pocket layout', () => {
    const room = createRoom('Player', 'socket-1');
    const challenges = getChallenges();

    expect(challenges).toHaveLength(3);
    expect(startChallenge(room, 'socket-1', challenges[0].id).ok).toBe(true);
    expect(room.mode).toBe('challenge');
    expect(room.challenge.shotsRemaining).toBe(3);
    expect(room.match.balls.filter(ball => !ball.pocketed)).toHaveLength(2);
  });

  test('awards three stars when the target reaches its challenge pocket on the first shot', () => {
    const room = createRoom('Player', 'socket-1');
    startChallenge(room, 'socket-1', 'corner-cut');
    const challenge = room.challenge;
    const angle = Math.atan2(challenge.targetStart.y - challenge.cueStart.y, challenge.targetStart.x - challenge.cueStart.x);
    expect(applyShot(room, 'socket-1', { angle, power: .65 }).ok).toBe(true);
    const target = room.match.balls.find(ball => ball.number === challenge.targetNumber);
    target.pocketed = true; target.pocketedThisTurn = true; target.dropProgress = 1;
    target.pocketX = challenge.targetPocket.x; target.pocketY = challenge.targetPocket.y;
    room.match.pendingShot = null;

    updateRoomPhysics(room, 1 / 60);

    expect(room.status).toBe('finished');
    expect(room.challenge.completed).toBe(true);
    expect(room.challenge.stars).toBe(3);
    expect(room.match.message).toContain('3 stars');
  });

  test('keeps a missed challenge active with two shots remaining', () => {
    const room = createRoom('Player', 'socket-1');
    startChallenge(room, 'socket-1', 'corner-cut');
    expect(applyShot(room, 'socket-1', { angle: -Math.PI / 2, power: .4 }).ok).toBe(true);
    room.match.pendingShot = null;

    updateRoomPhysics(room, 1 / 60);

    expect(room.status).toBe('playing');
    expect(room.challenge.shotsRemaining).toBe(2);
    expect(room.match.timer.running).toBe(true);
  });

  test('ends a match for a room player and returns both players to the lobby', () => {
    const room = createRoom('Host', 'socket-1');
    joinRoom(room, 'socket-2', 'Guest'); startMatch(room);
    room.players[0].group = 'solid'; room.players[1].group = 'stripe';

    expect(endMatch(room, 'socket-2').ok).toBe(true);
    expect(room.status).toBe('waiting');
    expect(room.match.status).toBe('waiting');
    expect(room.match.timer.running).toBe(false);
    expect(room.players.map(player => player.group)).toEqual([null, null]);
    expect(room.players.map(player => player.id)).toEqual(['socket-1', 'socket-2']);
  });

  test('rejects ending a match by a socket outside the room', () => {
    const room = createRoom('Host', 'socket-1');
    joinRoom(room, 'socket-2', 'Guest'); startMatch(room);

    expect(endMatch(room, 'stranger').ok).toBe(false);
    expect(room.status).toBe('playing');
  });

  test('leaves a room cleanly and promotes the remaining human player', () => {
    const room = createRoom('Host', 'socket-1');
    joinRoom(room, 'socket-2', 'Guest'); startMatch(room);

    expect(removePlayerFromRoom(room, 'socket-1')).toEqual({ ok: true, closeRoom: false });
    expect(room.status).toBe('waiting');
    expect(room.players).toHaveLength(1);
    expect(room.players[0]).toMatchObject({ id: 'socket-2', host: true });
    expect(room.match.shotInProgress).toBe(false);
  });

  test('closes a room when its human leaves a computer match', () => {
    const room = createRoom('Player', 'socket-1');
    addComputerPlayer(room); startMatch(room);

    expect(removePlayerFromRoom(room, 'socket-1')).toEqual({ ok: true, closeRoom: true });
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

  test('rejects a direct shot at an opponent group ball', () => {
    const room = createRoom('Host', 'socket-1');
    joinRoom(room, 'socket-2', 'Guest'); startMatch(room);
    room.players[0].group = 'stripe'; room.players[1].group = 'solid';

    const result = applyShot(room, 'socket-1', { angle: 0, power: .42 });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/your remaining balls/i);
    expect(room.match.shotInProgress).toBe(false);
  });

  test('bounces an opponent group ball away from a pocket', () => {
    const room = createRoom('Host', 'socket-1');
    joinRoom(room, 'socket-2', 'Guest'); startMatch(room);
    room.players[0].group = 'solid'; room.players[1].group = 'stripe';
    const ball = room.match.balls.find(candidate => candidate.number === 9);
    room.match.balls.filter(candidate => candidate !== ball && !candidate.isCue).forEach(candidate => { candidate.pocketed = true; });
    ball.x = 100; ball.y = 90; ball.vx = -90; ball.vy = -90;

    updateRoomPhysics(room, 1 / 60);

    expect(ball.pocketed).toBe(false);
    expect(ball.vx).toBeGreaterThan(0);
    expect(ball.vy).toBeGreaterThan(0);
  });

  test('returns an opponent ball potted during an open-table shot', () => {
    const room = createRoom('Host', 'socket-1');
    joinRoom(room, 'socket-2', 'Guest'); startMatch(room);
    room.players[0].group = 'solid'; room.players[1].group = 'stripe';
    const ball = room.match.balls.find(candidate => candidate.number === 9);
    const entry = { x: 120, y: 130 };
    ball.pocketed = true; ball.pocketedThisTurn = true; ball.dropProgress = 1; ball.pocketEntryPosition = entry;
    room.match.firstContact = true; room.match.shotInProgress = true;

    updateRoomPhysics(room, 1 / 60);

    expect(ball.pocketed).toBe(false);
    expect(ball.pocketedThisTurn).toBe(false);
    expect(ball.x).toBe(entry.x);
    expect(ball.y).toBe(entry.y);
    expect(room.match.turnIndex).toBe(1);
    expect(room.match.foul).toBe(true);
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
    expect(room.match.pendingShot.vx).toBeCloseTo(300);
    updateRoomPhysics(room, 4 / 60);
    expect(cue.vx).toBe(0);
    expect(applyShot(room, 'socket-1', { angle: 0, power: 1 }).ok).toBe(false);
    updateRoomPhysics(room, 4 / 60);
    expect(cue.vx).toBeGreaterThan(298);
    expect(cue.vx).toBeLessThan(300);
  });

  test('default power carries the cue into the rack and transfers speed on impact', () => {
    const room = createRoom('Host', 'socket-1');
    joinRoom(room, 'socket-2', 'Guest'); startMatch(room);
    const cue = room.match.balls.find(ball => ball.isCue);
    const headBall = room.match.balls.find(ball => ball.number === 1);
    expect(applyShot(room, 'socket-1', { angle: 0, power: 0.42 }).ok).toBe(true);

    for (let frame = 0; frame < 120 && headBall.vx === 0; frame += 1) updateRoomPhysics(room, 1 / 60);

    expect(room.match.firstContact).toBe(true);
    expect(headBall.vx).toBeGreaterThan(100);
    expect(cue.vx).toBeLessThan(headBall.vx);
  });

  test('glancing ball impacts transfer tangential friction into spin', () => {
    const room = createRoom('Host', 'socket-1');
    joinRoom(room, 'socket-2', 'Guest'); startMatch(room);
    const cue = room.match.balls.find(ball => ball.isCue);
    const objectBall = room.match.balls.find(ball => ball.number === 1);
    room.match.balls.filter(ball => ball !== cue && ball !== objectBall).forEach(ball => { ball.pocketed = true; });
    cue.x = 322; cue.y = 280; cue.vx = 180; cue.vy = 0;
    objectBall.x = 350; objectBall.y = 290;

    updateRoomPhysics(room, 1 / 60);

    expect(cue.spin).not.toBe(0);
    expect(objectBall.spin).not.toBe(0);
    expect(objectBall.vy).toBeGreaterThan(0);
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

  test('captures a shallow corner-pocket approach near the rail edge', () => {
    const ball = { x: 106, y: 100, vx: -360, vy: -360, radius: 14, pocketed: false };

    const captured = detectPocketEntry(ball, 112, 106);

    expect(captured).toBe(TABLE.pockets[0]);
    expect(ball.pocketed).toBe(true);
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
