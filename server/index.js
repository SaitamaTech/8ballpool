import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { createRoom, getRoomByCode, joinRoom, resumeRoom, serializeRoom, startMatch, endMatch, addComputerPlayer, chooseComputerShot, updateRoomPhysics, applyShot, SHOT_IMPACT_DELAY } from './gameEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
const rooms = new Map();
app.use(express.json());

const distFolder = path.join(__dirname, '..', 'dist');
const hasBuiltClient = fs.existsSync(distFolder);
if (hasBuiltClient) {
  app.use(express.static(distFolder));
  app.get(/^(.*)$/, (req, res) => { res.sendFile(path.join(distFolder, 'index.html')); });
}

io.on('connection', socket => {
  socket.on('host_room', ({ playerName }) => {
    const room = createRoom(playerName || 'Player 1', socket.id);
    rooms.set(room.code, room);
    socket.join(room.code);
    socket.emit('room_joined', { room: serializeRoom(room), sessionToken: room.players[0].token });
  });

  socket.on('start_computer_game', ({ playerName }) => {
    const room = createRoom(playerName || 'Player 1', socket.id);
    addComputerPlayer(room);
    const result = startMatch(room);
    if (!result.ok) { socket.emit('room_error', result.error); return; }
    rooms.set(room.code, room);
    room.finishedBroadcast = false;
    socket.join(room.code);
    socket.emit('room_joined', { room: serializeRoom(room), sessionToken: room.players[0].token });
    io.to(room.code).emit('state_update', serializeRoom(room));
  });

  socket.on('join_room', ({ code, playerName }) => {
    const room = getRoomByCode(rooms, code);
    if (!room) { socket.emit('room_error', 'Room not found. Check the code and try again.'); return; }
    const result = joinRoom(room, socket.id, playerName || 'Player 2');
    if (!result.ok) { socket.emit('room_error', result.error); return; }
    socket.join(room.code);
    io.to(room.code).emit('room_joined', { room: serializeRoom(room) });
    socket.emit('session_token', { code: room.code, token: result.token });
  });

  socket.on('resume_room', ({ code, token } = {}) => {
    const room = getRoomByCode(rooms, code);
    if (!room) { socket.emit('resume_error', 'The room is no longer available.'); return; }
    const result = resumeRoom(room, socket.id, token);
    if (!result.ok) { socket.emit('resume_error', result.error); return; }
    socket.join(room.code);
    socket.emit('room_joined', { room: serializeRoom(room), sessionToken: result.player.token });
    io.to(room.code).emit('state_update', serializeRoom(room));
  });

  socket.on('start_match', ({ code }) => {
    const room = getRoomByCode(rooms, code);
    if (!room) { socket.emit('room_error', 'Room was not found.'); return; }
    const result = startMatch(room);
    if (!result.ok) { socket.emit('room_error', result.error); return; }
    room.finishedBroadcast = false;
    io.to(room.code).emit('state_update', serializeRoom(room));
  });

  socket.on('end_match', ({ code }) => {
    const room = getRoomByCode(rooms, code);
    if (!room) { socket.emit('room_error', 'Room was not found.'); return; }
    const result = endMatch(room, socket.id);
    if (!result.ok) { socket.emit('room_error', result.error); return; }
    io.to(room.code).emit('state_update', serializeRoom(room));
  });

  socket.on('shoot_ball', ({ code, angle, power } = {}) => {
    const room = getRoomByCode(rooms, code);
    if (!room) { socket.emit('room_error', 'Room not found.'); return; }
    const shotAngle = Number(angle ?? 0), shotPower = Number(power ?? .45);
    const result = applyShot(room, socket.id, { angle: shotAngle, power: shotPower });
    if (!result.ok) { socket.emit('state_error', result.error); io.to(room.code).emit('state_update', serializeRoom(room)); return; }
    const cue = room.match.balls.find(ball => ball.isCue);
    io.to(room.code).emit('shot_started', { code: room.code, shotId: room.match.shotCount, playerId: socket.id,
      angle: shotAngle, power: Math.min(1, Math.max(.08, shotPower)), cueX: cue.x, cueY: cue.y, impactDelay: SHOT_IMPACT_DELAY });
    io.to(room.code).emit('state_update', serializeRoom(room));
  });

  socket.on('disconnect', () => {
    for (const [code, room] of rooms.entries()) {
      const player = room.players.find(candidate => candidate.id === socket.id);
      if (!player) continue;
      player.connected = false;
      player.id = null;
      if (room.status === 'playing') {
        room.resumeStatus = 'playing';
        room.status = 'paused';
        const timer = room.match.timer;
        if (timer?.running) {
          timer.remainingMs = Math.max(0, timer.deadline - Date.now());
          timer.running = false;
          timer.deadline = null;
        }
        room.match.message = `${player.name} disconnected. Match paused; waiting to reconnect.`;
        room.match.lastEvent = 'Player disconnected; match paused safely.';
      }
      if (room.players.every(candidate => !candidate.connected)) rooms.delete(code);
      else io.to(code).emit('state_update', serializeRoom(room));
    }
  });
});

let physicsTick = 0;
setInterval(() => {
  for (const room of rooms.values()) {
    const previousTimeoutCount = room.match.timeoutCount || 0;
    updateRoomPhysics(room, 1 / 60);
    if ((room.match.timeoutCount || 0) > previousTimeoutCount) {
      io.to(room.code).emit('turn_timeout', { code: room.code, ...room.match.lastTimeout });
    }
    if (room.status === 'playing' && !room.match.shotInProgress) {
      const current = room.players[room.match.turnIndex];
      if (current?.computer) {
        room.match.computerTurnAt ??= Date.now() + 850;
        if (Date.now() >= room.match.computerTurnAt) {
          room.match.computerTurnAt = null;
          const shot = chooseComputerShot(room);
          const result = shot && applyShot(room, current.id, shot);
          if (result?.ok) {
            const cue = room.match.balls.find(ball => ball.isCue);
            io.to(room.code).emit('shot_started', { code: room.code, shotId: room.match.shotCount, playerId: current.id,
              angle: shot.angle, power: shot.power, cueX: cue.x, cueY: cue.y, impactDelay: SHOT_IMPACT_DELAY });
          } else {
            room.match.message = 'Computer could not find a legal shot.';
            room.match.lastEvent = 'Computer shot selection failed.';
            room.match.computerTurnAt = Date.now() + 1000;
          }
        }
      } else room.match.computerTurnAt = null;
    }
  }
  physicsTick += 1;
  if (physicsTick % 2 !== 0) return;
  for (const room of rooms.values()) {
    if (room.status === 'playing' || (room.status === 'finished' && !room.finishedBroadcast)) {
      io.to(room.code).emit('state_update', serializeRoom(room));
      if (room.status === 'finished') room.finishedBroadcast = true;
    }
  }
}, 1000 / 60);

const host = '0.0.0.0';
const port = Number(process.env.PORT || 3000);
server.listen(port, host, () => {
  console.log(`Pool server listening on http://${host}:${port}`);
  console.log('Local Wi-Fi multiplayer is ready.');
});
