const WORLD_W = 980;
const WORLD_H = 560;

export class PoolRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cueStrike = null;
    this.resize();
  }

  playCueStrike(shot) {
    if (this.cueStrike?.shotId === shot.shotId) return;
    this.cueStrike = { ...shot, startedAt: performance.now() };
  }

  resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = this.canvas.clientWidth || 980;
    const height = this.canvas.clientHeight || 560;
    this.canvas.width = Math.floor(width * ratio);
    this.canvas.height = Math.floor(height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  layout() {
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width || 980;
    const height = rect.height || 560;
    const scale = Math.min((width - 12) / WORLD_W, (height - 12) / WORLD_H);
    const tableWidth = WORLD_W * scale;
    const tableHeight = WORLD_H * scale;
    return { width, height, scale, ox: (width - tableWidth) / 2, oy: (height - tableHeight) / 2 };
  }

  toScreen(x, y, layout) { return [layout.ox + x * layout.scale, layout.oy + y * layout.scale]; }

  draw(room, aim = null) {
    if (!room) return;
    const ctx = this.ctx;
    const L = this.layout();
    ctx.clearRect(0, 0, L.width, L.height);
    const bg = ctx.createRadialGradient(L.width / 2, L.height / 2, 20, L.width / 2, L.height / 2, Math.max(L.width, L.height) * .7);
    bg.addColorStop(0, '#173b2b'); bg.addColorStop(1, '#06120e');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, L.width, L.height);
    ctx.save(); ctx.translate(L.ox, L.oy); ctx.scale(L.scale, L.scale);
    this.drawTable(ctx);
    const balls = room.match?.balls || [];
    if (aim && room.match?.status === 'playing' && !room.match?.shotInProgress) {
      const cue = balls.find(b => b.isCue && !b.pocketed);
      if (cue) this.drawPrediction(ctx, cue, balls, aim.angle);
    }
    for (const ball of balls) if (!ball.pocketed || (ball.dropProgress > 0 && ball.dropProgress < 1)) this.drawBall(ctx, ball);
    if (aim && room.match?.status === 'playing' && !room.match?.shotInProgress) {
      const cue = balls.find(b => b.isCue && !b.pocketed);
      if (cue) this.drawCue(ctx, cue, aim.angle, aim.power || 0);
    } else if (this.cueStrike) {
      const progress = (performance.now() - this.cueStrike.startedAt) / 240;
      if (progress < 1) {
        const alpha = progress > .88 ? Math.max(0, (1 - progress) / .12) : 1;
        ctx.save(); ctx.globalAlpha = alpha;
        this.drawCue(ctx, { x: this.cueStrike.cueX, y: this.cueStrike.cueY, radius: 14 }, this.cueStrike.angle, this.cueStrike.power, progress);
        ctx.restore();
      } else this.cueStrike = null;
    }
    ctx.restore();
  }

  drawTable(ctx) {
    const x = 24, y = 22, w = 932, h = 516;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.75)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 13;
    const wood = ctx.createLinearGradient(x, y, x + w, y + h);
    wood.addColorStop(0, '#9b6637'); wood.addColorStop(.22, '#56331d'); wood.addColorStop(.5, '#24170f'); wood.addColorStop(.8, '#714522'); wood.addColorStop(1, '#301d12');
    ctx.fillStyle = wood; this.roundRect(ctx, x, y, w, h, 30); ctx.fill(); ctx.restore();
    ctx.strokeStyle = 'rgba(237,190,124,.48)'; ctx.lineWidth = 2; this.roundRect(ctx, x + 7, y + 7, w - 14, h - 14, 25); ctx.stroke();
    const rail = ctx.createLinearGradient(0, y + 18, 0, y + 83);
    rail.addColorStop(0, '#79502e'); rail.addColorStop(.45, '#bc8650'); rail.addColorStop(1, '#593820');
    ctx.fillStyle = rail; this.roundRect(ctx, 46, 39, 888, 482, 20); ctx.fill();
    const cloth = ctx.createLinearGradient(100, 90, 850, 475);
    cloth.addColorStop(0, '#14764d'); cloth.addColorStop(.48, '#0d6340'); cloth.addColorStop(1, '#08472f');
    ctx.fillStyle = cloth; this.roundRect(ctx, 78, 67, 824, 426, 15); ctx.fill();
    // Very subtle woven cloth, clipped to the playing field.
    ctx.save(); this.roundRect(ctx, 78, 67, 824, 426, 15); ctx.clip();
    for (let yy = 70; yy < 495; yy += 5) {
      ctx.strokeStyle = yy % 10 ? 'rgba(214,255,226,.025)' : 'rgba(0,18,9,.035)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(78, yy); ctx.lineTo(902, yy); ctx.stroke();
    }
    for (let xx = 80; xx < 902; xx += 7) {
      ctx.strokeStyle = 'rgba(220,255,225,.018)'; ctx.beginPath(); ctx.moveTo(xx, 68); ctx.lineTo(xx, 493); ctx.stroke();
    }
    const light = ctx.createRadialGradient(470, 260, 50, 490, 280, 510);
    light.addColorStop(0, 'rgba(255,255,220,.055)'); light.addColorStop(1, 'rgba(0,0,0,.13)'); ctx.fillStyle = light; ctx.fillRect(78, 67, 824, 426); ctx.restore();
    // Cushion noses and inlaid diamond sights.
    ctx.strokeStyle = '#12432e'; ctx.lineWidth = 10; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(111, 87); ctx.lineTo(443, 87); ctx.moveTo(537, 87); ctx.lineTo(869, 87);
    ctx.moveTo(111, 473); ctx.lineTo(443, 473); ctx.moveTo(537, 473); ctx.lineTo(869, 473);
    ctx.moveTo(98, 111); ctx.lineTo(98, 222); ctx.moveTo(98, 338); ctx.lineTo(98, 449);
    ctx.moveTo(882, 111); ctx.lineTo(882, 222); ctx.moveTo(882, 338); ctx.lineTo(882, 449); ctx.stroke();
    const pockets = this.pocketPoints();
    for (const [px, py, r] of pockets) {
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 8;
      const rim = ctx.createRadialGradient(px - 2, py - 3, r * .3, px, py, r);
      rim.addColorStop(0, '#050907'); rim.addColorStop(.7, '#080b09'); rim.addColorStop(.82, '#a37a4a'); rim.addColorStop(1, '#412a18');
      ctx.fillStyle = rim; ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      ctx.fillStyle = '#020403'; ctx.beginPath(); ctx.ellipse(px, py + 3, r * .7, r * .62, 0, 0, Math.PI * 2); ctx.fill();
    }
    const diamonds = [180, 285, 390, 590, 695, 800];
    for (const dx of diamonds) for (const dy of [51, 509]) { ctx.fillStyle = 'rgba(238,216,176,.78)'; ctx.beginPath(); ctx.arc(dx, dy, 3.2, 0, Math.PI * 2); ctx.fill(); }
    for (const dy of [155, 260, 365]) for (const dx of [61, 919]) { ctx.fillStyle = 'rgba(238,216,176,.78)'; ctx.beginPath(); ctx.arc(dx, dy, 3.2, 0, Math.PI * 2); ctx.fill(); }
  }

  pocketPoints() { return [[82, 72, 21], [490, 68, 18], [898, 72, 21], [82, 488, 21], [490, 492, 18], [898, 488, 21]]; }
  roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

  drawPrediction(ctx, cue, balls, angle) {
    const ux = Math.cos(angle), uy = Math.sin(angle), r = cue.radius;
    let best = 520, hit = null;
    for (const b of balls) {
      if (b.isCue || b.pocketed) continue;
      const dx = b.x - cue.x, dy = b.y - cue.y, along = dx * ux + dy * uy;
      if (along <= 0) continue;
      const perp = Math.abs(dx * uy - dy * ux);
      if (perp < r + b.radius && along < best) { best = along - Math.sqrt(Math.max(0, (r + b.radius) ** 2 - perp ** 2)); hit = b; }
    }
    const ex = cue.x + ux * best, ey = cue.y + uy * best;
    ctx.save(); ctx.setLineDash([8, 7]); ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(245,255,242,.57)';
    ctx.beginPath(); ctx.moveTo(cue.x, cue.y); ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]);
    if (hit) {
      const nx = (hit.x - ex), ny = (hit.y - ey), n = Math.hypot(nx, ny) || 1;
      const hx = nx / n, hy = ny / n;
      ctx.strokeStyle = 'rgba(255,232,166,.34)'; ctx.setLineDash([5, 8]); ctx.beginPath(); ctx.moveTo(hit.x, hit.y); ctx.lineTo(hit.x + hx * 100, hit.y + hy * 100); ctx.stroke();
      ctx.setLineDash([]); ctx.beginPath(); ctx.arc(ex, ey, 4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.72)'; ctx.fill();
    }
    ctx.restore();
  }

  drawCue(ctx, ball, angle, power, strikeProgress = null) {
    const [x, y] = [ball.x, ball.y];
    const pull = 12 + Math.max(0, Math.min(1, power)) * 47;
    const restingGap = ball.radius + 5 + pull;
    let start = restingGap;
    if (strikeProgress !== null) {
      const ease = t => 1 - (1 - Math.max(0, Math.min(1, t))) ** 3;
      if (strikeProgress <= .5) start = restingGap - (restingGap - ball.radius - 1) * ease(strikeProgress / .5);
      else start = ball.radius + 1 + (restingGap - ball.radius - 1) * .58 * ease((strikeProgress - .5) / .38);
    }
    const length = 225;
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const tip = -start, shaftBack = tip - 145, buttBack = tip - length;
    ctx.save(); ctx.translate(2, 4); ctx.fillStyle = 'rgba(0,0,0,.38)';
    ctx.beginPath(); ctx.moveTo(tip, -2.5); ctx.lineTo(tip - 10, -3.3); ctx.lineTo(shaftBack, -4.4); ctx.lineTo(shaftBack - 7, -6.5); ctx.lineTo(buttBack, -8.1); ctx.lineTo(buttBack, 8.1); ctx.lineTo(shaftBack - 7, 6.5); ctx.lineTo(shaftBack, 4.4); ctx.lineTo(tip - 10, 3.3); ctx.lineTo(tip, 2.5); ctx.closePath(); ctx.fill(); ctx.restore();
    const lacquer = ctx.createLinearGradient(0, -9, 0, 9);
    lacquer.addColorStop(0, '#103b44'); lacquer.addColorStop(.12, '#2f91a0'); lacquer.addColorStop(.28, '#19262b'); lacquer.addColorStop(.48, '#080d10'); lacquer.addColorStop(.72, '#1a252a'); lacquer.addColorStop(.9, '#b83e46'); lacquer.addColorStop(1, '#321318');
    ctx.fillStyle = lacquer;
    ctx.beginPath(); ctx.moveTo(shaftBack - 4, -4.2); ctx.lineTo(buttBack, -8.2); ctx.quadraticCurveTo(buttBack - 3, 0, buttBack, 8.2); ctx.lineTo(shaftBack - 4, 4.2); ctx.closePath(); ctx.fill();
    const shaft = ctx.createLinearGradient(0, -4.5, 0, 4.5);
    shaft.addColorStop(0, '#62401e'); shaft.addColorStop(.18, '#f0d59a'); shaft.addColorStop(.34, '#c48b4c'); shaft.addColorStop(.55, '#f5dca7'); shaft.addColorStop(.82, '#9b632f'); shaft.addColorStop(1, '#4e2b17');
    ctx.fillStyle = shaft;
    ctx.beginPath(); ctx.moveTo(tip - 12, -3.1); ctx.lineTo(shaftBack, -4.35); ctx.lineTo(shaftBack, 4.35); ctx.lineTo(tip - 12, 3.1); ctx.closePath(); ctx.fill();
    // Fine grain and tournament-style inlays follow the cue's long axis.
    ctx.globalAlpha = .38; ctx.strokeStyle = '#fff0c9'; ctx.lineWidth = .75; ctx.beginPath(); ctx.moveTo(shaftBack - 5, -2.7); ctx.lineTo(tip - 15, -1.8); ctx.stroke();
    ctx.globalAlpha = .8; ctx.strokeStyle = '#d5a45e'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(buttBack + 8, -4.8); ctx.lineTo(shaftBack - 15, -2.4); ctx.stroke();
    ctx.strokeStyle = '#2ab7ca'; ctx.lineWidth = 1.25; ctx.beginPath(); ctx.moveTo(buttBack + 10, 5.2); ctx.lineTo(shaftBack - 15, 2.5); ctx.stroke();
    ctx.globalAlpha = 1;
    // Contrasting ferrule, narrow chrome rings, and a dark layered cue tip.
    const band = (at, halfWidth, color) => { ctx.fillStyle = color; ctx.fillRect(at - halfWidth, -4.7, halfWidth * 2, 9.4); ctx.fillStyle = 'rgba(255,255,255,.56)'; ctx.fillRect(at - halfWidth, -4.7, 1.1, 9.4); };
    band(shaftBack - 2, 2.2, '#d9c69c'); band(shaftBack - 10, 1.4, '#8cc5c7'); band(shaftBack - 15, 1.1, '#d5a45e');
    band(tip - 12, 2.1, '#e5e1cf');
    ctx.fillStyle = '#e6dfca'; ctx.fillRect(tip - 8, -3.05, 7, 6.1);
    ctx.fillStyle = '#303845'; ctx.fillRect(tip - 2.4, -2.45, 2.1, 4.9);
    ctx.fillStyle = '#2679a0'; ctx.fillRect(tip - .4, -2.25, 1.4, 4.5);
    // Small faceted butt-cap and two polished accent collars make the silhouette read at phone scale.
    band(buttBack + 7, 2.8, '#d3a967'); band(buttBack + 15, 1.8, '#67c4d0'); band(shaftBack - 25, 2.2, '#ba3543');
    ctx.strokeStyle = 'rgba(255,237,193,.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(buttBack + 20, -5.7); ctx.lineTo(buttBack + 23, 0); ctx.lineTo(buttBack + 20, 5.7); ctx.stroke();
    if (strikeProgress !== null && strikeProgress > .42 && strikeProgress < .65) {
      const p = (strikeProgress - .42) / .23; ctx.save(); ctx.globalAlpha = (1 - p) * .82;
      ctx.strokeStyle = '#a9f2ff'; ctx.lineWidth = 2.1; ctx.shadowColor = '#65dfff'; ctx.shadowBlur = 9;
      ctx.beginPath(); ctx.arc(tip - 1, 0, 3 + p * 12, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    ctx.restore();
  }

  drawBall(ctx, ball) {
    // Method is called in world coordinates under the world transform; scale is accounted for by drawing in world units.
    let radius = ball.radius || 14;
    let y = ball.y, x = ball.x, fade = 1, drop = 0;
    if (ball.dropProgress > 0) {
      drop = Math.min(ball.dropProgress, 1);
      const ease = drop * drop * (3 - 2 * drop);
      if (Number.isFinite(ball.pocketX) && Number.isFinite(ball.pocketY)) {
        x += (ball.pocketX - x) * ease;
        y += (ball.pocketY - y) * ease;
      }
      y += drop * 34;
      radius *= 1 - .78 * drop;
      fade = 1 - .92 * drop;
    }
    ctx.save(); ctx.globalAlpha = fade;
    ctx.fillStyle = 'rgba(0,0,0,.32)'; ctx.beginPath(); ctx.ellipse(x + 2, y + radius * .84, radius * 1.12 * (1 - drop * .5), radius * .48 * (1 - drop * .65), 0, 0, Math.PI * 2); ctx.fill();
    const colors = { 1: '#f5d32f', 2: '#1357b5', 3: '#d5222b', 4: '#67238c', 5: '#f28020', 6: '#198347', 7: '#852525', 8: '#101316', 9: '#f5d32f', 10: '#1357b5', 11: '#d5222b', 12: '#67238c', 13: '#f28020', 14: '#198347', 15: '#852525' };
    const color = ball.isCue ? '#f8f7ef' : (colors[ball.number] || '#fff');
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.clip();
    const base = ctx.createRadialGradient(x - radius * .38, y - radius * .46, radius * .06, x, y, radius * 1.25);
    base.addColorStop(0, '#fff'); base.addColorStop(.16, color); base.addColorStop(.73, color); base.addColorStop(1, '#171a19'); ctx.fillStyle = base; ctx.fillRect(x-radius, y-radius, radius*2, radius*2);
    if (ball.type === 'stripe') {
      ctx.fillStyle = '#faf9f1'; ctx.fillRect(x-radius, y-radius * .48, radius*2, radius*.96);
      const stripe = ctx.createLinearGradient(x, y-radius*.48, x, y+radius*.48); stripe.addColorStop(0, color); stripe.addColorStop(.5, color); stripe.addColorStop(1, color); ctx.fillStyle = stripe; ctx.fillRect(x-radius, y-radius*.32, radius*2, radius*.64);
      const shade = ctx.createLinearGradient(x, y-radius, x, y+radius); shade.addColorStop(0, 'rgba(255,255,255,.36)'); shade.addColorStop(.45, 'rgba(255,255,255,0)'); shade.addColorStop(1, 'rgba(0,0,0,.34)'); ctx.fillStyle = shade; ctx.fillRect(x-radius, y-radius, radius*2, radius*2);
    }
    if (!ball.isCue && ball.number) {
      ctx.beginPath(); ctx.fillStyle = '#fffdf5'; ctx.arc(x, y, radius*.39, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#111'; ctx.font = `bold ${Math.max(8, radius*.75)}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(ball.number), x, y + .5);
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.32)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, radius-.5, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }
}
