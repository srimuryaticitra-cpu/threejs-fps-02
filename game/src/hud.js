// The DOM HUD: health, ammunition, round timer, score, money, killfeed, the
// buy menu, the plant/defuse bar and the round banners. All updates go through
// these setters so the simulation never touches the DOM directly; each setter
// writes only when its value changed, so a steady HUD costs nothing per frame.
//
// New in this entry (threejs-fps-02):
// - A shield chip under the health bar ("PERISAI AKTIF") while the player
//   holds the Perisai Tempurung, so one glance says whether the next hit is free.
// - A planted-pod label under the timer ("BENIH DITANAM — SITE A") while the
//   pod ticks, so the timer's red danger state is never ambiguous.
// - The minimap draws the shield pickup (green ring at mid) while it waits
//   and the planted pod (solid amber dot) once it is down.
import { SITES } from './map.js';

const $ = (id) => document.getElementById(id);

export function createHud() {
  // Every HUD element the setters touch, looked up once at boot.
  const els = {
    healthFill: $('health-fill'),
    healthNum: $('health-num'),
    shieldChip: $('shield-chip'),
    money: $('money'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    ammoBox: $('ammo'),
    weaponName: $('weapon-name'),
    timer: $('timer'),
    podLabel: $('pod-label'),
    roundLabel: $('round-label'),
    scoreKura: $('score-kura'),
    scoreKelinci: $('score-kelinci'),
    feed: $('feed'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    plantWrap: $('plant-wrap'),
    plantFill: $('plant-fill'),
    plantLabel: $('plant-label'),
    buy: $('buy'),
    buyMoney: $('buy-money'),
    overlay: $('overlay'),
    overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'),
    play: $('play'),
    minimap: $('minimap'),
  };
  const last = {};
  let bannerTimer = 0;
  let hitTimer = 0;

  // Write only when the value changed; fn does the DOM work for the key.
  function set(key, el, value, fn) {
    if (last[key] === value) return;
    last[key] = value;
    if (fn) fn(el, value);
    else el.textContent = value;
  }

  return {
    els,

    setHealth(hp) {
      set('hp', els.healthNum, hp, (el, v) => { el.textContent = v; });
      set('hpf', els.healthFill, hp, (el, v) => { el.style.width = `${Math.max(0, v)}%`; });
      els.healthFill.style.background = hp <= 30 ? '#d95f4b' : '#6fae5e';
    },

    setShield(on) {
      set('shield', els.shieldChip, on, (el, v) => { el.classList.toggle('hidden', !v); });
    },

    setPod(active, siteId) {
      set('pod', els.podLabel, active ? siteId : '', (el, v) => {
        el.classList.toggle('hidden', !active);
        if (active) el.textContent = `💥 BENIH DITANAM — SITE ${v} · JAGA ATAU JINAKKAN`;
      });
    },

    setMoney(m) {
      set('money', els.money, m, (el, v) => { el.textContent = `$${v}`; });
    },

    setAmmo(mag, reserve, name) {
      set('mag', els.ammoMag, mag);
      set('res', els.ammoReserve, reserve, (el, v) => { el.textContent = `/ ${v}`; });
      set('wname', els.weaponName, name);
      els.ammoBox.classList.toggle('empty', mag === 0);
    },

    setTimer(seconds, planted) {
      const s = Math.max(0, Math.ceil(seconds));
      const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      set('timer', els.timer, text + (planted ? '!' : ''));
      els.timer.classList.toggle('danger', planted || s <= 10);
    },

    setScore(kura, kelinci, round) {
      set('sk', els.scoreKura, kura);
      set('skl', els.scoreKelinci, kelinci);
      set('round', els.roundLabel, round, (el, v) => { el.textContent = `RONDE ${v}`; });
    },

    setSpread(px) {
      els.crosshair.style.setProperty('--gap', `${px}px`);
    },

    hitMarker(kill) {
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('kill', kill);
      hitTimer = kill ? 0.28 : 0.12;
    },

    step(dt) {
      if (hitTimer > 0) {
        hitTimer -= dt;
        if (hitTimer <= 0) els.hitmarker.classList.remove('on', 'kill');
      }
      if (bannerTimer > 0) {
        bannerTimer -= dt;
        if (bannerTimer <= 0) els.banner.classList.add('hidden');
      }
    },

    banner(title, sub, seconds = 2.6) {
      els.bannerTitle.textContent = title;
      els.bannerSub.textContent = sub;
      els.banner.classList.remove('hidden');
      bannerTimer = seconds;
    },

    feed(html) {
      const div = document.createElement('div');
      div.className = 'feed-line';
      div.innerHTML = html;
      els.feed.prepend(div);
      while (els.feed.children.length > 5) els.feed.removeChild(els.feed.lastChild);
    },

    showPlant(label, frac) {
      els.plantWrap.classList.remove('hidden');
      els.plantLabel.textContent = label;
      els.plantFill.style.width = `${Math.round(frac * 100)}%`;
    },

    hidePlant() { els.plantWrap.classList.add('hidden'); },

    showBuy(money) {
      els.buy.classList.remove('hidden');
      els.buyMoney.textContent = `$${money}`;
    },

    hideBuy() { els.buy.classList.add('hidden'); },

    markBuyAffordable(money) {
      for (const row of els.buy.querySelectorAll('[data-price]')) {
        row.classList.toggle('poor', Number(row.dataset.price) > money);
      }
    },

    showOverlay(title, copy, button) {
      els.overlayTitle.textContent = title;
      els.overlayCopy.textContent = copy;
      els.play.textContent = button;
      els.overlay.hidden = false;
    },

    hideOverlay() { els.overlay.hidden = true; },

    onPlay(fn) { els.play.addEventListener('click', fn); },

    onBuyClick(fn) {
      els.buy.addEventListener('click', (event) => {
        const row = event.target.closest('[data-buy]');
        if (row) fn(row.dataset.buy);
      });
    },
  };
}

// The minimap: a top-down 2D canvas of the garden, drawn once per frame from
// the live positions — teammates green, the player white, spotted enemies
// orange. Walls are drawn from the same site list the simulation uses, so the
// map and the minimap can never disagree. `extra` carries the shield pickup
// ({x, z} while it waits at mid) and the planted pod ({x, z} once it is down).
export function drawMinimap(canvas, player, bots, spotted, extra) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const sx = (x) => ((x + 22) / 44) * W;
  const sz = (z) => ((z + 16) / 32) * H;

  function dot(x, z, r, colour, stroke = false) {
    ctx.beginPath();
    ctx.arc(sx(x), sz(z), r, 0, Math.PI * 2);
    if (stroke) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.fillStyle = colour;
      ctx.fill();
    }
  }

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(20, 26, 22, 0.85)';
  ctx.fillRect(0, 0, W, H);

  // Site rings with their letters.
  for (const site of SITES) {
    ctx.strokeStyle = '#f0a830';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx(site.center[0]), sz(site.center[1]), (site.radius / 44) * W, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#f0a830';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(site.id, sx(site.center[0]), sz(site.center[1]) + 4);
  }

  // Fountain.
  dot(0, 0, 5, '#3f7d8c');

  // The shield pickup waits at mid: a green ring, so the run to mid has a
  // visible prize on the map before the player ever looks that way.
  if (extra && extra.shield) dot(extra.shield.x, extra.shield.z, 5, '#6fae5e', true);
  // The planted pod: a solid amber dot, impossible to miss.
  if (extra && extra.pod) dot(extra.pod.x, extra.pod.z, 5, '#f0a830');

  for (const bot of bots) {
    if (!bot.alive) continue;
    const enemy = bot.team === 'kelinci';
    if (enemy && !spotted.has(bot)) continue; // enemies only when spotted
    dot(bot.x, bot.z, 3.5, enemy ? '#d97b2f' : '#6fae5e');
  }

  if (player.alive) {
    dot(player.x, player.z, 4, '#ffffff');
    // Facing tick.
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx(player.x), sz(player.z));
    ctx.lineTo(sx(player.x) + Math.sin(player.yaw) * -8, sz(player.z) + Math.cos(player.yaw) * -8);
    ctx.stroke();
  }
}
