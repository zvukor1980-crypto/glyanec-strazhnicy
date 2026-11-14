/* Боевой движок: сетка 3×5, мана, призыв, слияние, волны и босс */
const BattleImages = {};
const BATTLE_IMG_SRC = {
  rubin: "img/unit_rubin.png",
  iney: "img/unit_iney.png",
  iskra: "img/unit_iskra.png",
  valkyrie: "img/unit_valkyrie.png",
  prisma: "img/unit_prisma.png",
  nocturne: "img/unit_nocturne.png",
  mob: "img/enemy_mob.png",
  fast: "img/enemy_fast.png",
  mini: "img/enemy_mini.png",
  boss: "img/enemy_boss.png",
  hero: "img/hero_mannequin.png",
};

function preloadBattleImages() {
  const jobs = Object.entries(BATTLE_IMG_SRC).map(([key, src]) => {
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => { BattleImages[key] = im; resolve(); };
      im.onerror = () => resolve();
      im.src = src;
    });
  });
  return Promise.all(jobs);
}

class Battle {
  constructor(opts) {
    this.opts = opts;
    this.canvas = opts.canvas;
    this.ctx = this.canvas.getContext("2d");
    this.mode = opts.mode || "campaign";
    this.level = opts.level || DATA.campaign[0];
    this.deck = opts.deck.slice();
    this.unitLevels = opts.unitLevels || {};
    this.critChance = opts.critChance || 0.05;
    this.critMult = opts.critMult || 1.6;
    this.onHud = opts.onHud || (() => {});
    this.onEnd = opts.onEnd || (() => {});

    this.W = 390;
    this.H = 520;
    this.running = false;
    this.paused = false;
    this.ended = false;
    this.timeScale = opts.timeScale || 1;

    this.cols = 5;
    this.rows = 3;
    this.cell = 50;
    this.gap = 6;
    this.gridW = this.cols * this.cell + (this.cols - 1) * this.gap;
    this.gridH = this.rows * this.cell + (this.rows - 1) * this.gap;
    this.gridX = (this.W - this.gridW) / 2;
    this.gridY = 128;

    this._buildPath();
    this.reset();
    this._bind();
    this.resize();
  }

  _buildPath() {
    const inset = 28;
    this.arena = { x: inset, y: inset, w: this.W - inset * 2, h: this.H - inset * 2 };
    const A = this.arena;
    this.portal = { x: A.x, y: A.y + A.h / 2 };
    this.gate = { x: A.x + A.w, y: A.y + A.h / 2 };
    this.path = [
      { x: this.portal.x, y: this.portal.y },
      { x: A.x, y: A.y },
      { x: A.x + A.w, y: A.y },
      { x: this.gate.x, y: this.gate.y },
    ];
    this.pathLen = 0;
    this.pathSeg = [0];
    for (let i = 1; i < this.path.length; i++) {
      const a = this.path[i - 1], b = this.path[i];
      this.pathLen += Math.hypot(b.x - a.x, b.y - a.y);
      this.pathSeg.push(this.pathLen);
    }
  }

  pathPoint(dist) {
    const d = Math.max(0, Math.min(this.pathLen, dist));
    for (let i = 1; i < this.pathSeg.length; i++) {
      if (d <= this.pathSeg[i]) {
        const a = this.path[i - 1], b = this.path[i];
        const seg = this.pathSeg[i] - this.pathSeg[i - 1];
        const t = seg ? (d - this.pathSeg[i - 1]) / seg : 0;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
    }
    const last = this.path[this.path.length - 1];
    return { x: last.x, y: last.y };
  }

  reset() {
    this.grid = new Array(15).fill(null);
    this.enemies = [];
    this.projectiles = [];
    this.fx = [];
    this.mannequin = null;
    this.lives = 3;
    this.mana = 100;
    this.summonCost = 10;
    this.wave = 0;
    this.maxWaves = this.mode === "survival" ? Infinity : (this.mode === "practice" ? 3 : this.level.waves);
    this.waveState = "idle"; // idle | spawning | wait | boss
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.betweenTimer = 0.6;
    this.sessionGold = 0;
    this.kills = 0;
    this.leaks = 0;
    this.morale = 0;
    this.battleUp = {};
    for (const id of this.deck) this.battleUp[id] = 0;
    this.drag = null;
    this.last = 0;
    this.announce = { text: "", t: 0 };
    this.prismaShield = 0;
  }

  start() {
    this.running = true;
    this.paused = false;
    this.ended = false;
    this.last = performance.now();
    this._tick = this.loop.bind(this);
    this.resize();
    requestAnimationFrame(() => this.resize());
    this.onHud(this.hud());
    requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
  }

  togglePause(v) {
    if (this.ended) return;
    this.paused = v != null ? v : !this.paused;
    if (!this.paused) this.last = performance.now();
  }

  hud() {
    return {
      lives: this.lives,
      wave: this.wave,
      maxWaves: this.maxWaves,
      mana: Math.floor(this.mana),
      cost: this.summonCost,
      gold: this.sessionGold,
      morale: this.morale,
      battleUp: { ...this.battleUp },
      boardFull: this.grid.every(Boolean),
    };
  }

  resize() {
    const c = this.canvas;
    const r = c.parentElement.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    c.width = Math.max(1, r.width * dpr);
    c.height = Math.max(1, r.height * dpr);
    this.dpr = dpr;
    this._cssW = r.width;
    this._cssH = r.height;
    const oldLen = this.pathLen || 1;
    this.W = r.width;
    this.H = r.height;
    this.scale = 1;
    this.offX = 0;
    this.offY = 0;
    this._buildPath();
    const A = this.arena;
    const innerPad = 38;
    this.gap = 7;
    this.cell = Math.floor((A.w - innerPad * 2 - this.gap * 4) / 5);
    this.cell = Math.max(42, Math.min(this.cell, 72));
    this.gridW = this.cols * this.cell + (this.cols - 1) * this.gap;
    this.gridH = this.rows * this.cell + (this.rows - 1) * this.gap;
    this.gridX = A.x + (A.w - this.gridW) / 2;
    this.gridY = A.y + (A.h - this.gridH) / 2;
    const ratio = this.pathLen / oldLen;
    if (this.enemies) {
      for (const e of this.enemies) e.dist *= ratio;
    }
    if (this.mannequin) {
      this.mannequin.dist *= ratio;
      const p = this.pathPoint(this.mannequin.dist);
      this.mannequin.x = p.x;
      this.mannequin.y = p.y;
    }
  }

  _bind() {
    this._onPtrDown = (e) => this.onPtr(e, "down");
    this._onPtrMove = (e) => this.onPtr(e, "move");
    this._onPtrUp = (e) => this.onPtr(e, "up");
    this.canvas.addEventListener("pointerdown", this._onPtrDown);
    window.addEventListener("pointermove", this._onPtrMove);
    window.addEventListener("pointerup", this._onPtrUp);
    window.addEventListener("pointercancel", this._onPtrUp);
    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);
  }

  destroy() {
    this.stop();
    this.canvas.removeEventListener("pointerdown", this._onPtrDown);
    window.removeEventListener("pointermove", this._onPtrMove);
    window.removeEventListener("pointerup", this._onPtrUp);
    window.removeEventListener("pointercancel", this._onPtrUp);
    window.removeEventListener("resize", this._onResize);
  }

  eventPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - this.offX) / this.scale;
    const y = (e.clientY - rect.top - this.offY) / this.scale;
    return { x, y };
  }

  cellAt(x, y) {
    const { gridX, gridY, cell, gap, cols, rows } = this;
    if (x < gridX || y < gridY) return -1;
    const cx = Math.floor((x - gridX) / (cell + gap));
    const cy = Math.floor((y - gridY) / (cell + gap));
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return -1;
    const lx = x - gridX - cx * (cell + gap);
    const ly = y - gridY - cy * (cell + gap);
    if (lx > cell || ly > cell) return -1;
    return cy * cols + cx;
  }

  cellCenter(i) {
    const c = i % this.cols, r = Math.floor(i / this.cols);
    return {
      x: this.gridX + c * (this.cell + this.gap) + this.cell / 2,
      y: this.gridY + r * (this.cell + this.gap) + this.cell / 2,
    };
  }

  onPtr(e, typ) {
    if (!this.running || this.paused || this.ended) return;
    const p = this.eventPos(e);
    if (typ === "down") {
      const i = this.cellAt(p.x, p.y);
      if (i >= 0 && this.grid[i]) {
        this.drag = { from: i, x: p.x, y: p.y, moved: false, id: e.pointerId };
        try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
      }
    } else if (typ === "move" && this.drag) {
      if (Math.hypot(p.x - this.drag.x, p.y - this.drag.y) > 8) this.drag.moved = true;
      this.drag.x = p.x;
      this.drag.y = p.y;
    } else if (typ === "up" && this.drag) {
      if (this.drag.moved) {
        const to = this.cellAt(p.x, p.y);
        if (to >= 0) this.tryMerge(this.drag.from, to);
      }
      this.drag = null;
    }
  }

  emptyCells() {
    const a = [];
    for (let i = 0; i < 15; i++) if (!this.grid[i]) a.push(i);
    return a;
  }

  summon() {
    if (this.ended || this.paused) return { ok: false };
    if (this.mana < this.summonCost) return { ok: false, reason: "Мало маны" };
    const empty = this.emptyCells();
    if (!empty.length) return { ok: false, reason: "Нет места — слейте юнитов" };
    const id = this.deck[Math.floor(Math.random() * this.deck.length)];
    const cell = empty[Math.floor(Math.random() * empty.length)];
    this.mana -= this.summonCost;
    this.summonCost += 10;
    this.grid[cell] = { id, rank: 1, cd: 0.15 };
    this.fx.push({ typ: "pop", x: this.cellCenter(cell).x, y: this.cellCenter(cell).y, t: 0.3, color: DATA.units[id].color });
    this.onHud(this.hud());
    return { ok: true, id };
  }

  tryMerge(a, b) {
    if (a === b) return false;
    const ua = this.grid[a], ub = this.grid[b];
    if (!ua || !ub) return false;
    if (ua.id !== ub.id || ua.rank !== ub.rank) {
      this.fx.push({ typ: "text", x: this.cellCenter(b).x, y: this.cellCenter(b).y - 18, t: 0.7, text: "Нельзя", color: "#ffb4b4" });
      return false;
    }
    if (ua.rank >= 7) return false;
    const nid = this.deck[Math.floor(Math.random() * this.deck.length)];
    this.grid[a] = null;
    this.grid[b] = { id: nid, rank: ua.rank + 1, cd: 0.1 };
    const c = this.cellCenter(b);
    this.fx.push({ typ: "pop", x: c.x, y: c.y, t: 0.4, color: DATA.units[nid].color });
    this.fx.push({ typ: "text", x: c.x, y: c.y - 20, t: 0.8, text: DATA.units[nid].name + " ▲" + (ua.rank + 1), color: "#ffe08a" });
    this.onHud(this.hud());
    return true;
  }

  upgradeType(id) {
    const lvl = this.battleUp[id] || 0;
    if (lvl >= 4) return { ok: false, reason: "Максимум" };
    const cost = DATA.battleUpgradeCost[lvl];
    if (this.mana < cost) return { ok: false, reason: "Мало маны" };
    this.mana -= cost;
    this.battleUp[id] = lvl + 1;
    this.onHud(this.hud());
    return { ok: true };
  }

  useHero() {
    if (this.morale < 100 || this.mannequin) return { ok: false };
    this.morale = 0;
    const dist = this.pathLen * 0.62;
    const p = this.pathPoint(dist);
    this.mannequin = { dist, x: p.x, y: p.y, life: 3.0, max: 3.0, exploded: false };
    this.onHud(this.hud());
    return { ok: true };
  }

  hpMult() {
    return this.mode === "practice" ? 0.55 : (this.level.hp || 1);
  }
  spdMult() {
    return this.mode === "practice" ? 0.85 : (this.level.spd || 1);
  }
  countMult() {
    return this.mode === "practice" ? 0.7 : (this.level.count || 1);
  }

  beginWave() {
    this.wave += 1;
    const isBoss = this.wave % 5 === 0;
    this.waveState = isBoss ? "boss" : "spawning";
    this.announce = { text: isBoss ? "БОСС" : "Волна " + this.wave, t: 1.6 };
    this.spawnQueue = [];
    const n = Math.round((3 + this.wave * 0.75) * this.countMult());
    if (isBoss) {
      const extras = Math.max(0, Math.floor(this.wave / 5) - 1);
      for (let i = 0; i < extras; i++) this.spawnQueue.push("mini");
      this.spawnQueue.push("boss");
    } else {
      for (let i = 0; i < n; i++) {
        let typ = "mob";
        if (this.wave >= 2 && Math.random() < 0.22) typ = "fast";
        if (this.wave % 3 === 0 && i === n - 1) typ = "mini";
        this.spawnQueue.push(typ);
      }
    }
    this.spawnTimer = 0.35;
    this.onHud(this.hud());
  }

  spawnEnemy(typ) {
    const w = this.wave;
    const hm = this.hpMult();
    const base = (26 + w * 14) * hm;
    const stats = {
      mob:  { hp: base,        speed: 42 * this.spdMult(), leak: 1, mana: 8,  gold: 2, size: 28 },
      fast: { hp: base * 0.65, speed: 68 * this.spdMult(), leak: 1, mana: 9,  gold: 2, size: 26 },
      mini: { hp: base * 3.2,  speed: 34 * this.spdMult(), leak: 2, mana: 16, gold: 6, size: 34 },
      boss: { hp: base * 11,   speed: 26 * this.spdMult(), leak: 2, mana: 40, gold: 18, size: 52 },
    }[typ];
    this.enemies.push({
      typ, hp: stats.hp, maxHp: stats.hp, speed: stats.speed,
      leak: stats.leak, mana: stats.mana, gold: stats.gold, size: stats.size,
      dist: 0, slow: 0, block: 0, alive: true,
    });
  }

  unitDamage(u) {
    const def = DATA.units[u.id];
    const lvl = this.unitLevels[u.id] || 1;
    const bup = this.battleUp[u.id] || 0;
    const rankM = DATA.rankMult[u.rank] || 2.6;
    return def.dmg * (1 + 0.12 * (lvl - 1)) * (1 + 0.25 * bup) * rankM;
  }

  unitRate(u) {
    const def = DATA.units[u.id];
    const bup = this.battleUp[u.id] || 0;
    const rs = DATA.rankSpeed[u.rank] || 1.35;
    return def.rate / (rs * (1 + 0.08 * bup));
  }

  firstEnemy() {
    let best = null, bestD = -1;
    for (const e of this.enemies) {
      if (!e.alive || e.hp <= 0) continue;
      if (e.dist > bestD) { bestD = e.dist; best = e; }
    }
    return best;
  }

  nearestEnemy(x, y) {
    let best = null, bestD = 1e9;
    for (const e of this.enemies) {
      if (!e.alive || e.hp <= 0) continue;
      const p = this.pathPoint(e.dist);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  dealDamage(e, amount, srcId, isCrit) {
    if (!e.alive) return;
    let dmg = amount;
    if (srcId === "valkyrie" && (e.typ === "mini" || e.typ === "boss")) dmg *= 1.4;
    e.hp -= dmg;
    const p = this.pathPoint(e.dist);
    this.fx.push({
      typ: "text",
      x: p.x + (Math.random() * 10 - 5),
      y: p.y - 16,
      t: 0.6,
      text: (isCrit ? "КРИТ " : "") + Math.round(dmg),
      color: isCrit ? "#ffe08a" : "#fff",
    });
    if (e.hp <= 0) this.kill(e);
  }

  kill(e) {
    if (!e.alive) return;
    e.alive = false;
    e.hp = 0;
    this.kills++;
    this.mana += e.mana;
    this.sessionGold += e.gold;
    const p = this.pathPoint(e.dist);
    this.fx.push({ typ: "pop", x: p.x, y: p.y, t: 0.35, color: "#c45cff" });
    this.fx.push({ typ: "text", x: p.x, y: p.y - 8, t: 0.7, text: "+" + e.mana, color: "#7ef0e8" });
  }

  leak(e) {
    e.alive = false;
    if (this.prismaShield > 0) {
      this.prismaShield--;
      this.fx.push({ typ: "text", x: this.gate.x, y: this.gate.y - 30, t: 0.9, text: "Щит Призмы", color: "#eadcff" });
      return;
    }
    this.lives -= e.leak;
    this.leaks++;
    if (this.lives < 0) this.lives = 0;
    this.fx.push({ typ: "text", x: this.gate.x, y: this.gate.y - 24, t: 1, text: "Прорыв!", color: "#ff5d73" });
    this.onHud(this.hud());
    if (this.lives <= 0) this.finish(false);
  }

  shoot(u, cell, target, dt) {
    u.cd -= dt;
    if (u.cd > 0) return;
    const def = DATA.units[u.id];
    const c = this.cellCenter(cell);
    let tgt = target;
    if (!tgt || !tgt.alive) return;
    u.cd = this.unitRate(u);
    const crit = Math.random() < this.critChance;
    const dmg = this.unitDamage(u) * (crit ? this.critMult : 1);
    this.projectiles.push({
      x: c.x, y: c.y - 8,
      tx: 0, ty: 0, // resolved on tick
      target: tgt,
      color: def.projectile,
      dmg, crit, src: u.id, t: 0.22,
    });
    if (u.id === "prisma") {
      this.mana += 2.5 + (u.rank * 0.4);
      if (u.rank >= 2 && Math.random() < 0.08) this.prismaShield = Math.min(2, this.prismaShield + 1);
    }
  }

  applyHit(pr) {
    const e = pr.target;
    if (!e || !e.alive) return;
    const src = pr.src;
    this.dealDamage(e, pr.dmg, src, pr.crit);
    const p = this.pathPoint(e.dist);
    if (src === "iney") e.slow = Math.max(e.slow, 1.8);
    if (src === "iskra") {
      const others = this.enemies.filter((o) => o.alive && o !== e);
      others.sort((a, b) => {
        const pa = this.pathPoint(a.dist), pb = this.pathPoint(b.dist);
        return Math.hypot(pa.x - p.x, pa.y - p.y) - Math.hypot(pb.x - p.x, pb.y - p.y);
      });
      others.slice(0, 2).forEach((o) => this.dealDamage(o, pr.dmg * 0.55, src, false));
    }
    if (src === "nocturne") {
      for (const o of this.enemies) {
        if (!o.alive || o === e) continue;
        const po = this.pathPoint(o.dist);
        if (Math.hypot(po.x - p.x, po.y - p.y) < 42) this.dealDamage(o, pr.dmg * 0.7, src, false);
      }
    }
  }

  loop(now) {
    if (!this.running) return;
    const raw = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const dt = this.paused || this.ended ? 0 : raw * this.timeScale;
    if (dt > 0) this.update(dt);
    this.draw();
    requestAnimationFrame(this._tick);
  }

  update(dt) {
    if (this.waveState === "idle") {
      this.betweenTimer -= dt;
      if (this.betweenTimer <= 0) this.beginWave();
    } else if (this.waveState === "spawning" || this.waveState === "boss") {
      this.spawnTimer -= dt;
      if (this.spawnQueue.length && this.spawnTimer <= 0) {
        this.spawnEnemy(this.spawnQueue.shift());
        this.spawnTimer = this.waveState === "boss" ? 1.1 : 0.72;
      }
      const alive = this.enemies.some((e) => e.alive);
      if (!this.spawnQueue.length && !alive) {
        if (this.mode !== "survival" && this.wave >= this.maxWaves) {
          this.finish(true);
          return;
        }
        this.waveState = "idle";
        this.betweenTimer = 1.4;
        if (this.mode === "survival") this.sessionGold += 8;
      }
    }

    if (this.announce.t > 0) this.announce.t -= dt;

    // mannequin
    if (this.mannequin) {
      this.mannequin.life -= dt;
      if (this.mannequin.life <= 0 && !this.mannequin.exploded) {
        this.mannequin.exploded = true;
        const dmg = 90 + this.wave * 12;
        for (const e of this.enemies) {
          if (!e.alive) continue;
          if (Math.abs(e.dist - this.mannequin.dist) < 90) {
            this.dealDamage(e, dmg, "hero", false);
            e.slow = Math.max(e.slow, 0.8);
          }
        }
        this.fx.push({ typ: "pop", x: this.mannequin.x, y: this.mannequin.y, t: 0.5, color: "#e6c36a" });
      }
      if (this.mannequin.life <= -0.2) this.mannequin = null;
    }

    // enemies move
    for (const e of this.enemies) {
      if (!e.alive) continue;
      let sp = e.speed;
      if (e.slow > 0) { sp *= 0.62; e.slow -= dt; }
      if (this.mannequin && !this.mannequin.exploded) {
        if (e.dist < this.mannequin.dist && e.dist + 18 >= this.mannequin.dist) {
          e.dist = this.mannequin.dist - 18;
          continue;
        }
      }
      e.dist += sp * dt;
      if (e.dist >= this.pathLen) this.leak(e);
    }
    this.enemies = this.enemies.filter((e) => e.alive || (e.hp <= 0 && false));
    this.enemies = this.enemies.filter((e) => e.alive);

    // units shoot
    let unitCount = 0;
    for (let i = 0; i < 15; i++) {
      const u = this.grid[i];
      if (!u) continue;
      unitCount++;
      const c = this.cellCenter(i);
      const target = (u.id === "rubin" || u.id === "valkyrie") ? this.firstEnemy() : this.nearestEnemy(c.x, c.y);
      this.shoot(u, i, target, dt);
    }

    // morale
    this.morale = Math.min(100, this.morale + (8 + unitCount * 1.6) * dt);

    // projectiles
    for (const pr of this.projectiles) {
      pr.t -= dt;
      const tp = pr.target && pr.target.alive ? this.pathPoint(pr.target.dist) : { x: pr.x, y: pr.y };
      const k = Math.min(1, 1 - pr.t / 0.22);
      pr.cx = pr.x + (tp.x - pr.x) * k;
      pr.cy = pr.y + (tp.y - pr.y) * k;
      if (pr.t <= 0) this.applyHit(pr);
    }
    this.projectiles = this.projectiles.filter((p) => p.t > 0);

    for (const f of this.fx) f.t -= dt;
    this.fx = this.fx.filter((f) => f.t > 0);

    this.onHud(this.hud());
  }

  finish(win) {
    if (this.ended) return;
    this.ended = true;
    this.running = true; // keep drawing
    this.announce = { text: win ? "ПОБЕДА" : "ПОРАЖЕНИЕ", t: 2 };
    const stars = !win ? 0 : this.lives >= 3 ? 3 : this.lives >= 2 ? 2 : 1;
    this.onEnd({
      win,
      stars,
      lives: this.lives,
      wave: this.wave,
      gold: this.sessionGold,
      kills: this.kills,
      mode: this.mode,
      levelId: this.level && this.level.id,
    });
  }

  draw() {
    const ctx = this.ctx;
    const dpr = this.dpr || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale * dpr, 0, 0, this.scale * dpr, this.offX * dpr, this.offY * dpr);

    // background
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, "#10202c");
    g.addColorStop(1, "#0a141c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);

    this._drawPath(ctx);
    this._drawPortal(ctx);
    this._drawGate(ctx);
    this._drawGrid(ctx);
    if (this.mannequin) this._drawMannequin(ctx);
    this._drawEnemies(ctx);
    this._drawProjectiles(ctx);
    this._drawFx(ctx);
    if (this.announce.t > 0) this._drawAnnounce(ctx);
  }

  _drawPath(ctx) {
    const A = this.arena;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    // Full racetrack around the arena (all 4 sides), like the concept art
    const drawLoop = (width, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(A.x, A.y, A.w, A.h, 22);
      else {
        ctx.moveTo(A.x + 22, A.y);
        ctx.arcTo(A.x + A.w, A.y, A.x + A.w, A.y + A.h, 22);
        ctx.arcTo(A.x + A.w, A.y + A.h, A.x, A.y + A.h, 22);
        ctx.arcTo(A.x, A.y + A.h, A.x, A.y, 22);
        ctx.arcTo(A.x, A.y, A.x + A.w, A.y, 22);
        ctx.closePath();
      }
      ctx.stroke();
    };
    drawLoop(38, "#3f3c38");
    drawLoop(28, "#6d675c");
    // cobble dots along the full loop
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    const loop = 2 * (A.w + A.h);
    for (let d = 0; d < loop; d += 16) {
      let x, y, t = d % loop;
      if (t < A.w) { x = A.x + t; y = A.y; }
      else if (t < A.w + A.h) { x = A.x + A.w; y = A.y + (t - A.w); }
      else if (t < A.w + A.h + A.w) { x = A.x + A.w - (t - A.w - A.h); y = A.y + A.h; }
      else { x = A.x; y = A.y + A.h - (t - A.w - A.h - A.w); }
      ctx.beginPath();
      ctx.arc(x + ((d * 17) % 7) - 3, y + ((d * 13) % 5) - 2, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawPortal(ctx) {
    const { x, y } = this.portal;
    const t = (performance.now() / 400) % (Math.PI * 2);
    ctx.save();
    ctx.translate(x, y);
    const rad = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
    rad.addColorStop(0, "#1a0a24");
    rad.addColorStop(0.5, "#6b2d8a");
    rad.addColorStop(1, "rgba(80,0,80,0)");
    ctx.fillStyle = rad;
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#c45cff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 14 + Math.sin(t) * 2, 18, t, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  _drawGate(ctx) {
    const { x, y } = this.gate;
    ctx.save();
    ctx.translate(x, y);
    const S = Math.max(1, (this.cell || 50) / 50);
    ctx.scale(S * 1.15, S * 1.15);
    ctx.fillStyle = "#c9a24a";
    ctx.strokeStyle = "#f0d58a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-18, 32);
    ctx.lineTo(-18, -4);
    ctx.quadraticCurveTo(-18, -36, 0, -42);
    ctx.quadraticCurveTo(18, -36, 18, -4);
    ctx.lineTo(18, 32);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#7b1fa8";
    ctx.beginPath();
    ctx.moveTo(-11, 28);
    ctx.lineTo(-11, -2);
    ctx.quadraticCurveTo(-11, -26, 0, -30);
    ctx.quadraticCurveTo(11, -26, 11, -2);
    ctx.lineTo(11, 28);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,200,255,0.35)";
    ctx.fillRect(-3, -12, 4, 32);
    ctx.restore();
  }

  _drawGrid(ctx) {
    for (let i = 0; i < 15; i++) {
      const c = i % 5, r = Math.floor(i / 5);
      const x = this.gridX + c * (this.cell + this.gap);
      const y = this.gridY + r * (this.cell + this.gap);
      ctx.fillStyle = "rgba(20, 40, 52, 0.92)";
      ctx.strokeStyle = "rgba(230,195,106,0.35)";
      ctx.lineWidth = 1.5;
      this._roundRect(ctx, x, y, this.cell, this.cell, 8);
      ctx.fill();
      ctx.stroke();
      const u = this.grid[i];
      if (u && !(this.drag && this.drag.from === i && this.drag.moved)) this._drawUnit(ctx, u, x, y, this.cell);
    }
    if (this.drag && this.drag.moved && this.grid[this.drag.from]) {
      this._drawUnit(ctx, this.grid[this.drag.from], this.drag.x - this.cell / 2, this.drag.y - this.cell / 2, this.cell);
      const to = this.cellAt(this.drag.x, this.drag.y);
      if (to >= 0 && to !== this.drag.from) {
        const ub = this.grid[to], ua = this.grid[this.drag.from];
        const ok = ub && ua && ub.id === ua.id && ub.rank === ua.rank;
        const p = this.cellCenter(to);
        ctx.strokeStyle = ok ? "#5ad992" : "#ff5d73";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, this.cell / 2 + 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  _drawUnit(ctx, u, x, y, s) {
    const def = DATA.units[u.id];
    const img = BattleImages[u.id];
    ctx.save();
    // rank frame
    ctx.strokeStyle = DATA.rarityColor[def.rarity];
    ctx.lineWidth = 3;
    const cx = x + s / 2, cy = y + s / 2, R = s / 2 - 3;
    this._rankShape(ctx, u.rank, cx, cy, R);
    ctx.stroke();
    ctx.clip();
    if (img) ctx.drawImage(img, x + 2, y + 2, s - 4, s - 4);
    else {
      ctx.fillStyle = def.color;
      ctx.fillRect(x, y, s, s);
    }
    ctx.restore();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(String(u.rank), x + s - 4, y + s - 4);
    ctx.textAlign = "left";
  }

  _rankShape(ctx, rank, cx, cy, R) {
    ctx.beginPath();
    if (rank <= 1) ctx.arc(cx, cy, R, 0, Math.PI * 2);
    else if (rank === 2) {
      ctx.moveTo(cx, cy - R);
      ctx.lineTo(cx + R, cy);
      ctx.lineTo(cx, cy + R);
      ctx.lineTo(cx - R, cy);
      ctx.closePath();
    } else if (rank === 3) {
      ctx.moveTo(cx, cy - R);
      ctx.lineTo(cx + R, cy + R * 0.7);
      ctx.lineTo(cx - R, cy + R * 0.7);
      ctx.closePath();
    } else {
      const n = rank === 4 ? 4 : 6;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        const fn = i ? ctx.lineTo.bind(ctx) : ctx.moveTo.bind(ctx);
        fn(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      }
      ctx.closePath();
    }
  }

  _drawMannequin(ctx) {
    const m = this.mannequin;
    const pulse = 1 + Math.sin(performance.now() / 120) * 0.06;
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = m.exploded ? "#ffe08a" : "#1a1a1a";
    ctx.strokeStyle = "#e6c36a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, -12, 7, 8, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.lineTo(-10, 16);
    ctx.lineTo(10, 16);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  _drawEnemies(ctx) {
    const list = this.enemies.slice().sort((a, b) => a.dist - b.dist);
    for (const e of list) {
      if (!e.alive) continue;
      const p = this.pathPoint(e.dist);
      const img = BattleImages[e.typ];
      const s = e.size;
      if (img) ctx.drawImage(img, p.x - s / 2, p.y - s + 6, s, s);
      else {
        ctx.fillStyle = "#222";
        ctx.beginPath();
        ctx.arc(p.x, p.y, s / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      // hp bar
      const bw = s, bh = 4;
      const hx = p.x - bw / 2, hy = p.y - s + 2;
      ctx.fillStyle = "#0008";
      ctx.fillRect(hx, hy, bw, bh);
      ctx.fillStyle = e.typ === "boss" ? "#c45cff" : "#5ad992";
      ctx.fillRect(hx, hy, bw * Math.max(0, e.hp / e.maxHp), bh);
    }
  }

  _drawProjectiles(ctx) {
    for (const pr of this.projectiles) {
      ctx.fillStyle = pr.color;
      ctx.beginPath();
      ctx.arc(pr.cx || pr.x, pr.cy || pr.y, pr.crit ? 5 : 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawFx(ctx) {
    for (const f of this.fx) {
      if (f.typ === "text") {
        ctx.globalAlpha = Math.min(1, f.t * 2);
        ctx.fillStyle = f.color;
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(f.text, f.x, f.y - (0.7 - f.t) * 18);
        ctx.globalAlpha = 1;
        ctx.textAlign = "left";
      } else if (f.typ === "pop") {
        ctx.globalAlpha = Math.min(1, f.t * 3);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 2;
        const r = 8 + (0.4 - f.t) * 40;
        ctx.beginPath();
        ctx.arc(f.x, f.y, Math.max(2, r), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  _drawAnnounce(ctx) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, this.announce.t);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, this.H * 0.38, this.W, 48);
    ctx.fillStyle = this.announce.text === "БОСС" || this.announce.text === "ПОРАЖЕНИЕ" ? "#ff8aa0" : "#ffe08a";
    ctx.font = "bold 26px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(this.announce.text, this.W / 2, this.H * 0.38 + 34);
    ctx.restore();
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
