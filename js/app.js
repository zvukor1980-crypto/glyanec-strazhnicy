/* UI, навигация, магазин, кампания и старт боёв */
const App = {
  selectedLevel: 1,
  pickingForDeck: null,
  battle: null,
  hudRaf: 0,

  init() {
    Save.load();
    this.bindNav();
    this.bindMap();
    this.bindButtons();
    this.renderAll();
    preloadBattleImages();
    this.registerSW();
    if (!Save.data.seenTutorial) {
      this.showTutorial();
    }
    window.__GLYANETS__ = this._testApi();
  },

  registerSW() {
    if (!("serviceWorker" in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW", e));
  },

  bindNav() {
    document.querySelectorAll("#tabbar button").forEach((btn) => {
      btn.addEventListener("click", () => this.show(btn.dataset.tab));
    });
  },

  show(name) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.dataset.screen === name));
    document.querySelectorAll("#tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    document.getElementById("app").classList.toggle("fight", name === "battle");
    if (name === "collection") this.renderCollection();
    if (name === "shop") this.renderShop();
    if (name === "trials") this.renderTrials();
    if (name === "map") this.renderMap();
  },

  bindMap() {
    document.getElementById("btnPlay").addEventListener("click", () => {
      const lv = DATA.campaign.find((l) => l.id === this.selectedLevel);
      const rec = Save.data.campaign[this.selectedLevel];
      if (!rec || !rec.unlocked) return this.toast("Уровень ещё закрыт");
      this.startBattle({ mode: "campaign", level: lv });
    });
    document.getElementById("btnSurvival").addEventListener("click", () => {
      this.startBattle({ mode: "survival", level: { id: 0, name: "Выживание", waves: 99, hp: 1, spd: 1, count: 1, gold: 0, shards: 0 } });
    });
    document.getElementById("btnPractice").addEventListener("click", () => {
      this.startBattle({ mode: "practice", level: { id: 0, name: "Учёба", waves: 3, hp: 0.55, spd: 0.85, count: 0.7, gold: 20, shards: 0 } });
    });
  },

  bindButtons() {
    document.getElementById("btnSummon").addEventListener("click", () => {
      if (!this.battle) return;
      const r = this.battle.summon();
      if (!r.ok && r.reason) this.toast(r.reason);
    });
    document.getElementById("btnHero").addEventListener("click", () => {
      if (!this.battle) return;
      const r = this.battle.useHero();
      if (!r.ok) this.toast("Мораль ещё не полна");
    });
    document.getElementById("btnPause").addEventListener("click", () => this.openPause());
  },

  renderAll() {
    this.renderCurrencies();
    this.renderMap();
    this.renderCollection();
    this.renderShop();
    this.renderTrials();
  },

  renderCurrencies() {
    document.querySelector("#chipGold span").textContent = Math.floor(Save.data.gold);
    document.querySelector("#chipShards span").textContent = Math.floor(Save.data.shards);
  },

  renderMap() {
    const box = document.getElementById("mapNodes");
    box.innerHTML = "";
    for (const lv of DATA.campaign) {
      const rec = Save.data.campaign[lv.id];
      const b = document.createElement("button");
      b.className = "map-node" + (lv.bossChapter ? " boss" : "") + (rec.unlocked ? "" : " locked") + (this.selectedLevel === lv.id ? " selected" : "");
      b.style.left = lv.pos.x + "%";
      b.style.top = lv.pos.y + "%";
      b.textContent = rec.unlocked ? String(lv.id) : "🔒";
      const st = document.createElement("div");
      st.className = "stars";
      st.textContent = rec.unlocked ? "★".repeat(rec.stars) + "☆".repeat(3 - rec.stars) : "";
      b.appendChild(st);
      b.addEventListener("click", () => {
        this.selectedLevel = lv.id;
        this.renderMap();
      });
      box.appendChild(b);
    }
    const lv = DATA.campaign.find((l) => l.id === this.selectedLevel);
    const rec = Save.data.campaign[this.selectedLevel];
    document.getElementById("sheetName").textContent = lv.name;
    document.getElementById("sheetSub").textContent = lv.sub;
    document.getElementById("sheetMeta").textContent =
      (rec.unlocked ? "" : "Закрыто · ") +
      lv.waves + " волн · босс каждая 5-я · награда " + lv.gold + " золота, " + lv.shards + " осколков" +
      (rec.stars ? " · лучший результат: " + "★".repeat(rec.stars) : "");
    document.getElementById("btnPlay").disabled = !rec.unlocked;
    document.querySelector(".brand-sub").textContent = "Кампания · Люмина";
  },

  renderTrials() {
    document.getElementById("survivalBest").textContent = String(Save.data.survivalBest || 0);
  },

  renderCollection() {
    const crit = Save.collectionCrit();
    document.getElementById("critLine").textContent =
      `Крит коллекции: ${Math.round(crit.chance * 100)}% · множитель крита ×${crit.mult.toFixed(2)} · сумма уровней ${crit.levels}`;

    const slots = document.getElementById("deckSlots");
    slots.innerHTML = "";
    Save.data.deck.forEach((id, idx) => {
      const def = DATA.units[id];
      const el = document.createElement("button");
      el.className = "deck-slot " + def.rarity + (this.pickingForDeck === idx ? " armed" : "");
      el.innerHTML = `<img src="${def.img}" alt="${def.name}" /><span class="n">${idx + 1}. ${def.name}</span>`;
      el.addEventListener("click", () => {
        if (this.pickingForDeck === idx) this.pickingForDeck = null;
        else {
          this.pickingForDeck = idx;
          this.toast("Выберите стражницу для слота " + (idx + 1));
        }
        this.renderCollection();
      });
      slots.appendChild(el);
    });

    const grid = document.getElementById("unitGrid");
    grid.innerHTML = "";
    for (const id of UNIT_ORDER) {
      const def = DATA.units[id];
      const st = Save.data.units[id];
      const card = document.createElement("article");
      card.className = "unit-card " + def.rarity + (st.unlocked ? "" : " locked");
      const chk = st.unlocked ? Save.canUpgrade(id) : { ok: false, reason: "Закрыта" };
      const nextNeed = st.level < DATA.maxLevel ? DATA.copiesNeeded[st.level + 1] : "—";
      const nextGold = st.level < DATA.maxLevel ? DATA.upgradeGold[def.rarity][st.level + 1] : "—";
      const btnLabel = !st.unlocked
        ? "Закрыта"
        : st.level >= DATA.maxLevel
          ? "Максимум"
          : `Улучшить · ${nextGold} зол. (${st.copies}/${nextNeed})`;
      card.innerHTML = `
        <img src="${def.img}" alt="${def.name}" />
        <h3>${def.name}</h3>
        <div class="meta">${DATA.rarityLabel[def.rarity]} · ур. ${st.level}${st.unlocked ? "" : " · закрыта"}</div>
        <div class="role">${def.role}</div>
        <button class="btn primary upg" ${chk.ok ? "" : "disabled"}>${btnLabel}</button>
        <button class="btn pick">В колоду</button>
      `;
      card.querySelector(".upg").addEventListener("click", () => {
        const r = Save.upgrade(id);
        if (r.ok) this.toast(def.name + " теперь уровня " + r.level);
        else this.toast(r.reason || "Нельзя");
        this.renderAll();
      });
      card.querySelector(".pick").addEventListener("click", () => this.putInDeck(id));
      grid.appendChild(card);
    }
  },

  putInDeck(id) {
    const st = Save.data.units[id];
    if (!st.unlocked) return this.toast("Сначала откройте эту стражницу");
    if (Save.data.deck.includes(id) && this.pickingForDeck == null) {
      return this.toast("Она уже в колоде — выберите слот сверху, чтобы заменить");
    }
    const idx = this.pickingForDeck != null ? this.pickingForDeck : Save.data.deck.findIndex((x) => x === id);
    if (this.pickingForDeck != null) {
      const other = Save.data.deck.indexOf(id);
      if (other >= 0) Save.data.deck[other] = Save.data.deck[this.pickingForDeck];
      Save.data.deck[this.pickingForDeck] = id;
      this.pickingForDeck = null;
      Save._sanitizeDeck();
      Save.write();
      this.toast("Колода обновлена");
      this.renderCollection();
      return;
    }
    this.toast("Нажмите слот колоды, затем карту");
  },

  renderShop() {
    const list = document.getElementById("shopList");
    list.innerHTML = "";
    for (const item of DATA.shop) {
      const el = document.createElement("div");
      el.className = "card shop-item";
      let available = true;
      let priceLabel = item.price ? item.price + (item.currency === "gold" ? " золота" : " осколков") : "Бесплатно";
      if (item.type === "daily") {
        available = Save.dailyAvailable();
        if (!available) priceLabel = "Уже получено сегодня";
      } else {
        available = (item.currency === "gold" ? Save.data.gold : Save.data.shards) >= item.price;
      }
      el.innerHTML = `
        <div>
          <h2>${item.name}</h2>
          <p>${item.desc}</p>
        </div>
        <div class="row">
          <span class="chip ${item.currency === "shards" ? "shards" : "gold"}"><span>${priceLabel}</span></span>
          <button class="btn primary" ${available ? "" : "disabled"}>${item.type === "daily" && available ? "Забрать" : "Купить"}</button>
        </div>
      `;
      el.querySelector("button").addEventListener("click", () => this.buy(item));
      list.appendChild(el);
    }
  },

  buy(item) {
    if (item.type === "daily") {
      if (!Save.dailyAvailable()) return this.toast("Завтра будет новый сундук");
      Save.data.dailyChestDate = Save.today();
      const copy = this.randomCopy(["common", "rare"], false);
      Save.grantRewards({ gold: 50, copies: copy ? [copy] : [] });
      this.toast("Ежедневный сундук: +50 золота" + (copy ? " и копия «" + DATA.units[copy.id].name + "»" : ""));
      this.renderAll();
      return;
    }
    const have = item.currency === "gold" ? Save.data.gold : Save.data.shards;
    if (have < item.price) return this.toast("Не хватает валюты");
    if (item.currency === "gold") Save.data.gold -= item.price;
    else Save.data.shards -= item.price;

    if (item.type === "gold") {
      Save.data.gold += item.amount;
      Save.write();
      this.toast("+" + item.amount + " золота");
    } else if (item.type === "copies") {
      const got = [];
      for (let i = 0; i < item.amount; i++) {
        const c = this.randomCopy(item.pool, item.canUnlock);
        if (c) {
          Save.addCopies(c.id, c.n, c.unlock);
          got.push(DATA.units[c.id].name);
        }
      }
      Save.write();
      this.toast(got.length ? "Получено: " + got.join(", ") : "Пусто");
    }
    this.renderAll();
  },

  randomCopy(pool, canUnlock) {
    const candidates = UNIT_ORDER.filter((id) => {
      const r = DATA.units[id].rarity;
      if (!pool.includes(r)) return false;
      const u = Save.data.units[id];
      if (!u.unlocked && !(canUnlock && id === "nocturne")) return false;
      if (!u.unlocked && canUnlock && pool.includes("legendary")) return true;
      return u.unlocked;
    });
    if (!candidates.length) return null;
    // weight: common more often
    const weighted = [];
    for (const id of candidates) {
      const w = { common: 5, rare: 3, epic: 2, legendary: 1 }[DATA.units[id].rarity];
      for (let i = 0; i < w; i++) weighted.push(id);
    }
    const id = weighted[Math.floor(Math.random() * weighted.length)];
    const unlock = canUnlock && !Save.data.units[id].unlocked;
    return { id, n: 1, unlock };
  },

  startBattle(opts) {
    if (Save.data.deck.length < 5) return this.toast("Соберите колоду из 5 карт");
    if (this.battle) {
      this.battle.destroy();
      this.battle = null;
    }
    this.show("battle");
    const canvas = document.getElementById("battleCanvas");
    const crit = Save.collectionCrit();
    const unitLevels = {};
    for (const id of UNIT_ORDER) unitLevels[id] = Save.data.units[id].level;

    const start = () => {
      this.battle = new Battle({
        canvas,
        mode: opts.mode,
        level: opts.level,
        deck: Save.data.deck.slice(),
        unitLevels,
        critChance: crit.chance,
        critMult: crit.mult,
        onHud: (h) => this.applyHud(h),
        onEnd: (res) => this.onBattleEnd(res, opts),
      });
      this.battle.start();
      this.battle.resize();
    };
    preloadBattleImages().then(start);
  },

  applyHud(h) {
    const hearts = "♥ ".repeat(h.lives) + "♡ ".repeat(Math.max(0, 3 - h.lives));
    document.getElementById("lives").textContent = hearts.trim();
    const max = h.maxWaves === Infinity ? "∞" : h.maxWaves;
    const boss = h.wave && h.wave % 5 === 0 ? " · БОСС" : "";
    document.getElementById("waveInd").textContent = h.wave ? `Волна ${h.wave} / ${max}${boss}` : "Готовность";
    document.querySelector("#battleGold span").textContent = h.gold;
    document.getElementById("manaLabel").textContent = "мана " + h.mana;
    document.getElementById("costLabel").textContent = "цена " + h.cost;
    document.getElementById("btnSummon").disabled = h.mana < h.cost;
    document.getElementById("moraleBar").style.width = Math.max(0, Math.min(100, h.morale)) + "%";
    document.getElementById("btnHero").classList.toggle("ready", h.morale >= 100);

    const box = document.getElementById("upgradeSlots");
    if (box.dataset.built !== Save.data.deck.join(",")) {
      box.innerHTML = "";
      box.dataset.built = Save.data.deck.join(",");
      for (const id of Save.data.deck) {
        const def = DATA.units[id];
        const b = document.createElement("button");
        b.className = "up-slot";
        b.dataset.id = id;
        b.innerHTML = `<img src="${def.img}" alt="${def.name}" /><div class="cost"></div>`;
        b.addEventListener("click", () => {
          if (!this.battle) return;
          const r = this.battle.upgradeType(id);
          if (!r.ok && r.reason) this.toast(r.reason);
        });
        box.appendChild(b);
      }
    }
    box.querySelectorAll(".up-slot").forEach((el) => {
      const id = el.dataset.id;
      const lvl = (h.battleUp && h.battleUp[id]) || 0;
      const maxed = lvl >= 4;
      el.classList.toggle("max", maxed);
      el.querySelector(".cost").textContent = maxed ? "макс." : "+" + (lvl + 1) + " · " + DATA.battleUpgradeCost[lvl];
    });
  },

  openPause() {
    if (!this.battle || this.battle.ended) return;
    this.battle.togglePause(true);
    this.modal(`
      <h2>Пауза</h2>
      <p>Бой остановлен. Прогресс кампании сохранится после завершения.</p>
      <button class="btn primary" id="mContinue">Продолжить</button>
      <button class="btn ghost" id="mLeave">Сдаться</button>
    `);
    document.getElementById("mContinue").onclick = () => { this.closeModal(); this.battle.togglePause(false); };
    document.getElementById("mLeave").onclick = () => {
      this.closeModal();
      this.battle.finish(false);
    };
  },

  onBattleEnd(res, opts) {
    setTimeout(() => this.showResult(res, opts), 600);
  },

  showResult(res, opts) {
    const copies = [];
    let gold = 0, shards = 0, note = "";
    if (res.mode === "practice") {
      gold = res.win ? 15 : 5;
      note = "Учебный бой";
    } else if (res.mode === "survival") {
      gold = res.gold + res.wave * 4;
      shards = Math.floor(res.wave / 5) * 4;
      if (res.wave > (Save.data.survivalBest || 0)) {
        Save.data.survivalBest = res.wave;
        note = "Новый рекорд!";
      }
    } else {
      const lv = opts.level;
      const part = Math.min(1, res.wave / lv.waves);
      gold = res.win ? lv.gold + res.gold : Math.floor((lv.gold * 0.25 + res.gold) * part);
      shards = res.win ? lv.shards + (res.stars === 3 ? 4 : 0) : Math.floor(lv.shards * 0.15 * part);
      if (res.win) {
        Save.recordCampaign(lv.id, res.stars);
        copies.push(this.randomCopy(["common", "rare", "epic"], false));
        if (res.stars >= 3) copies.push(this.randomCopy(["rare", "epic"], false));
        if (lv.unlockNocturne) {
          Save.data.units.nocturne.unlocked = true;
          note = "Открыта легендарная Ноктюрн!";
        }
      }
    }
    const cleanCopies = copies.filter(Boolean);
    Save.grantRewards({ gold, shards, copies: cleanCopies });
    Save.write();

    const starStr = res.win ? "★".repeat(res.stars) + "☆".repeat(3 - res.stars) : "☆☆☆";
    const copyTxt = cleanCopies.length
      ? cleanCopies.map((c) => DATA.units[c.id].name).join(", ")
      : "—";
    this.modal(`
      <h2>${res.win ? "Победа!" : "Врата пали"}</h2>
      <div class="stars-big">${starStr}</div>
      <p>${note || (res.win ? "Тени отступили." : "Попробуйте слить иначе или усилить колоду.")}</p>
      <div class="reward-line">Золото: +${gold}</div>
      <div class="reward-line">Осколки: +${shards}</div>
      <div class="reward-line">Копии: ${copyTxt}</div>
      <div class="reward-line">Волн: ${res.wave}${res.mode === "survival" ? "" : ""} · убито: ${res.kills}</div>
      <button class="btn primary" id="mOk">К карте</button>
    `);
    document.getElementById("mOk").onclick = () => {
      this.closeModal();
      this.leaveBattle();
    };
  },

  leaveBattle() {
    if (this.battle) {
      this.battle.destroy();
      this.battle = null;
    }
    this.renderAll();
    this.show("map");
  },

  showTutorial() {
    this.modal(`
      <h2>Добро пожаловать в Люмину</h2>
      <p>Призывайте стражниц за ману, перетаскивайте двух одинаковых одного ранга, чтобы слить их, и не дайте чернильным тварям дойти до Врат Глянца. Босс — каждая пятая волна.</p>
      <p>Всё офлайн, без покупок за деньги. Прогресс пишется на этом устройстве.</p>
      <button class="btn primary" id="mTut">Понятно</button>
    `);
    document.getElementById("mTut").onclick = () => {
      Save.data.seenTutorial = true;
      Save.write();
      this.closeModal();
    };
  },

  modal(html) {
    const m = document.getElementById("modal");
    document.getElementById("modalCard").innerHTML = html;
    m.classList.remove("hidden");
  },
  closeModal() {
    document.getElementById("modal").classList.add("hidden");
  },

  toast(msg) {
    const box = document.getElementById("toasts");
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  },

  _testApi() {
    return {
      save: () => Save.data,
      addGold: (n) => { Save.data.gold += n; Save.write(); this.renderAll(); },
      reset: () => { localStorage.removeItem("glyanets-save-v1"); Save.data = defaultSave(); Save.write(); this.renderAll(); },
      start: (id) => this.startBattle({ mode: "campaign", level: DATA.campaign[id - 1] || DATA.campaign[0] }),
      battle: () => this.battle,
    };
  },
};

document.addEventListener("DOMContentLoaded", () => App.init());
