import './style.css';
import { io } from 'socket.io-client';
import { CUE_STYLES, PoolRenderer } from './game.js';

const app = document.querySelector('#app');
const socket = io({ autoConnect: true, transports: ['websocket'] });
const state = {
  screen: 'menu', room: null, aim: null, myPlayerId: null, localName: '', dragging: false,
  pointerId: null, cuePlacement: null, shotRequestPending: false, playedShots: new Set(), pocketedIds: new Set(), lastRoomCode: null, lastShotCount: 0,
  timerSnapshotMs: 30_000, timerSnapshotAt: performance.now(), roomReceivedAt: performance.now(),
};
const BALL_COLORS = { 1:'#f5d32f', 2:'#1357b5', 3:'#d5222b', 4:'#67238c', 5:'#f28020', 6:'#198347', 7:'#852525', 8:'#101316', 9:'#f5d32f', 10:'#1357b5', 11:'#d5222b', 12:'#67238c', 13:'#f28020', 14:'#198347', 15:'#852525' };
const sounds = { cue: new Audio('/cue-strike.wav'), pocket: new Audio('/pocket-drop.wav') };
function playSound(kind, volume) {
  const audio = sounds[kind]?.cloneNode();
  if (!audio) return;
  audio.volume = volume;
  audio.play().catch(() => {});
}

function startLiveFavicon() {
  const link = document.querySelector('link[rel="icon"]');
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!link || !ctx) return;
  let phase = 0;
  const draw = () => {
    ctx.clearRect(0, 0, 64, 64);
    const felt = ctx.createLinearGradient(4, 4, 60, 60);
    felt.addColorStop(0, '#28563b'); felt.addColorStop(1, '#07130d');
    ctx.fillStyle = felt; ctx.beginPath(); ctx.roundRect(2, 2, 60, 60, 17); ctx.fill();
    ctx.strokeStyle = '#c9a365'; ctx.lineWidth = 2; ctx.stroke();
    const x = 32 + Math.sin(phase) * 1.2, y = 32;
    ctx.save(); ctx.translate(x, y);
    const ball = ctx.createRadialGradient(-8, -10, 2, 0, 0, 24);
    ball.addColorStop(0, '#555b58'); ball.addColorStop(.48, '#171b19'); ball.addColorStop(1, '#020403');
    ctx.fillStyle = ball; ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#dec38a'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.save(); ctx.rotate(phase * .7); ctx.beginPath(); ctx.ellipse(0, -17, 7, 2.2, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,248,222,.9)'; ctx.shadowColor = '#fff0be'; ctx.shadowBlur = 8; ctx.fill(); ctx.restore();
    ctx.fillStyle = '#f4f0e3'; ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111510'; ctx.font = 'bold 16px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('8', 0, 1);
    ctx.restore();
    link.type = 'image/png';
    link.href = canvas.toDataURL('image/png');
    phase += .16;
  };
  draw();
  window.setInterval(draw, 140);
}
startLiveFavicon();

app.innerHTML = `
  <div class="app-shell">
    <div id="menu-screen" class="screen active"><div class="title-wrap"><img class="brand-mark" src="/saitama-mark.svg" alt="" /><p class="eyebrow">Saitama Table Club</p><h1>Saitama <span>8 Ball Pool Game</span></h1><p class="subtitle">A sharper game under the lights. Rack up. Aim true.</p></div><div class="menu-grid"><button class="primary" data-action="computer">Play Computer</button><button class="secondary" data-action="challenges">Trick Shot Challenges</button><button class="secondary" data-action="host">Create Game</button><button class="secondary" data-action="join">Join Game</button><button class="secondary" data-action="settings">Settings</button><button class="secondary" data-action="howto">How to Play</button></div></div>
    <div id="host-screen" class="screen hidden"><div class="panel"><h2>Create a room</h2><label>Player name<input id="host-name" value="Player 1" maxlength="18" /></label><button id="host-btn" class="primary">Create Room</button><button class="ghost" data-action="back">Back</button></div></div>
    <div id="join-screen" class="screen hidden"><div class="panel"><h2>Join a room</h2><label>Player name<input id="join-name" value="Guest Player" maxlength="18" /></label><label>Room code<input id="room-code" placeholder="ABCD1" maxlength="10" /></label><button id="join-btn" class="primary">Join</button><button class="ghost" data-action="back">Back</button></div></div>
    <div id="lobby-screen" class="screen hidden"><div class="panel lobby-box"><p class="eyebrow">Game room</p><h2 id="room-code-label">Room</h2><div class="room-meta"><p>Share the room code with a player on the same Wi-Fi network.</p><p>Play head-to-head in real time.</p></div><div id="players-list" class="players-list"></div><div class="lobby-actions"><button id="start-match-btn" class="primary">Start Match</button><button class="ghost" data-action="back">Back</button></div></div></div>
    <div id="challenges-screen" class="screen hidden"><div class="panel challenge-picker"><p class="eyebrow">Solo mode</p><h2>Trick Shot Challenges</h2><p class="room-meta">Pocket the marked ball in its target pocket. You get three shots.</p><div id="challenge-list" class="challenge-list"><p>Loading challenges…</p></div><button class="ghost" data-action="back">Back</button></div></div>
    <div id="game-screen" class="screen hidden">
      <div class="hud header-row"><div><p class="eyebrow">Room</p><h3 id="hud-code">—</h3></div><div><p class="eyebrow">At the table</p><h3 id="turn-label">—</h3></div><div><p class="eyebrow">Match status</p><h3 id="status-label">Waiting</h3></div><div class="timer-wrap"><div id="timer-ring" class="timer-ring" role="timer" aria-label="30 seconds remaining"><span id="timer-digits">30</span></div><div class="timer-meta"><p class="eyebrow">Shot clock</p><h3 id="timer-player">Waiting</h3></div></div><button id="end-game-btn" class="danger">End Game</button></div>
      <div id="challenge-hud" class="challenge-hud" hidden><div><p class="eyebrow">Trick shot</p><h3 id="challenge-title"></h3></div><p id="challenge-description"></p><strong id="challenge-progress"></strong></div>
      <div class="players-hud"><div id="player-card-0" class="player-card"><span id="player-0-name">Player 1</span><b id="player-0-group">OPEN TABLE</b><div id="player-0-balls" class="remaining-balls">Groups not assigned</div></div><div id="connection-label" class="connection"><i></i> Connecting</div><div id="player-card-1" class="player-card"><span id="player-1-name">Player 2</span><b id="player-1-group">OPEN TABLE</b><div id="player-1-balls" class="remaining-balls">Groups not assigned</div></div></div>
      <div class="table-wrap"><canvas id="game-canvas" width="980" height="560" aria-label="Pool table. Drag to aim; dragging does not shoot." ></canvas></div>
      <div class="controls-panel"><div class="power-control"><label for="power-slider"><span>Shot power</span><strong id="power-readout">42%</strong></label><input id="power-slider" type="range" min="8" max="100" value="42" aria-label="Shot power, applied to the cue pull-back" /><div class="power-track"><i id="power-meter"></i></div><div class="power-scale"><span>SOFT</span><span>FIRM</span></div></div><div class="shot-actions"><button id="cancel-shot-btn" class="ghost">Cancel charge</button><button id="shoot-btn" class="primary">Shoot</button></div></div>
      <p id="control-hint" class="control-hint">Drag on the table to aim. Set power separately; release never shoots. Tap Shoot to strike.</p>
    </div>
    <div id="settings-screen" class="screen hidden"><div class="panel settings-panel"><h2>Settings</h2><label>Graphics<select id="graphics-mode"><option value="balanced">Balanced</option><option value="performance">Performance</option></select></label><label>Cue style<select id="cue-style">${Object.entries(CUE_STYLES).map(([id, style]) => `<option value="${id}">${style.label}</option>`).join('')}</select></label><div id="cue-preview" class="cue-preview" aria-hidden="true"><span class="cue-preview-stick"></span><strong id="cue-style-label"></strong></div><button class="primary" data-action="back">Back</button></div></div>
    <div id="howto-screen" class="screen hidden"><div class="panel"><h2>How to play</h2><ul><li>Create a room on the same Wi-Fi; the second phone joins with its code.</li><li>Drag on the table to set shot direction. Pointer release only ends aiming; it never fires.</li><li>Use the separate power slider to pull the cue back and choose the real shot strength.</li><li>Tap Shoot to request a single server-validated strike. Cancel charge returns to a soft setup.</li><li>The game server simulates the shot and synchronizes its impact and result.</li></ul><button class="primary" data-action="back">Back</button></div></div>
  </div>
  <dialog id="app-dialog" class="app-dialog" aria-labelledby="dialog-title" aria-describedby="dialog-message">
    <div class="dialog-panel"><div class="dialog-ball" aria-hidden="true">8</div><p class="eyebrow">Saitama 8 Ball Pool</p><h2 id="dialog-title">Message</h2><p id="dialog-message"></p><div class="dialog-actions"><button id="dialog-cancel" class="ghost">Cancel</button><button id="dialog-confirm" class="primary">OK</button></div></div>
  </dialog>`;

const canvas = document.getElementById('game-canvas');
const renderer = new PoolRenderer(canvas);
const cueStyleSelect = document.getElementById('cue-style');
const cuePreview = document.getElementById('cue-preview');
const cueStyleLabel = document.getElementById('cue-style-label');
const powerSlider = document.getElementById('power-slider');
const shootButton = document.getElementById('shoot-btn');
const cancelButton = document.getElementById('cancel-shot-btn');
const endGameButton = document.getElementById('end-game-btn');
const challengeList = document.getElementById('challenge-list');
const appDialog = document.getElementById('app-dialog');
const dialogTitle = document.getElementById('dialog-title');
const dialogMessage = document.getElementById('dialog-message');
const dialogCancel = document.getElementById('dialog-cancel');
const dialogConfirm = document.getElementById('dialog-confirm');
const screens = Object.fromEntries(['menu','host','join','lobby','challenges','game','settings','howto'].map(n => [n, document.getElementById(`${n}-screen`)]));
function updateCueStyle(styleName, persist = false) {
  renderer.setCueStyle(styleName);
  const style = CUE_STYLES[renderer.cueStyle];
  cueStyleSelect.value = renderer.cueStyle;
  cuePreview.style.setProperty('--cue-butt', style.butt[1]);
  cuePreview.style.setProperty('--cue-shaft', style.shaft[1]);
  cuePreview.style.setProperty('--cue-accent', style.accent);
  cuePreview.style.setProperty('--cue-tip', style.tip);
  cueStyleLabel.textContent = style.label;
  if (persist) localStorage.setItem('pool-cue-style', renderer.cueStyle);
  render();
}
updateCueStyle(localStorage.getItem('pool-cue-style') || 'maple');
cueStyleSelect.addEventListener('change', event => updateCueStyle(event.target.value, true));
let animationFrame = null;
function animateGame() {
  animationFrame = null;
  if (state.screen !== 'game') return;
  if (state.room?.status === 'playing') render();
  animationFrame = requestAnimationFrame(animateGame);
}
function scheduleGameAnimation() {
  if (animationFrame === null && state.screen === 'game') animationFrame = requestAnimationFrame(animateGame);
}
let dialogResolve = null;
function closeAppDialog(result) {
  if (appDialog.open) appDialog.close();
  const resolve = dialogResolve;
  dialogResolve = null;
  resolve?.(result);
}
function showAppDialog({ title, message, confirmation = false }) {
  if (appDialog.open) closeAppDialog(false);
  dialogTitle.textContent = title;
  dialogMessage.textContent = message;
  appDialog.classList.toggle('confirmation', confirmation);
  dialogCancel.hidden = !confirmation;
  dialogConfirm.textContent = confirmation ? 'End Game' : 'Got it';
  const result = new Promise(resolve => { dialogResolve = resolve; });
  appDialog.showModal();
  dialogConfirm.focus();
  return result;
}
function showScreen(name) {
  if (state.screen === name) return;
  Object.entries(screens).forEach(([key, el]) => { el.classList.toggle('active', key === name); el.classList.toggle('hidden', key !== name); });
  state.screen = name;
  if (name === 'game') requestAnimationFrame(() => { renderer.resize(); scheduleGameAnimation(); });
}
function openChallenges() {
  showScreen('challenges');
  challengeList.innerHTML = '<p>Loading challenges…</p>';
  socket.emit('get_challenges');
}
function renderChallenges(challenges) {
  challengeList.innerHTML = challenges.map((challenge, index) => `<button class="challenge-card" data-challenge-id="${escapeHtml(challenge.id)}"><span class="challenge-index">0${index + 1}</span><span class="challenge-copy"><strong>${escapeHtml(challenge.title)}</strong><small>${escapeHtml(challenge.description)}</small></span><span class="challenge-attempts">${challenge.shots} shots</span></button>`).join('');
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function activePlayer(room = state.room) { return room?.players?.[room.match.turnIndex] || null; }
function canControl(room = state.room) {
  return !!room && room.status === 'playing' && activePlayer(room)?.id === socket.id && !room.match.shotInProgress && !state.shotRequestPending && (!room.match.ballInHand || room.match.cueBallPlaced);
}
function canPlaceCueBall(room = state.room) {
  return !!room && room.status === 'playing' && room.match.ballInHand && !room.match.cueBallPlaced && !room.match.shotInProgress && activePlayer(room)?.id === socket.id && !state.shotRequestPending;
}
function render() {
  if (!state.room) return;
  const localTurn = activePlayer()?.id === socket.id;
  const canAim = localTurn && state.room.status === 'playing' && !state.room.match.shotInProgress && !state.shotRequestPending;
  const elapsed = state.room.status === 'playing' ? Math.min((performance.now() - state.roomReceivedAt) / 1000, 1 / 30) : 0;
  const displayRoom = elapsed > 0 ? {
    ...state.room,
    match: { ...state.room.match, balls: state.room.match.balls.map(ball => ball.pocketed ? ball : { ...ball, x: ball.x + ball.vx * elapsed, y: ball.y + ball.vy * elapsed, rotation: (ball.rotation || 0) + (ball.spin || 0) * elapsed }) },
  } : state.room;
  renderer.draw(displayRoom, canAim ? state.aim : null, canPlaceCueBall() ? state.cuePlacement : null);
}
function updateControls() {
  const enabled = canControl();
  const placingCue = canPlaceCueBall();
  const invalidAim = enabled && state.aim && !renderer.canShoot(state.room, state.aim.angle);
  powerSlider.disabled = !enabled;
  shootButton.disabled = !enabled || !state.aim || invalidAim;
  cancelButton.disabled = !enabled || !state.aim || state.aim.power <= .08001;
  endGameButton.disabled = !state.room || !['playing', 'paused', 'finished'].includes(state.room.status);
  endGameButton.textContent = state.room?.mode === 'challenge' && state.room.status === 'finished' ? 'Challenge List' : state.room?.status === 'finished' ? 'Back to Lobby' : 'End Game';
  const power = state.aim?.power ?? .42;
  document.getElementById('power-readout').textContent = `${Math.round(power * 100)}%`;
  document.getElementById('power-meter').style.width = `${power * 100}%`;
  if (Number(powerSlider.value) !== Math.round(power * 100)) powerSlider.value = String(Math.round(power * 100));
  document.getElementById('control-hint').classList.toggle('invalid', !!invalidAim);
  document.getElementById('control-hint').textContent = placingCue
    ? 'Foul penalty: drag the cue ball to an open spot, then take your shot.'
    : enabled
      ? invalidAim ? 'Wrong ball. Aim for your group.' : state.room.mode === 'challenge' ? `Pocket ball #${state.room.challenge.targetNumber} in the marked pocket. ${state.room.challenge.shotsRemaining} shots left.` : 'Drag on the table to aim. Set power separately; release never shoots. Tap Shoot to strike.'
    : state.room?.status === 'paused' ? 'Match paused while a player reconnects.'
      : state.room?.match?.shotInProgress || state.shotRequestPending ? 'Shot accepted — waiting for the balls to settle.'
        : state.room?.players?.[state.room.match.turnIndex]?.computer ? 'Computer is lining up a shot.' : 'Opponent’s turn — aiming and shot controls are inactive.';
}
function updateLobby() {
  if (!state.room) return;
  state.myPlayerId = socket.id || state.myPlayerId;
  document.getElementById('room-code-label').textContent = `Room ${state.room.code}`;
  document.getElementById('players-list').innerHTML = state.room.players.map(p => `<div class="player-row ${p.host ? 'host' : ''}"><span>${escapeHtml(p.name)}</span><span>${p.computer ? 'Computer' : p.host ? 'Creator' : 'Guest'}</span></div>`).join('');
  document.getElementById('start-match-btn').disabled = state.room.players.length < 2;
}
function updateHud() {
  if (!state.room) return;
  const { match, players } = state.room;
  const challengeHud = document.getElementById('challenge-hud');
  challengeHud.hidden = state.room.mode !== 'challenge';
  document.getElementById('game-screen').classList.toggle('challenge-mode', state.room.mode === 'challenge');
  document.getElementById('game-screen').classList.toggle('foul-state', state.room.match.foul && state.room.match.ballInHand);
  if (state.room.challenge) {
    const challenge = state.room.challenge;
    document.getElementById('challenge-title').textContent = challenge.title;
    document.getElementById('challenge-description').textContent = challenge.description;
    document.getElementById('challenge-progress').textContent = challenge.completed ? `${challenge.stars} / 3 stars` : `${challenge.shotsRemaining} shots left`;
  }
  document.getElementById('hud-code').textContent = state.room.code;
  const current = activePlayer();
  document.getElementById('turn-label').textContent = current ? `${current.name}${current.id === socket.id ? ' · Your turn' : current.computer ? ' · Thinking' : ''}` : 'Waiting';
  document.getElementById('status-label').textContent = state.room.status === 'paused' ? 'Paused' : (match.message || 'Ready');
  document.getElementById('connection-label').innerHTML = state.room.mode === 'challenge' ? '<i></i> Solo challenge' : players.some(p => p.computer) ? '<i></i> Computer ready' : players.length < 2 ? '<i class="offline"></i> Waiting for opponent' : players.every(p => p.connected) ? '<i></i> Both connected' : '<i class="offline"></i> Reconnecting';
  for (let i = 0; i < 2; i += 1) {
    const p = players[i]; const card = document.getElementById(`player-card-${i}`);
    card.classList.toggle('current', !!p && i === match.turnIndex);
    document.getElementById(`player-${i}-name`).textContent = p?.name || `Player ${i + 1}`;
    document.getElementById(`player-${i}-group`).textContent = p?.group ? p.group.toUpperCase() : 'OPEN TABLE';
    const remainingElement = document.getElementById(`player-${i}-balls`);
    const remaining = p?.group ? match.balls.filter(b => !b.pocketed && b.type === p.group) : [];
    if (!p?.group) remainingElement.textContent = 'Groups not assigned';
    else if (!remaining.length) remainingElement.textContent = '8-ball next';
    else remainingElement.innerHTML = remaining.map(ball => `<span class="ball-token ${ball.type}" style="--ball-color:${BALL_COLORS[ball.number]}" title="Ball ${ball.number}" aria-label="Ball ${ball.number}"><span class="ball-number">${ball.number}</span></span>`).join('');
    remainingElement.setAttribute('aria-label', p?.group ? `${p.name}'s remaining balls${remaining.length ? `: ${remaining.map(ball => ball.number).join(', ')}` : ': 8-ball next'}` : 'Groups not assigned');
  }
  updateTimerHud();
}
function updateTimerHud() {
  const match = state.room?.match;
  const timer = match?.timer;
  const duration = timer?.durationMs || 30_000;
  const remaining = timer?.running && state.room?.status === 'playing'
    ? Math.max(0, state.timerSnapshotMs - (performance.now() - state.timerSnapshotAt))
    : Math.max(0, timer?.remainingMs ?? duration);
  const seconds = Math.ceil(remaining / 1000);
  const ring = document.getElementById('timer-ring');
  document.getElementById('timer-digits').textContent = String(seconds).padStart(2, '0');
  const current = activePlayer();
  document.getElementById('timer-player').textContent = current ? `${current.name}${current.id === socket.id ? ' · You' : ''}` : 'Waiting';
  ring.style.setProperty('--timer-progress', `${Math.max(0, Math.min(1, remaining / duration)) * 100}%`);
  ring.classList.toggle('warning', seconds < 10 && seconds >= 5);
  ring.classList.toggle('danger', seconds < 5);
  ring.classList.toggle('stopped', !timer?.running || state.room?.status !== 'playing');
  ring.setAttribute('aria-label', `${seconds} seconds remaining${current ? `, ${current.name}'s turn` : ''}`);
}
function detectNewPockets(room) {
  const shotCount = room.match.shotCount || 0;
  if (state.lastRoomCode !== room.code || shotCount < state.lastShotCount) {
    state.pocketedIds = new Set(room.match.balls.filter(b => b.pocketed).map(b => b.id));
  } else {
    for (const ball of room.match.balls) {
      if (ball.pocketed && !state.pocketedIds.has(ball.id)) {
        playSound('pocket', .22);
        renderer.addPocket(ball.pocketX ?? ball.x, ball.pocketY ?? ball.y);
      }
      if (ball.pocketed) state.pocketedIds.add(ball.id);
    }
  }
  state.lastRoomCode = room.code;
  state.lastShotCount = shotCount;
}
function detectImpacts(previousRoom, room) {
  if (!previousRoom || previousRoom.code !== room.code || !room.match.shotInProgress) return;
  const previousBalls = new Map(previousRoom.match.balls.map(ball => [ball.id, ball]));
  for (const ball of room.match.balls) {
    const previous = previousBalls.get(ball.id);
    if (!previous || previous.isCue || previous.pocketed || ball.pocketed) continue;
    const change = Math.hypot(ball.vx - previous.vx, ball.vy - previous.vy);
    if (change > 42) renderer.addImpact(ball.x, ball.y, Math.min(1, change / 300));
  }
}
function getPointerWorld(event) {
  const rect = canvas.getBoundingClientRect(); const L = renderer.layout();
  return { x: (event.clientX - rect.left - L.ox) / L.scale, y: (event.clientY - rect.top - L.oy) / L.scale };
}
function setAim(event) {
  if (!canControl()) return;
  const cue = state.room.match.balls.find(b => b.isCue && !b.pocketed);
  if (!cue) return;
  const pointer = getPointerWorld(event), dx = cue.x - pointer.x, dy = cue.y - pointer.y;
  if (Math.hypot(dx, dy) < 3) return;
  const power = state.aim?.power ?? .42;
  state.aim = { angle: Math.atan2(dy, dx), power };
  render(); updateControls();
}
function setCuePlacement(event) {
  if (!canPlaceCueBall()) return;
  state.cuePlacement = getPointerWorld(event);
  render();
}
function setPower(value) {
  if (!canControl()) return;
  const power = Math.max(.08, Math.min(1, Number(value) / 100));
  state.aim ||= { angle: 0, power };
  state.aim.power = power;
  render(); updateControls();
}
function shoot() {
  if (!canControl() || !state.aim || !renderer.canShoot(state.room, state.aim.angle)) return;
  state.shotRequestPending = true;
  updateControls();
  socket.emit('shoot_ball', { code: state.room.code, angle: state.aim.angle, power: state.aim.power });
}
function cancelCharge() {
  if (!canControl() || !state.aim) return;
  state.aim.power = .08;
  powerSlider.value = '8';
  render(); updateControls();
}
function endGame() {
  if (!state.room) return;
  if (state.room.mode === 'challenge') {
    if (state.room.status === 'finished') { exitChallenge(); return; }
    showAppDialog({ title: 'Leave challenge?', message: 'Your remaining shots will be lost.', confirmation: true }).then(confirmed => { if (confirmed) exitChallenge(); });
    return;
  }
  const code = state.room.code;
  const confirmEnd = state.room.status === 'finished'
    ? Promise.resolve(true)
    : showAppDialog({ title: 'End this game?', message: 'Both players will return to the room.', confirmation: true });
  confirmEnd.then(confirmed => { if (confirmed) socket.emit('end_match', { code }); });
}
function leaveRoom() {
  if (state.room) socket.emit('leave_room', { code: state.room.code });
  localStorage.removeItem('pool-session');
  state.room = null; state.aim = null; state.shotRequestPending = false;
  showScreen('menu');
}
function exitChallenge() {
  if (state.room) socket.emit('leave_room', { code: state.room.code });
  localStorage.removeItem('pool-session');
  state.room = null; state.aim = null; state.shotRequestPending = false;
  showScreen('challenges');
}

function showChallengeResult(room) {
  if (room.mode !== 'challenge' || room.status !== 'finished') return;
  const challenge = room.challenge;
  const cleared = challenge.stars > 0;
  showAppDialog({
    title: cleared ? 'Challenge cleared!' : 'Challenge over',
    message: `${challenge.title}: ${cleared ? `${challenge.stars} ${challenge.stars === 1 ? 'star' : 'stars'}` : 'no stars this time'}.`,
  }).then(() => {
    if (state.room?.code === room.code && state.room.status === 'finished') exitChallenge();
  });
}

canvas.addEventListener('pointerdown', event => {
  if (!canControl() && !canPlaceCueBall()) return;
  state.dragging = true; state.pointerId = event.pointerId;
  try { canvas.setPointerCapture(event.pointerId); } catch { /* release/cancel still ends the gesture */ }
  if (canPlaceCueBall()) setCuePlacement(event);
  else setAim(event);
});
canvas.addEventListener('pointermove', event => {
  if (!state.dragging || event.pointerId !== state.pointerId) return;
  if (canPlaceCueBall()) setCuePlacement(event);
  else setAim(event);
});
canvas.addEventListener('pointerup', event => {
  if (event.pointerId !== state.pointerId) return;
  state.dragging = false; state.pointerId = null;
  if (canPlaceCueBall() && state.cuePlacement) {
    socket.emit('place_cue_ball', { code: state.room.code, ...state.cuePlacement });
    state.cuePlacement = null;
    render();
  }
  // Aiming gestures never fire; shot initiation is the explicit Shoot button only.
});
canvas.addEventListener('pointercancel', () => { state.dragging = false; state.pointerId = null; state.cuePlacement = null; render(); });
canvas.addEventListener('lostpointercapture', () => { state.dragging = false; state.pointerId = null; });
canvas.addEventListener('contextmenu', event => event.preventDefault());
powerSlider.addEventListener('input', event => setPower(event.target.value));
shootButton.addEventListener('click', shoot);
cancelButton.addEventListener('click', cancelCharge);
endGameButton.addEventListener('click', endGame);
dialogConfirm.addEventListener('click', () => closeAppDialog(true));
dialogCancel.addEventListener('click', () => closeAppDialog(false));
appDialog.addEventListener('cancel', event => { event.preventDefault(); closeAppDialog(false); });
appDialog.addEventListener('click', event => { if (event.target === appDialog) closeAppDialog(false); });

for (const [action, screen] of [['host','host'],['join','join'],['settings','settings'],['howto','howto']]) document.querySelectorAll(`[data-action="${action}"]`).forEach(b => b.addEventListener('click', () => showScreen(screen)));
document.querySelector('[data-action="computer"]').addEventListener('click', () => {
  state.localName = document.getElementById('host-name').value.trim() || 'Player 1';
  socket.emit('start_computer_game', { playerName: state.localName });
});
document.querySelector('[data-action="challenges"]').addEventListener('click', openChallenges);
challengeList.addEventListener('click', event => {
  const button = event.target.closest('[data-challenge-id]');
  if (button) socket.emit('start_challenge', { challengeId: button.dataset.challengeId });
});
document.querySelectorAll('[data-action="back"]').forEach(b => b.addEventListener('click', () => {
  if (b.closest('#lobby-screen')) leaveRoom();
  else showScreen(state.room ? 'lobby' : 'menu');
}));
document.getElementById('host-btn').addEventListener('click', () => { state.localName = document.getElementById('host-name').value.trim() || 'Player 1'; socket.emit('host_room', { playerName: state.localName }); });
document.getElementById('join-btn').addEventListener('click', () => { state.localName = document.getElementById('join-name').value.trim() || 'Guest Player'; socket.emit('join_room', { code: document.getElementById('room-code').value.trim().toUpperCase(), playerName: state.localName }); });
document.getElementById('start-match-btn').addEventListener('click', () => { if (state.room) socket.emit('start_match', { code: state.room.code }); });

socket.on('connect', () => { state.myPlayerId = socket.id; updateLobby(); });
socket.on('challenge_list', renderChallenges);
socket.on('connect', () => {
  try {
    const session = JSON.parse(localStorage.getItem('pool-session') || 'null');
    if (session?.code && session?.token) socket.emit('resume_room', session);
  } catch { localStorage.removeItem('pool-session'); }
});
socket.on('room_joined', ({ room, sessionToken }) => {
  state.myPlayerId = socket.id; state.room = room; state.aim = null; state.shotRequestPending = false;
  state.roomReceivedAt = performance.now();
  state.timerSnapshotMs = room.match.timer?.remainingMs ?? 30_000; state.timerSnapshotAt = performance.now();
  if (sessionToken) localStorage.setItem('pool-session', JSON.stringify({ code: room.code, token: sessionToken }));
  state.lastRoomCode = room.code; state.lastShotCount = room.match.shotCount || 0;
  state.pocketedIds = new Set(room.match.balls.filter(b => b.pocketed).map(b => b.id));
  if (room.status === 'playing' || (room.mode === 'challenge' && room.status === 'finished')) {
    showScreen('game'); updateHud(); updateControls(); render();
    showChallengeResult(room);
  }
  else { showScreen('lobby'); updateLobby(); }
});
socket.on('session_token', ({ code, token }) => localStorage.setItem('pool-session', JSON.stringify({ code, token })));
socket.on('resume_error', () => localStorage.removeItem('pool-session'));
socket.on('shot_started', shot => {
  if (!state.room || shot.code !== state.room.code) return;
  const key = `${shot.code}:${shot.shotId}`;
  if (state.playedShots.has(key)) return;
  state.playedShots.add(key); state.aim = null; state.shotRequestPending = true;
  renderer.playCueStrike(shot); playSound('cue', .42); render(); updateControls();
});
socket.on('state_update', room => {
  const challengeJustFinished = room.mode === 'challenge' && room.status === 'finished' && state.room?.status !== 'finished';
  detectImpacts(state.room, room);
  detectNewPockets(room); state.room = room;
  state.roomReceivedAt = performance.now();
  state.timerSnapshotMs = room.match.timer?.remainingMs ?? 30_000; state.timerSnapshotAt = performance.now();
  const localTurn = activePlayer(room)?.id === socket.id;
  if (room.match.ballInHand && !room.match.cueBallPlaced) {
    state.aim = null;
    state.cuePlacement = null;
  }
  if (room.match.shotInProgress) { state.aim = null; state.shotRequestPending = true; }
  else {
    state.shotRequestPending = false;
    if (room.status === 'playing' && localTurn && (!room.match.ballInHand || room.match.cueBallPlaced) && !state.aim) state.aim = { angle: 0, power: .42 };
    if (!localTurn || room.status !== 'playing') state.aim = null;
  }
  updateLobby(); updateHud(); updateControls();
  if (room.status === 'playing' || room.status === 'finished') showScreen('game');
  else if (room.status === 'waiting') showScreen('lobby');
  render();
  if (challengeJustFinished) showChallengeResult(room);
});
socket.on('room_error', message => showAppDialog({ title: 'Room update', message }));
socket.on('state_error', message => { state.shotRequestPending = false; updateControls(); showAppDialog({ title: 'Shot unavailable', message }); });
window.addEventListener('resize', () => { renderer.resize(); render(); });
window.addEventListener('orientationchange', () => requestAnimationFrame(() => { renderer.resize(); render(); }));
window.setInterval(updateTimerHud, 100);
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
showScreen('menu');
