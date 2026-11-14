const SAVE_KEY = "glyanets-save-v1";

function defaultSave() {
  const units = {};
  for (const id of UNIT_ORDER) {
    const starter = id !== "nocturne";
    units[id] = { level: 1, copies: starter ? 4 : 0, unlocked: starter };
  }
  const campaign = {};
  for (const lv of DATA.campaign) {
    campaign[lv.id] = { stars: 0, unlocked: lv.id === 1 };
  }
  return {
    gold: 150,
    shards: 0,
    units,
    deck: ["rubin", "iney", "iskra", "valkyrie", "prisma"],
    campaign,
    survivalBest: 0,
    dailyChestDate: "",
    seenTutorial: false,
  };
}

const Save = {
  data: defaultSave(),

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.data = this._merge(defaultSave(), parsed);
      }
    } catch (e) {
      console.warn("Не удалось загрузить сохранение", e);
      this.data = defaultSave();
    }
    this._sanitizeDeck();
    return this.data;
  },

  _merge(base, extra) {
    const out = { ...base, ...extra };
    out.units = { ...base.units, ...(extra.units || {}) };
    for (const id of UNIT_ORDER) {
      out.units[id] = { ...base.units[id], ...(out.units[id] || {}) };
    }
    out.campaign = { ...base.campaign, ...(extra.campaign || {}) };
    for (const lv of DATA.campaign) {
      out.campaign[lv.id] = { ...base.campaign[lv.id], ...(out.campaign[lv.id] || {}) };
    }
    return out;
  },

  _sanitizeDeck() {
    const d = this.data.deck.filter((id) => this.data.units[id] && this.data.units[id].unlocked);
    const unlocked = UNIT_ORDER.filter((id) => this.data.units[id].unlocked);
    while (d.length < 5) {
      const next = unlocked.find((id) => !d.includes(id));
      if (!next) break;
      d.push(next);
    }
    this.data.deck = d.slice(0, 5);
  },

  write() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch (e) {
      console.warn("Не удалось сохранить", e);
    }
  },

  collectionCrit() {
    let levels = 0;
    for (const id of UNIT_ORDER) {
      if (this.data.units[id].unlocked) levels += this.data.units[id].level;
    }
    return {
      chance: 0.05,
      mult: 1.6 + levels * 0.08,
      levels,
    };
  },

  canUpgrade(id) {
    const u = this.data.units[id];
    const def = DATA.units[id];
    if (!u.unlocked || u.level >= DATA.maxLevel) return { ok: false, reason: "Максимум" };
    const need = DATA.copiesNeeded[u.level + 1];
    const gold = DATA.upgradeGold[def.rarity][u.level + 1];
    if (u.copies < need) return { ok: false, reason: "Мало копий", need, gold, have: u.copies };
    if (this.data.gold < gold) return { ok: false, reason: "Мало золота", need, gold, have: u.copies };
    return { ok: true, need, gold, have: u.copies };
  },

  upgrade(id) {
    const check = this.canUpgrade(id);
    if (!check.ok) return check;
    const u = this.data.units[id];
    u.copies -= check.need;
    this.data.gold -= check.gold;
    u.level += 1;
    this.write();
    return { ok: true, level: u.level };
  },

  addCopies(id, n, unlock = false) {
    const u = this.data.units[id];
    if (!u) return;
    if (unlock) u.unlocked = true;
    if (u.unlocked) u.copies += n;
    this._sanitizeDeck();
  },

  grantRewards({ gold = 0, shards = 0, copies = [] }) {
    this.data.gold += gold;
    this.data.shards += shards;
    for (const c of copies) this.addCopies(c.id, c.n, c.unlock);
    this.write();
  },

  recordCampaign(levelId, stars) {
    const rec = this.data.campaign[levelId];
    if (!rec.unlocked) return;
    if (stars > rec.stars) rec.stars = stars;
    const next = this.data.campaign[levelId + 1];
    if (stars >= 1 && next) next.unlocked = true;
    const cfg = DATA.campaign.find((l) => l.id === levelId);
    if (cfg && cfg.unlockNocturne && stars >= 1) {
      this.data.units.nocturne.unlocked = true;
    }
    this.write();
  },

  today() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  },

  dailyAvailable() {
    return this.data.dailyChestDate !== this.today();
  },
};
