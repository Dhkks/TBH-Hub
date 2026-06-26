// TBH Hub — Live Session Tracker

const STORAGE_KEY = 'tbh_session';
const MAX_SNAPS = 60;

let snaps = [];
let sessionStart = Date.now();

function addSnapshot(save) {
  const now = Date.now();
  const snap = {
    ts: now,
    gold: save.gold,
    playTime: save.playTime,
    stageKey: save.currentStageKey,
    heroes: save.partyHeroes.map(h => ({ key: h.key, exp: h.exp, level: h.level })),
    boxQty: [...(save.boxQty || [])],
    boxTypes: [...(save.boxTypes || [])],
  };
  snaps.push(snap);
  if (snaps.length > MAX_SNAPS) snaps.shift();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snaps.slice(-10)));
  } catch(e) {}
}

function loadSession() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) snaps = JSON.parse(stored);
  } catch(e) {}
}

function getRates() {
  if (snaps.length < 2) return null;
  const a = snaps[0];
  const b = snaps[snaps.length - 1];
  const dtMs = b.ts - a.ts;
  if (dtMs < 1000) return null;
  const dtHr = dtMs / 3600000;

  const goldDelta = b.gold - a.gold;
  const goldPerHr = goldDelta > 0 ? goldDelta / dtHr : null;

  let expDelta = 0;
  for (const bh of b.heroes) {
    const ah = a.heroes.find(h => h.key === bh.key);
    if (ah && bh.level === ah.level) {
      expDelta += Math.max(0, bh.exp - ah.exp);
    } else if (ah && bh.level > ah.level) {
      // Level up happened — approximate
      expDelta += Math.max(0, bh.exp);
    }
  }
  const expPerHr = expDelta > 0 ? expDelta / dtHr : null;

  return {
    expPerHr,
    goldPerHr,
    stageKey: b.stageKey,
    dtMs,
  };
}

function getBoxDelta() {
  if (snaps.length < 2) return { opened: 0, gained: 0 };
  let totalOpened = 0, totalGained = 0;
  for (let i = 1; i < snaps.length; i++) {
    const a = snaps[i - 1];
    const b = snaps[i];
    // Compare by summing all quantities
    const sumA = (a.boxQty || []).reduce((s, v) => s + v, 0);
    const sumB = (b.boxQty || []).reduce((s, v) => s + v, 0);
    const diff = sumB - sumA;
    if (diff < 0) totalOpened += Math.abs(diff);
    if (diff > 0) totalGained += diff;
  }
  return { opened: totalOpened, gained: totalGained };
}

function getSessionDuration() {
  return Date.now() - sessionStart;
}

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return h+'h '+(m%60).toString().padStart(2,'0')+'m';
  if (m > 0) return m+'m '+(s%60).toString().padStart(2,'0')+'s';
  return s+'s';
}

function resetSession() {
  snaps = [];
  sessionStart = Date.now();
  try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
}

window.LiveTracker = {
  addSnapshot, loadSession, getRates,
  getBoxDelta, getSessionDuration, fmtDuration, resetSession,
};
