// TBH Hub — App Controller v0.2

let saveData = null;
let selectedHeroKey = null;
let currentSort = 'exp';
let calSamples = [];
let extraCalStages = [];
let _extraIdCtr = 0;
let lastSaveTime = null;
let sessionTick = null;

const $ = id => document.getElementById(id);
const setText = (id, val) => { const el=$(id); if(el) el.textContent=val; };
const setHTML = (id, val) => { const el=$(id); if(el) el.innerHTML=val; };
const E = window.TBHEngine;

const DIFF_COLOR = { NORMAL:'var(--d-n)', NIGHTMARE:'var(--d-nm)', HELL:'var(--d-h)', TORMENT:'var(--d-t)' };
const DIFF_DOT   = { NORMAL:'●', NIGHTMARE:'◆', HELL:'▲', TORMENT:'★' };

// ── BUILD STAGE OPTIONS with diff colors ──
function buildStageOptions(placeholder) {
  return '<option value="">'+(placeholder||'— select —')+'</option>' +
    E.STAGE_ORDER.map(k => {
      const s = E.STAGES[k];
      if (!s) return '';
      const dc = {NORMAL:'opt-n',NIGHTMARE:'opt-nm',HELL:'opt-h',TORMENT:'opt-t'}[s.diff]||'';
      const dot = DIFF_DOT[s.diff]||'';
      return `<option value="${k}" class="${dc}">${dot} ${E.DIFF_LABEL[s.diff]||s.diff} ${s.label} — ${s.name}</option>`;
    }).join('');
}

// ── INIT ──
async function init() {
  LiveTracker.loadSession();
  populateCalSelects();
  loadSettings();
  // Apply any saved auto clear-time samples
  applyAutoClearTime('1101');
  const maxKey = $('calMaxSelect')?.value;
  if (maxKey) applyAutoClearTime(maxKey);
  extraCalStages.forEach(e => { if (e.key) applyAutoClearTime(e.key); });

  const path = await window.tbh.getSavePath();
  setText('cfgPath', path);
  setText('nsSavePath', path);

  const exists = await window.tbh.saveExists();
  if (exists) {
    const arr = await window.tbh.readSave();
    if (arr) await onSaveLoaded(arr);
    else showNoSave();
  } else {
    showNoSave();
  }

  window.tbh.onSaveUpdated(async arr => { await onSaveLoaded(arr); });
  // Fast box detection from log
  if (window.tbh.onBoxOpened) {
    window.tbh.onBoxOpened((count) => {
      const cur = parseInt($('liveBoxes')?.textContent || '0') || 0;
      setText('liveBoxes', cur + count);
    });
  }
  loadAlertSettings();
  startTick();
}

async function onSaveLoaded(arr) {
  try {
    saveData = await SaveReader.parseSave(arr);
    LiveTracker.addSnapshot(saveData);
    lastSaveTime = Date.now();
    // Auto clear-time detection
    if (saveData.currentStageKey != null && saveData.currentWave != null) {
      detectClear(String(saveData.currentStageKey), saveData.currentWave);
    }
    updateAll();
    showLive();
    // Detect new drops after UI update
    if (saveData.rawItems) detectNewDrops(saveData.rawItems);
    // Detect hero level ups
    if (saveData.heroMap) detectLevelUps(saveData.heroMap);
    // Inventory value: show whatever is already cached immediately. A full
    // price-fetch pass only runs once, on the very first save load \u2014
    // after that, prices update only when a new drop is detected (which
    // already fetches/caches that item's price for the alert).
    renderInventoryValue();
    if (!invInitialized) {
      invInitialized = true;
      calcInventoryValue();
    }
  } catch(e) { console.error('Save error:', e); }
}

function showNoSave() {
  $('noSaveScreen').style.display = 'flex';
  $('liveContent').style.display = 'none';
  setText('sbarStatus', '● no save');
  $('sbarStatus').className = 'bad';
  $('liveInd').className = 'live-ind';
  setText('liveIndText', 'offline');
}

function showLive() {
  $('noSaveScreen').style.display = 'none';
  $('liveContent').style.display = 'block';
  setText('sbarStatus', '● online');
  $('sbarStatus').className = 'ok';
  $('liveInd').className = 'live-ind on';
  setText('liveIndText', 'online');
}

async function retryLoad() {
  const exists = await window.tbh.saveExists();
  if (exists) {
    const arr = await window.tbh.readSave();
    if (arr) await onSaveLoaded(arr);
  }
}

function updateAll() {
  if (!saveData) return;
  updateLive(); updateFarm(); updateStats(); updateSbar(); updateConfig();
}

// ── LIVE ──
function updateLive() {
  const d = saveData;
  const rates = LiveTracker.getRates();
  if (rates?.expPerHr) { setText('liveXPHr', E.fmtNum(rates.expPerHr)); setText('liveXPSub','per hour · current session'); }
  else { setText('liveXPHr','—'); setText('liveXPSub','waiting for 2+ readings...'); }
  if (rates?.goldPerHr) { setText('liveGoldHr', E.fmtNum(rates.goldPerHr)); setText('liveGoldSub', E.stageLabel(rates.stageKey)); }
  else { setText('liveGoldHr','—'); setText('liveGoldSub','—'); }
  const partyNames = d.arrangedKeys.map(k=>E.HERO_NAMES[k]||'Hero '+k).join(' · ');
  setText('liveHeroSub', partyNames);
  setText('liveLevel', d.maxPartyLevel);
  setText('liveExpBonus', '+'+d.bonuses.expBonusPct+'%');
  setText('liveGoldBonus', '+'+d.bonuses.goldBonusPct+'%');
  const h=Math.floor(d.playTime/3600), m=Math.floor((d.playTime%3600)/60);
  setText('livePlayTime', h+'h '+m+'m');
  setText('liveSession', LiveTracker.fmtDuration(LiveTracker.getSessionDuration()));
  const boxes = LiveTracker.getBoxDelta();
  const totalBoxes = (boxes.opened || 0) + (window._logBoxCount || 0);
  setText('liveBoxes', totalBoxes);
  // invCount managed by calcInventoryValue
}

// ── FARM ──
function updateFarm() {
  if (!saveData) return;
  updateHeroSelect();
  const maxSel = $('calMaxSelect');
  if (maxSel && saveData.maxCompletedStage && !maxSel.dataset.userChanged) {
    maxSel.value = saveData.maxCompletedStage;
    maxSel.dataset.userChanged = '1';
    updateCalMaxLabel();
  } else if (maxSel && maxSel.value) {
    updateCalMaxLabel();
  }
  buildCalSamples();
  renderRanking();
  // party span removed
}

function updateHeroSelect() {
  const sel = $('heroSelect');
  if (!sel || !saveData) return;
  const currentVal = selectedHeroKey ? String(selectedHeroKey) : String(saveData.arrangedKeys[0]);
  sel.innerHTML = Object.values(saveData.heroMap)
    .filter(h=>h.unlocked)
    .sort((a,b)=>b.level-a.level)
    .map(h => {
      const name = E.HERO_NAMES[h.key]||'Hero '+h.key;
      const inParty = saveData.arrangedKeys.includes(h.key);
      return '<option value="'+h.key+'" '+(inParty?'style="color:var(--good)"':'')+'>'+
        name+' Lv '+h.level+(inParty?' ●':'')+
        '</option>';
    }).join('');
  sel.value = currentVal;
  if (!selectedHeroKey && sel.value) selectedHeroKey = parseInt(sel.value);
  if (selectedHeroKey) sel.value = String(selectedHeroKey);
}

// ── STATS ──
function updateStats() {
  if (!saveData) return;
  const d = saveData;
  setHTML('heroList', Object.values(d.heroMap)
    .sort((a,b)=>b.level-a.level)
    .map(h => {
      const name = E.HERO_NAMES[h.key]||'Hero '+h.key;
      const inParty = d.arrangedKeys.includes(h.key);
      return '<div class="hero-row'+(inParty?' party':'')+'">'+
        '<div><div class="hr-name">'+name+'</div><div class="hr-sub">'+(inParty?'party':'reserve')+'</div></div>'+
        '<div class="hr-right"><span class="hr-lv"><span style="font-size:11px;color:var(--mut);font-weight:400">Lv </span>'+h.level+'</span><span class="hr-exp">'+E.fmtNum(h.exp)+' xp</span></div>'+
        '</div>';
    }).join(''));
  setText('statsExpBonus', '+'+d.bonuses.expBonusPct+'%');
  setText('statsGoldBonus', '+'+d.bonuses.goldBonusPct+'%');
  setText('statsStage', E.stageLabel(d.currentStageKey));
  const maxKey = String(d.maxCompletedStage);
  let displayKey = maxKey;
  if (!E.STAGES[maxKey]) {
    // Boss-of-act stage not in gamedata — find last normal stage before it
    // Boss stages are x10 (e.g. 2310 = act 2, stage 10 boss)
    // The normal stages before it are ordered in STAGE_ORDER
    const maxIdx = E.STAGE_ORDER.indexOf(maxKey);
    if (maxIdx > 0) {
      for (let i = maxIdx - 1; i >= 0; i--) {
        if (E.STAGES[E.STAGE_ORDER[i]]) { displayKey = E.STAGE_ORDER[i]; break; }
      }
    } else {
      // Not in STAGE_ORDER — find last stage with lower numeric key
      const maxNum = parseInt(maxKey);
      const candidates = E.STAGE_ORDER.filter(k => parseInt(k) < maxNum && E.STAGES[k]);
      if (candidates.length > 0) displayKey = candidates[candidates.length - 1];
    }
  }
  setText('statsMaxStage', 'Max: '+E.stageLabel(displayKey));
}

function updateSbar() {
  if (!saveData) return;
  const s = E.STAGES[saveData.currentStageKey];
  const dc = s ? E.DIFF_CLASS[s.diff] : '';
  const el = $('sbarStage');
  if (el) { el.textContent=E.stageLabel(saveData.currentStageKey); el.className='stage-cur '+dc; }
}

function updateConfig() {
  const el=$('cfgStatus');
  if (el) { el.textContent=saveData?'found · monitoring':'not found'; el.style.color=saveData?'var(--good)':'var(--bad)'; }
}

// ── CALIBRATION ──
function populateCalSelects() {
  const opts = buildStageOptions('— select —');
  const maxSel = $('calMaxSelect');
  if (maxSel) maxSel.innerHTML = opts;
}

function updateCalMaxLabel() {
  const sel = $('calMaxSelect');
  if (!sel) return;
  const s = sel.value ? E.STAGES[sel.value] : null;
  // Update color of the select to match diff
  if (s) {
    sel.style.color = DIFF_COLOR[s.diff]||'var(--ink)';
    const sub = $('calMaxSub');
    if (sub) { const dl=E.DIFF_LABEL[s.diff]||s.diff; sub.textContent=dl+' · Lv '+s.lvl; sub.style.color='var(--mut)'; }
  } else {
    sel.style.color = 'var(--dim)';
    const sub = $('calMaxSub');
    if (sub) sub.textContent = '';
  }
}

function buildCalSamples() {
  calSamples = [];
  const anchor = E.STAGES['1101'];
  const t11 = parseFloat($('cal11')?.value);
  if (t11>0 && anchor) calSamples.push({hp:anchor.hp, waves:anchor.waves, time:t11});
  const maxKey = $('calMaxSelect')?.value;
  const tMax = parseFloat($('calMaxTime')?.value);
  if (maxKey && tMax>0 && E.STAGES[maxKey])
    calSamples.push({hp:E.STAGES[maxKey].hp, waves:E.STAGES[maxKey].waves, time:tMax});
  extraCalStages.forEach(({key,time}) => {
    if (key && time>0 && E.STAGES[key])
      calSamples.push({hp:E.STAGES[key].hp, waves:E.STAGES[key].waves, time});
  });
}

function onCalChange() {
  buildCalSamples(); saveSettings(); renderRanking(); updateCalStatus();
}

function updateCalStatus() {
  const filled = calSamples.length;
  const statusEl = $('calStatusText');
  if (statusEl) {
    if (filled >= 2) { statusEl.textContent = '✓ optimized'; statusEl.style.color = 'var(--good)'; }
    else if (filled === 1) { statusEl.textContent = '1/2'; statusEl.style.color = 'var(--warn)'; }
    else { statusEl.textContent = ''; }
  }
  const hint = $('calHint');
  if (!hint) return;
  if (filled>=2) { hint.textContent=''; hint.className='cal-hint ok'; }
  else if (filled===1) { hint.textContent=''; hint.className='cal-hint'; }
  else { hint.textContent=''; hint.className='cal-hint'; }
}

function suggestCalStage() {
  if (!saveData) return;
  const maxKey = $('calMaxSelect')?.value || saveData.maxCompletedStage;
  const maxIdx = E.STAGE_ORDER.indexOf(String(maxKey));
  if (maxIdx < 1) return;

  // Get already used keys
  const usedKeys = new Set();
  usedKeys.add('1101'); // anchor always used
  if ($('calMaxSelect')?.value) usedKeys.add($('calMaxSelect').value);
  extraCalStages.forEach(e => { if(e.key) usedKeys.add(e.key); });

  // Find candidate stages between anchor and max, not yet used
  const candidates = E.STAGE_ORDER.slice(1, maxIdx).filter(k => !usedKeys.has(k) && E.STAGES[k]);

  if (candidates.length === 0) {
    const btn = $('btnSuggestCal');
    if (btn) btn.textContent = 'no suggestion';
    return;
  }

  // Pick the one closest to midpoint by HP
  const anchorHP = E.STAGES['1101']?.hp || 0;
  const maxHP = E.STAGES[maxKey]?.hp || 0;
  const midHP = (anchorHP + maxHP) / 2;
  const best = candidates.reduce((b, k) => {
    const diff = Math.abs((E.STAGES[k]?.hp||0) - midHP);
    const bdiff = Math.abs((E.STAGES[b]?.hp||0) - midHP);
    return diff < bdiff ? k : b;
  }, candidates[0]);

  const s = E.STAGES[best];
  const btn = $('btnSuggestCal');
  if (btn) btn.textContent = 'Suggest';
  addExtraCalCard(best);
}

function getUsedKeys() {
  const used = new Set(['1101']);
  if ($('calMaxSelect')?.value) used.add($('calMaxSelect').value);
  extraCalStages.forEach(e => { if(e.key) used.add(e.key); });
  return used;
}

function addExtraCalCard(presetKey) {
  // Prevent duplicates
  if (presetKey && getUsedKeys().has(presetKey)) return;
  const id = 'extra_'+Date.now()+'_'+(++_extraIdCtr);
  extraCalStages.push({id, key:presetKey||'', time:0});

  const s = presetKey ? E.STAGES[presetKey] : null;
  const diffLabel = s ? (E.DIFF_LABEL[s.diff]||s.diff) : '';
  const diffColor = s ? (DIFF_COLOR[s.diff]||'var(--ink)') : 'var(--dim)';
  const tagText = s ? s.label : '?';
  const tagColor = s ? (DIFF_COLOR[s.diff]||'var(--mut)') : 'var(--mut)';
  const stageName = s ? (diffLabel+' '+s.label+' — '+s.name) : '— select stage —';
  const stageSub = s ? (diffLabel+' · Lv '+s.lvl) : '';

  const div = document.createElement('div');
  div.className = 'cal-card cal-card-extra';
  div.id = id;

  // Build options
  const opts = buildStageOptions('— select stage —');

  div.innerHTML =
    '<div class="cal-card-body">'+
      '<div class="cal-tag-wrap">'+
        '<span class="cal-tag" id="tag_'+id+'" style="color:'+tagColor+';white-space:nowrap">'+tagText+'</span>'+
      '</div>'+
      '<div class="cal-card-info" style="flex:1;padding:8px 12px;min-width:0;overflow:hidden">'+
        '<select class="cal-name-select" id="sel_'+id+'" style="color:'+diffColor+'">'+opts+'</select>'+
        '<div class="cal-card-sub" id="sub_'+id+'">'+stageSub+'</div>'+
      '</div>'+
      '<div class="cal-card-inp">'+
        '<input type="number" id="inp_'+id+'" placeholder="seg" min="1">'+
      '</div>'+
      '<button class="cal-remove-btn" id="rm_'+id+'">✕</button>'+
    '</div>';

  document.getElementById('calExtraList').appendChild(div);

  if (presetKey) document.getElementById('sel_'+id).value = presetKey;
  if (presetKey) applyAutoClearTime(presetKey);

  // Select listener
  document.getElementById('sel_'+id).addEventListener('change', function() {
    // Check duplicate
    if (this.value) {
      const usedByOthers = new Set(['1101']);
      if ($('calMaxSelect')?.value) usedByOthers.add($('calMaxSelect').value);
      extraCalStages.forEach(e => { if(e.id!==id && e.key) usedByOthers.add(e.key); });
      if (usedByOthers.has(this.value)) {
        this.value = '';
        return;
      }
    }
    const entry = extraCalStages.find(e=>e.id===id);
    if (entry) entry.key = this.value;
    const st = this.value ? E.STAGES[this.value] : null;
    const dl = st ? (E.DIFF_LABEL[st.diff]||st.diff) : '';
    const dc = st ? (DIFF_COLOR[st.diff]||'var(--ink)') : 'var(--dim)';
    this.style.color = dc;
    const tagEl = document.getElementById('tag_'+id);
    if (tagEl) { tagEl.textContent = st?st.label:'?'; tagEl.style.color = st?(DIFF_COLOR[st.diff]||'var(--mut)'):'var(--mut)'; }
    const subEl = document.getElementById('sub_'+id);
    if (subEl) { subEl.textContent = st?(dl+' · Lv '+st.lvl):''; subEl.style.color='var(--mut)'; }
    onCalChange();
  });

  // Input listener
  document.getElementById('inp_'+id).addEventListener('input', function() {
    this.dataset.userEdited = '1';
    const entry = extraCalStages.find(e=>e.id===id);
    if (entry) entry.time = parseFloat(this.value)||0;
    onCalChange();
  });

  // Remove listener
  document.getElementById('rm_'+id).addEventListener('click', function() {
    extraCalStages = extraCalStages.filter(e=>e.id!==id);
    div.remove();
    onCalChange();
  });
}

function resetCal() {
  const el11=$('cal11'); if(el11) el11.value='';
  const elMax=$('calMaxSelect'); if(elMax){ elMax.value=''; delete elMax.dataset.userChanged; }
  const elMaxT=$('calMaxTime'); if(elMaxT) elMaxT.value='';
  updateCalMaxLabel();
  extraCalStages=[];
  $('calExtraList').innerHTML='';
  calSamples=[];
  saveSettings(); renderRanking(); updateCalStatus();
}

// ── SETTINGS ──
function saveSettings() {
  try {
    localStorage.setItem('tbh_s', JSON.stringify({
      t11: $('cal11')?.value||'',
      maxKey: $('calMaxSelect')?.value||'',
      tMax: $('calMaxTime')?.value||'',
      heroKey: selectedHeroKey?String(selectedHeroKey):'',
      sort: currentSort,
      extra: extraCalStages.map(e=>({key:e.key,time:e.time})),
    }));
  } catch(e) {}
}

function loadSettings() {
  try {
    const raw=localStorage.getItem('tbh_s');
    if(!raw) return;
    const d=JSON.parse(raw);
    if(d.t11){ const el=$('cal11'); if(el) el.value=d.t11; }
    if(d.tMax){ const el=$('calMaxTime'); if(el) el.value=d.tMax; }
    if(d.maxKey){ const el=$('calMaxSelect'); if(el){ el.value=d.maxKey; el.dataset.userChanged='1'; updateCalMaxLabel(); } }
    if(d.heroKey) selectedHeroKey=parseInt(d.heroKey);
    if(d.sort) currentSort=d.sort;
    if(d.extra && Array.isArray(d.extra)) {
      d.extra.forEach(e=>{
        // Only restore if has a valid stage key
        if(!e.key || !E.STAGES[e.key]) return;
        addExtraCalCard(e.key);
        const last=extraCalStages[extraCalStages.length-1];
        if(last && e.time>0){
          last.time=e.time;
          const inp=document.getElementById('inp_'+last.id);
          if(inp) inp.value=e.time;
        }
      });
    }
    buildCalSamples(); updateCalStatus();
  } catch(e) {}
}

// ── RANKING ──
function setSort(mode) {
  currentSort=mode;
  ['Exp','Gold','Bal'].forEach(s=>{const btn=$('sortBtn'+s); if(btn) btn.style.color=mode===s.toLowerCase()?'var(--exp)':'var(--mut)';});
  setText('rankSortLabel', {exp:'by EXP/h',gold:'by Gold/h',bal:'balance'}[mode]||mode);
  saveSettings(); renderRanking();
}

function renderRanking() {
  const tbody=$('rankBody');
  if(!tbody) return;
  if(!saveData){ tbody.innerHTML='<tr><td colspan="6"><div class="empty">carregue o save para ver o ranking</div></td></tr>'; return; }

  const heroLevel = selectedHeroKey?(saveData.heroMap[selectedHeroKey]?.level||saveData.maxPartyLevel):saveData.maxPartyLevel;
  const maxKey = $('calMaxSelect')?.value||saveData.maxCompletedStage;
  const ranked = E.rankStages(calSamples, saveData.bonuses, maxKey, heroLevel);

  if(ranked.calibrated && ranked.byExp.length>0){
    const maxExp=ranked.byExp[0].expPerHr||1, maxGold=ranked.byGold[0].goldPerHr||1;
    ranked.byExp.forEach(s=>{ s.balScore=(s.expPerHr/maxExp)*0.4+(s.goldPerHr/maxGold)*0.3+s.fit*0.3; });
    ranked.byBal=[...ranked.byExp].sort((a,b)=>b.balScore-a.balScore);
  } else { ranked.byBal=ranked.byScore; }

  const list=currentSort==='exp'?ranked.byExp:currentSort==='gold'?ranked.byGold:(ranked.byBal||ranked.byScore);

  setFarmCard('exp', ranked.byExp[0]);
  setFarmCard('gold', ranked.byGold[0]);
  setFarmCard('bal', (ranked.byBal||ranked.byScore)[0]);

  tbody.innerHTML=list.slice(0,20).map((s,i)=>{
    const dc=E.DIFF_CLASS[s.diff]||'n';
    const isCur=saveData&&s.key===saveData.currentStageKey;
    const expVal=ranked.calibrated&&s.expPerHr?E.fmtNum(s.expPerHr):'—';
    const goldVal=ranked.calibrated&&s.goldPerHr?E.fmtNum(s.goldPerHr):'—';
    const clrVal=s.clearTime?E.fmtTime(s.clearTime):'—';
    const keptPct=Math.round(s.fit*100);
    const keptCls=keptPct>=80?'kept-hi':keptPct>=40?'kept-mid':'kept-lo';
    return '<tr'+(isCur?' class="cur"':'')+'>'+
      '<td class="rk">'+(i+1)+'</td>'+
      '<td>'+
        '<div class="stg-top"><span class="db '+dc+'">'+(E.DIFF_LABEL[s.diff]||s.diff).slice(0,4).toUpperCase()+'</span><span>'+s.label+'</span></div>'+
        '<div class="stg-nm">'+s.name+'</div>'+
      '</td>'+
      '<td class="r e">'+expVal+'</td>'+
      '<td class="r g">'+goldVal+'</td>'+
      '<td class="r '+keptCls+'">'+keptPct+'%</td>'+
      '<td class="r dim">'+clrVal+'</td>'+
      '</tr>';
  }).join('');
}

function setFarmCard(type,s){
  if(!s) return;
  const dc=E.DIFF_CLASS[s.diff]||'n';
  setText('fc-'+type+'-stage',s.label);
  setText('fc-'+type+'-name',s.name);
  const diffEl=$('fc-'+type+'-diff');
  if(diffEl){diffEl.textContent=E.DIFF_LABEL[s.diff];diffEl.className='fc-diff '+dc;}
  const rateEl=$('fc-'+type+'-rate');
  if(!rateEl) return;
  if(type==='exp') rateEl.innerHTML=s.expPerHr?'<b class="e">'+E.fmtNum(s.expPerHr)+'</b> xp/h':'<span style="color:var(--dim)">'+(s.exp/s.hp*s.fit).toFixed(4)+' exp/hp</span>';
  else if(type==='gold') rateEl.innerHTML=s.goldPerHr?'<b class="g">'+E.fmtNum(s.goldPerHr)+'</b> g/h':'—';
  else rateEl.innerHTML=s.expPerHr?'<b class="e">'+E.fmtNum(s.expPerHr)+'</b> · <b class="g">'+E.fmtNum(s.goldPerHr)+'</b>':'—';
}




// ── STEAM REQUEST QUEUE ──
// All Steam Market API calls go through this queue to avoid 429s.
// Priority: 0 = drop alert (high), 1 = inventory scan (low).
const steamQueue = [];
let steamQueueRunning = false;

function steamRequest(fn, priority = 1) {
  return new Promise((resolve, reject) => {
    steamQueue.push({ fn, priority, resolve, reject });
    steamQueue.sort((a, b) => a.priority - b.priority);
    if (!steamQueueRunning) runSteamQueue();
  });
}

async function runSteamQueue() {
  steamQueueRunning = true;
  while (steamQueue.length > 0) {
    const { fn, resolve, reject } = steamQueue.shift();
    try { resolve(await fn()); } catch(e) { reject(e); }
    if (steamQueue.length > 0) await new Promise(r => setTimeout(r, 3000));
  }
  steamQueueRunning = false;
}

// ── REGION / CURRENCY DETECTION ──
// Steam Market currency codes (ECurrencyCode), used by both the
// priceoverview and search/render endpoints via the `currency=` param.
const STEAM_CURRENCY_BY_REGION = {
  US: 1, GB: 2,
  // Eurozone countries -> EUR
  DE: 3, FR: 3, IT: 3, ES: 3, PT: 3, NL: 3, BE: 3, AT: 3, IE: 3, FI: 3,
  GR: 3, LU: 3, SK: 3, SI: 3, EE: 3, LV: 3, LT: 3, CY: 3, MT: 3, HR: 3,
  CH: 4, RU: 5, PL: 6, BR: 7, JP: 8, NO: 9, ID: 10, MY: 11, PH: 12,
  SG: 13, TH: 14, VN: 15, KR: 16, TR: 17, UA: 18, MX: 19, CA: 20,
  AU: 21, NZ: 22, CN: 23, IN: 24, CL: 25, PE: 26, CO: 27, ZA: 28,
  HK: 29, TW: 30, SA: 31, AE: 32, SE: 33, AR: 34, IL: 35,
};

// Detects the user's region from the OS/browser locale (e.g. "pt-BR" -> "BR",
// "en-US" -> "US"). Falls back to "US" if unavailable or unrecognized.
function detectRegion() {
  try {
    const loc = navigator.language || 'en-US';
    const parts = loc.split('-');
    const region = (parts[1] || parts[0] || 'US').toUpperCase();
    return region;
  } catch(e) { return 'US'; }
}

// Returns the Steam currency code for the user's detected region,
// defaulting to USD (1) for unrecognized regions.
function getSteamCurrency() {
  return STEAM_CURRENCY_BY_REGION[detectRegion()] || 1;
}

// ── STEAM INVENTORY VALUE ──
// Prices are fetched from a pre-built JSON file published to the GitHub repo
// via GitHub Actions every 2 hours. This avoids hitting Steam's rate limits
// entirely — the app reads one small JSON file instead of 100+ API calls.
//
// Fallback: if the pre-built file is unavailable (e.g. offline), the app
// falls back to the old per-item priceoverview approach.
const PRICES_JSON_URL = 'https://raw.githubusercontent.com/Dhkks/TBH-Hub/main/prices.json';
let remotePricesCache = null;     // { currency_code: { hash_name: { sell, sell_text, listings } } }
let remotePricesFetchedAt = 0;
const REMOTE_PRICES_TTL = 2 * 60 * 60 * 1000; // 2h — matches GitHub Action cadence

async function loadRemotePrices() {
  const now = Date.now();
  if (remotePricesCache && now - remotePricesFetchedAt < REMOTE_PRICES_TTL) {
    return remotePricesCache;
  }
  try {
    // Bust cache so we always get the latest from GitHub Actions
    const url = PRICES_JSON_URL + '?t=' + Math.floor(now / (REMOTE_PRICES_TTL));
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    remotePricesCache = data.prices || {};
    remotePricesFetchedAt = now;
    console.log('[tbh] remote prices loaded:', Object.keys(remotePricesCache['1'] || {}).length, 'items, updated:', data.updated_at);
    return remotePricesCache;
  } catch(e) {
    console.warn('[tbh] remote prices unavailable, falling back to Steam API:', e.message);
    return null;
  }
}

function getRemotePrice(prices, hashName, currencyCode) {
  if (!prices) return null;
  const byCode = prices[String(currencyCode)];
  if (!byCode) return null;
  const entry = byCode[hashName];
  if (!entry || entry.sell <= 0) return null;
  return { sellCents: entry.sell, listed: entry.sell_text, listings: entry.listings };
}

// ── STEAM INVENTORY VALUE ──
// Steam Market currency codes -> ISO 4217 codes, for locale-aware formatting.
const ISO_CURRENCY_BY_STEAM_CODE = {
  1:'USD', 2:'GBP', 3:'EUR', 4:'CHF', 5:'RUB', 6:'PLN', 7:'BRL', 8:'JPY',
  9:'NOK', 10:'IDR', 11:'MYR', 12:'PHP', 13:'SGD', 14:'THB', 15:'VND',
  16:'KRW', 17:'TRY', 18:'UAH', 19:'MXN', 20:'CAD', 21:'AUD', 22:'NZD',
  23:'CNY', 24:'INR', 25:'CLP', 26:'PEN', 27:'COP', 28:'ZAR', 29:'HKD',
  30:'TWD', 31:'SAR', 32:'AED', 33:'SEK', 34:'ARS', 35:'ILS',
};

const MARKET_CACHE_MS = 60 * 60 * 1000; // 1 hour cache per item price

// Formats a value (in cents) as currency using the user's detected Steam
// currency + locale (e.g. "R$ 3,11" for BR, "$3.11" for US).
function fmtCurrency(cents) {
  const iso = ISO_CURRENCY_BY_STEAM_CODE[getSteamCurrency()] || 'USD';
  try {
    return new Intl.NumberFormat(navigator.language, { style: 'currency', currency: iso }).format(cents / 100);
  } catch(e) {
    return (cents / 100).toFixed(2) + ' ' + iso;
  }
}

// Parses a Steam "lowest_price" string (e.g. "R$ 3,11", "$3.11", "1.234,56\u20ac")
// into an integer number of cents, regardless of locale formatting.
function parsePriceToCents(str) {
  if (!str) return 0;
  const cleaned = String(str).replace(/[^0-9.,]/g, '');
  if (!cleaned) return 0;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let intPart, decPart;
  if (lastComma === -1 && lastDot === -1) {
    intPart = cleaned; decPart = '00';
  } else {
    const decIdx = Math.max(lastComma, lastDot);
    intPart = cleaned.slice(0, decIdx).replace(/[.,]/g, '');
    decPart = cleaned.slice(decIdx + 1).replace(/[.,]/g, '');
    decPart = (decPart + '00').slice(0, 2);
  }
  return (parseInt(intPart || '0', 10) || 0) * 100 + (parseInt(decPart || '0', 10) || 0);
}

// Per-item price cache (hash_name -> {ts, currency, sellCents, listed}),
// persisted in localStorage. Shared by drop alerts and inventory value, so
// a price fetched for one is reused by the other. Each entry is valid for
// MARKET_CACHE_MS and is invalidated automatically if the user's currency
// changes (e.g. locale change).
const ITEM_PRICE_CACHE_KEY = 'tbh_item_prices';
let itemPriceCache = {};
try {
  itemPriceCache = JSON.parse(localStorage.getItem(ITEM_PRICE_CACHE_KEY) || '{}');
} catch(e) { itemPriceCache = {}; }

function persistItemPriceCache() {
  try { localStorage.setItem(ITEM_PRICE_CACHE_KEY, JSON.stringify(itemPriceCache)); } catch(e) {}
}

function getCachedPrice(hashName) {
  const entry = itemPriceCache[hashName];
  if (!entry) return null;
  if (entry.currency !== getSteamCurrency()) return null;
  if (Date.now() - entry.ts >= MARKET_CACHE_MS) return null;
  return entry;
}

// Like getCachedPrice, but ignores the TTL \u2014 used for display so the
// inventory value doesn't disappear/zero out just because a price aged
// past MARKET_CACHE_MS. Staleness only matters when deciding whether to
// fetch a fresh price (getCachedPrice), not for showing the last known one.
function getAnyCachedPrice(hashName) {
  const entry = itemPriceCache[hashName];
  if (!entry) return null;
  if (entry.currency !== getSteamCurrency()) return null;
  return entry;
}

function setCachedPrice(hashName, sellCents, listed) {
  itemPriceCache[hashName] = { ts: Date.now(), currency: getSteamCurrency(), sellCents, listed };
  persistItemPriceCache();
}

function renderInventoryRanking() {
  const list = document.getElementById('invRankList');
  const status = document.getElementById('invRankStatus');
  const totalEl = document.getElementById('steamTotalValue');
  const countEl = document.getElementById('steamItemCount');
  const lastUpEl = document.getElementById('steamLastUpdate');
  if (!list || !saveData || !window.ITEM_CATALOG) return;

  const catalog = window.ITEM_CATALOG;
  const rows = [];
  let totalCents = 0;

  for (const item of saveData.rawItems) {
    const cat = catalog[item.ItemKey];
    if (!cat || !cat.tradable) continue;
    const hashName = steamHashName(cat);
    const cached = getAnyCachedPrice(hashName);
    if (!cached || cached.sellCents <= 0) continue;
    totalCents += cached.sellCents;
    rows.push({ name: cat.name, grade: cat.grade, sellCents: cached.sellCents, listed: cached.listed, ts: cached.ts });
  }

  // Group identical items
  const grouped = [];
  const seen = {};
  for (const r of rows) {
    if (seen[r.name] !== undefined) {
      grouped[seen[r.name]].qty++;
      grouped[seen[r.name]].totalCents += r.sellCents;
    } else {
      seen[r.name] = grouped.length;
      grouped.push({ ...r, qty: 1, totalCents: r.sellCents });
    }
  }
  grouped.sort((a, b) => b.totalCents - a.totalCents);

  // Update summary
  if (totalEl) totalEl.textContent = rows.length > 0 ? fmtCurrency(totalCents) : '—';
  if (countEl) countEl.textContent = rows.length + ' items';

  // Last update: oldest cached price timestamp
  if (lastUpEl && rows.length > 0) {
    const oldest = Math.min(...rows.map(r => r.ts));
    const mins = Math.round((Date.now() - oldest) / 60000);
    lastUpEl.textContent = 'updated ' + (mins < 1 ? 'just now' : mins + 'm ago');
  } else if (lastUpEl) {
    lastUpEl.textContent = '—';
  }

  if (grouped.length === 0) {
    list.innerHTML = '<div class="empty">no priced items — open Steam tab and refresh</div>';
    if (status) status.textContent = '';
    return;
  }

  if (status) status.textContent = grouped.length + ' items';

  const gradeColors = { LEGENDARY:'#f6c552', IMMORTAL:'#ff8a5c', ARCANA:'#e5564b', BEYOND:'#a98cff', CELESTIAL:'#5fd0e0', DIVINE:'#cdd8f2', COSMIC:'#74d28e' };

  list.innerHTML = grouped.map((r, i) => {
    const col = gradeColors[r.grade] || 'var(--ink)';
    const pct = grouped[0].totalCents > 0 ? (r.totalCents / grouped[0].totalCents * 100).toFixed(0) : 0;
    const qtyTag = r.qty > 1 ? '<span style="color:var(--mut);font-size:11px;margin-left:5px;">x' + r.qty + '</span>' : '';
    const priceStr = r.qty > 1 ? fmtCurrency(r.totalCents) + '<span style="color:var(--dim);font-size:10px;margin-left:4px;">(' + r.listed + ' ea)</span>' : r.listed;
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);">' +
      '<span style="color:var(--dim);font-size:11px;min-width:22px;text-align:right;">' + (i+1) + '</span>' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:13px;color:' + col + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + r.name + qtyTag + '</div>' +
        '<div style="height:2px;background:var(--line2);margin-top:4px;border-radius:1px;">' +
          '<div style="height:2px;width:' + pct + '%;background:' + col + ';border-radius:1px;opacity:0.5;"></div>' +
        '</div>' +
      '</div>' +
      '<span style="font-size:13px;color:var(--gold);font-weight:700;white-space:nowrap;padding-right:10px;">' + priceStr + '</span>' +
    '</div>';
  }).join('');
}

function renderInventoryValue() {
  if (!saveData || !window.ITEM_CATALOG) return;
  const catalog = window.ITEM_CATALOG;
  let totalCents = 0, counted = 0;
  for (const item of saveData.rawItems) {
    const cat = catalog[item.ItemKey];
    if (!cat || !cat.tradable) continue;
    const hashName = steamHashName(cat);
    const cached = getAnyCachedPrice(hashName);
    if (cached && cached.sellCents > 0) {
      totalCents += cached.sellCents;
      counted++;
    }
  }
  const invValueEl = document.getElementById('invValue');
  const invCountEl = document.getElementById('invCount');
  if (invValueEl) invValueEl.textContent = fmtCurrency(totalCents);
  if (invCountEl) invCountEl.textContent = counted + ' valued';
  renderInventoryRanking();
}

// Full update: fetches (or reuses fresh cached) prices for every unique
// tradable item in the inventory, one at a time via priceoverview (the
// same endpoint used for drop alerts, which is deterministic per item \u2014
// unlike the old bulk search/render pagination, which returned a different
// "window" of items on each call and caused the valued count to vary).
let invCalcRunning = false;
let invCalcQueued = false;

// onSaveLoaded fires often during farming (every autosave), but a full
// price pass can take 40s+ with rate-limit delays. Without this guard,
// multiple overlapping passes would run at once, each updating the DOM
// and hitting Steam concurrently \u2014 causing the value/count to jump
// around and tripping the rate limit faster.
async function calcInventoryValue() {
  if (!saveData || !window.ITEM_CATALOG) return;

  if (invCalcRunning) {
    invCalcQueued = true;
    return;
  }
  invCalcRunning = true;

  const invValueEl = document.getElementById('invValue');
  const invCountEl = document.getElementById('invCount');
  if (invValueEl) invValueEl.textContent = 'loading...';
  if (invCountEl) invCountEl.textContent = '\u2014 items';

  try {
    const catalog = window.ITEM_CATALOG;

    // ── PRICE LOADING STRATEGY ──
    // 1. Try to load prices from the pre-built prices.json (GitHub Actions, every 2h).
    //    One fetch covers ALL items in all currencies — instantaneous for users.
    // 2. Fall back to per-item priceoverview calls if the remote file is unavailable.

    const remotePrices = await loadRemotePrices();
    const currency = getSteamCurrency();

    const hashNames = new Set();
    for (const item of saveData.rawItems) {
      const cat = catalog[item.ItemKey];
      if (!cat || !cat.tradable) continue;
      hashNames.add(steamHashName(cat));
    }

    if (remotePrices) {
      // Remote prices available: populate cache instantly from the JSON file
      for (const hashName of hashNames) {
        if (getCachedPrice(hashName)) continue;
        const remote = getRemotePrice(remotePrices, hashName, currency);
        if (remote) {
          setCachedPrice(hashName, remote.sellCents, remote.listed);
        } else {
          setCachedPrice(hashName, 0, null); // not listed
        }
      }
    } else {
      // Fallback: fetch per-item via priceoverview (slow but always works)
      const toFetch = [...hashNames].filter(h => !getCachedPrice(h));
      for (const h of toFetch) {
        await fetchSteamPriceRaw(h, 1);
      }
      for (const h of toFetch) {
        if (!getCachedPrice(h)) setCachedPrice(h, 0, null);
      }
    }

    renderInventoryValue();
    renderInventoryRanking();
  } catch(e) {
    console.error('inventory value error:', e);
    if (invValueEl) invValueEl.textContent = 'error';
  } finally {
    invCalcRunning = false;
    if (invCalcQueued) {
      invCalcQueued = false;
      calcInventoryValue(); // a save update arrived mid-pass; run once more
    }
  }
}


// ── ALERTS & DROP DETECTION ──
const GRADE_ORDER = ['COMMON','UNCOMMON','RARE','LEGENDARY','IMMORTAL','ARCANA','BEYOND','CELESTIAL','DIVINE','COSMIC'];
let alertSettings = { webhookUrl: '', userId: '', minGrade: 'LEGENDARY' };
let prevItemKeys = null;    // legacy, kept for compatibility
let prevItemCounts = null;  // { [ItemKey]: count } — used for drop detection
let sessionDrops = [];
let prevHeroLevels = null; // { [heroKey]: level }
let invInitialized = false; // becomes true after the first full price pass

function buildItemCounts(rawItems) {
  const counts = {};
  for (const i of rawItems) {
    counts[i.ItemKey] = (counts[i.ItemKey] || 0) + 1;
  }
  return counts;
}

function gradeAbove(grade, min) {
  return GRADE_ORDER.indexOf(grade) >= GRADE_ORDER.indexOf(min);
}

function gradeEmoji(grade) {
  const map = {
    LEGENDARY: '🟡', IMMORTAL: '🟠', ARCANA: '🔴',
    BEYOND: '🟣', CELESTIAL: '💙', DIVINE: '🤍', COSMIC: '⭐'
  };
  return map[grade] || '⚪';
}

function steamHashName(item) {
  if (item.type === 'MATERIAL') return item.name;
  const gradeLabel = item.grade.charAt(0) + item.grade.slice(1).toLowerCase();
  return item.name + ' (' + gradeLabel + ') A';
}

// Lower-level price fetcher. Returns:
//   { ok: true,  rateLimited: false, data: {sellCents, listed} }  -> success (or cache hit)
//   { ok: false, rateLimited: true,  data: null }                 -> HTTP 429
//   { ok: false, rateLimited: false, data: null }                 -> no listing / other error
async function fetchSteamPriceRaw(hashName, priority = 1) {
  const cached = getCachedPrice(hashName);
  if (cached) return { ok: true, rateLimited: false, data: { sellCents: cached.sellCents, listed: cached.listed } };

  return steamRequest(async () => {
    try {
      const url = 'https://steamcommunity.com/market/priceoverview/?appid=3678970&currency=' + getSteamCurrency() + '&market_hash_name=' + encodeURIComponent(hashName);
      const r = await fetch(url);
      if (r.status === 429) return { ok: false, rateLimited: true, data: null };
      const d = await r.json();
      if (!d.success) return { ok: false, rateLimited: false, data: null };
      const sellCents = parsePriceToCents(d.lowest_price);
      setCachedPrice(hashName, sellCents, d.lowest_price || null);
      return { ok: true, rateLimited: false, data: { sellCents, listed: d.lowest_price || null } };
    } catch(e) {
      return { ok: false, rateLimited: false, data: null };
    }
  }, priority);
}

// Used by the drop-alert flow: high priority (0) so it jumps the queue.
async function fetchSteamPrice(hashName) {
  const r = await fetchSteamPriceRaw(hashName, 0);
  if (!r.ok) return null;
  return { listed: r.data.listed, volume: null };
}

// Sends a payload to the configured Discord webhook, handling 429
// (rate limit) by waiting Discord's reported retry_after and retrying once.
async function sendDiscordPayload(payload) {
  try {
    const r = await fetch(alertSettings.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (r.status === 429) {
      let retryAfter = 1000;
      try {
        const d = await r.json();
        if (d.retry_after) retryAfter = Math.ceil(d.retry_after * 1000) + 100;
      } catch(e) {}
      await new Promise(res => setTimeout(res, retryAfter));
      await fetch(alertSettings.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }
  } catch(e) { console.error('webhook error:', e); }
}

async function sendDiscordAlert(drops) {
  if (!alertSettings.webhookUrl) return;
  const gradeColors = {LEGENDARY:16766720,IMMORTAL:16744960,ARCANA:15728640,BEYOND:11141375,CELESTIAL:6226175,DIVINE:16777215,COSMIC:16744703};

  for (const drop of drops) {
    const gradeLabel = drop.grade.charAt(0)+drop.grade.slice(1).toLowerCase();
    const price = await fetchSteamPrice(steamHashName(drop));
    // fetchSteamPrice just cached this item's price (if available) \u2014
    // reflect it in the inventory value immediately.
    renderInventoryValue();
    const embedColor = gradeColors[drop.grade] || 16777215;

    const fields = (price && price.listed) ? [
      { name: 'Listed Value', value: price.listed, inline: true },
    ] : [
      { name: 'Listed Value', value: 'Not currently listed on Steam Market', inline: false }
    ];

    const iconUrl = drop.icon ? 'https://raw.githubusercontent.com/shigake/tbh-copilot/main/assets'+drop.icon : null;

    const embed = {
      title: drop.name,
      color: embedColor,
      fields,
      footer: { text: gradeLabel+' \u00b7 TBH Hub' },
      timestamp: new Date().toISOString(),
    };
    if (iconUrl) {
      embed.thumbnail = { url: iconUrl };
    }

    const payload = {
      content: alertSettings.userId ? '<@'+alertSettings.userId+'>' : undefined,
      username: 'TBH Hub',
      embeds: [embed],
    };


    await sendDiscordPayload(payload);

    // Discord limits webhooks to ~5 requests per 2 seconds. When several
    // items drop at once, sendDiscordAlert sends one message per item in
    // a tight loop \u2014 without a delay, the later ones get silently
    // dropped (Discord returns 429, but fetch doesn't throw, so the old
    // code's catch(e) never saw it).
    await new Promise(r => setTimeout(r, 700));

    sessionDrops.unshift({ ...drop, price, ts: new Date().toLocaleTimeString() });
    updateDropList();
  }
}

function updateDropList() {
  const list = document.getElementById('alertDropList');
  if (!list) return;
  setText('alertDropCount', sessionDrops.length + ' this session');
  if (sessionDrops.length === 0) {
    list.innerHTML = '<div class="empty">no drops detected yet</div>';
    return;
  }
  list.innerHTML = sessionDrops.slice(0, 20).map(d => {
    const priceText = d.price ? (d.price.listed || '?') : '—';
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid var(--line);font-size:11px;">'+
      '<div>'+
        '<span style="color:var(--dim);margin-right:8px">'+d.ts+'</span>'+
        '<span style="color:'+(DIFF_COLOR_GRADE[d.grade]||'var(--ink)')+'">'+gradeEmoji(d.grade)+' '+d.name+'</span>'+
      '</div>'+
      '<span style="color:var(--gold)">'+priceText+'</span>'+
    '</div>';
  }).join('');
}

const DIFF_COLOR_GRADE = {
  LEGENDARY:'#f6c552', IMMORTAL:'#ff8a5c', ARCANA:'#e5564b',
  BEYOND:'#a98cff', CELESTIAL:'#5fd0e0', DIVINE:'#ffffff', COSMIC:'#f9a8d4'
};

function detectNewDrops(currentItems) {
  const currentCounts = buildItemCounts(currentItems);

  if (!prevItemCounts) {
    prevItemCounts = currentCounts;
    prevItemKeys = new Set(currentItems.map(i => i.UniqueId)); // legacy compat
    return;
  }

  // Find items whose count increased (new drops)
  const catalog = window.ITEM_CATALOG;
  if (!catalog) return;

  const dropped = [];
  for (const [itemKey, count] of Object.entries(currentCounts)) {
    const prev = prevItemCounts[itemKey] || 0;
    const gained = count - prev;
    if (gained <= 0) continue;
    const cat = catalog[itemKey];
    if (!cat) continue;
    // Add one entry per gained item
    for (let x = 0; x < gained; x++) dropped.push(cat);
  }

  prevItemCounts = currentCounts;
  prevItemKeys = new Set(currentItems.map(i => i.UniqueId)); // legacy compat

  if (dropped.length === 0) return;

  // Sanity check: more than 15 different item types gained at once is likely
  // a stale snapshot re-sync (e.g. app opened mid-session), not real drops.
  const uniqueKeys = new Set(dropped.map(i => i && (i.name || ''))).size;
  if (uniqueKeys > 15) {
    console.log('[tbh] skipping alert: ' + dropped.length + ' items gained at once (likely stale snapshot)');
    return;
  }

  const notifiable = dropped.filter(i => i && i.tradable && gradeAbove(i.grade, alertSettings.minGrade));

  if (notifiable.length > 0) {
    // Drop detected: clear low-priority inventory requests from the queue
    // so the drop alert's price fetch runs immediately.
    const before = steamQueue.length;
    steamQueue.splice(0, steamQueue.length, ...steamQueue.filter(q => q.priority === 0));
    if (before > steamQueue.length) console.log('[tbh] cleared ' + (before - steamQueue.length) + ' inventory requests for drop alert');
    sendDiscordAlert(notifiable);
    renderInventoryValue();
  }
}

// ── HERO LEVEL UP ALERTS ──
// Sends a Discord alert whenever any party hero gains a level.
function detectLevelUps(heroMap) {
  if (!heroMap) return;

  if (!prevHeroLevels) {
    // First load: just record current levels, no alerts on startup.
    prevHeroLevels = {};
    for (const key of Object.keys(heroMap)) {
      prevHeroLevels[key] = heroMap[key].level;
    }
    return;
  }

  const leveledUp = [];
  for (const key of Object.keys(heroMap)) {
    const newLevel = heroMap[key].level;
    const oldLevel = prevHeroLevels[key];
    if (oldLevel != null && newLevel > oldLevel) {
      leveledUp.push({ key, oldLevel, newLevel });
    }
    prevHeroLevels[key] = newLevel;
  }

  if (leveledUp.length > 0) {
    sendDiscordLevelUpAlert(leveledUp);
  }
}

async function sendDiscordLevelUpAlert(levelUps) {
  if (!alertSettings.webhookUrl) return;
  const E = window.TBHEngine;
  const LEVEL_UP_COLOR = 3447003; // blue, distinct from item-grade colors

  for (const lu of levelUps) {
    const heroName = (E && E.HERO_NAMES && E.HERO_NAMES[lu.key]) || ('Hero ' + lu.key);

    // Hero portrait: points to the tbh-copilot repo for now (small, ~30x44).
    // Once the upscaled portraits from assets/heroes/ are uploaded to your
    // own GitHub repo (same migration as item icons), swap this base URL.
    const iconUrl = 'https://raw.githubusercontent.com/shigake/tbh-copilot/main/assets/game/heroes/portraits/Hero_'+lu.key+'.png';

    const embed = {
      title: heroName + ' leveled up!',
      color: LEVEL_UP_COLOR,
      fields: [
        { name: 'New Level', value: String(lu.newLevel), inline: true },
      ],
      thumbnail: { url: iconUrl },
      footer: { text: 'TBH Hub' },
      timestamp: new Date().toISOString(),
    };

    const payload = {
      content: alertSettings.userId ? '<@'+alertSettings.userId+'>' : undefined,
      username: 'TBH Hub',
      embeds: [embed],
    };

    try {
      await sendDiscordPayload(payload);
      await new Promise(r => setTimeout(r, 700));
    } catch(e) { console.error('webhook error (level up):', e); }
  }
}

function loadAlertSettings() {
  try {
    const s = localStorage.getItem('tbh_alerts');
    if (s) {
      alertSettings = { ...alertSettings, ...JSON.parse(s) };
      const wu = document.getElementById('alertWebhookUrl');
      const ui = document.getElementById('alertUserId');
      const mg = document.getElementById('alertMinGrade');
      if (wu) wu.value = alertSettings.webhookUrl;
      if (ui) ui.value = alertSettings.userId;
      if (mg) mg.value = alertSettings.minGrade;
      updateAlertStatus();
    }
  } catch(e) {}
}

function saveAlertSettings() {
  alertSettings.webhookUrl = document.getElementById('alertWebhookUrl')?.value || '';
  alertSettings.userId = document.getElementById('alertUserId')?.value || '';
  alertSettings.minGrade = document.getElementById('alertMinGrade')?.value || 'LEGENDARY';
  localStorage.setItem('tbh_alerts', JSON.stringify(alertSettings));
  updateAlertStatus();
}

function updateAlertStatus() {
  const el = document.getElementById('alertStatus');
  if (!el) return;
  if (alertSettings.webhookUrl) {
    el.textContent = 'configured · ' + (alertSettings.minGrade.charAt(0)+alertSettings.minGrade.slice(1).toLowerCase()) + ' +';
    el.style.whiteSpace = 'nowrap';
    el.style.color = 'var(--good)';
  } else {
    el.textContent = 'not configured';
    el.style.color = 'var(--mut)';
  }
}

async function testWebhook() {
  const statusEl = document.getElementById('alertStatus');
  if (!alertSettings.webhookUrl) {
    if (statusEl) { statusEl.textContent = 'enter webhook URL first'; statusEl.style.color = 'var(--bad)'; }
    return;
  }
  if (statusEl) { statusEl.textContent = 'sending...'; statusEl.style.color = ''; }
  try {
    const payload = {
      content: alertSettings.userId ? '<@'+alertSettings.userId+'>' : undefined,
      username: 'TBH Hub',
      embeds: [{
        title: '\u2705 TBH Hub Connected',
        color: 7855479,
        description: 'Drop alerts active for **'+(alertSettings.minGrade.charAt(0)+alertSettings.minGrade.slice(1).toLowerCase())+' +**',
        footer: { text: 'TBH Hub v0.1.0' },
        timestamp: new Date().toISOString()
      }]
    };
    await sendDiscordPayload(payload);
    if (statusEl) { statusEl.textContent = 'test sent \u2713'; statusEl.style.color = 'var(--good)'; }
  } catch(e) {
    if (statusEl) { statusEl.textContent = 'error: '+e.message; statusEl.style.color = 'var(--bad)'; }
  }
}


// ── AUTO CLEAR-TIME DETECTION ──
let clearTracker = { stageKey: null, lastWave: null, clearStartTime: null };
const MAX_CLEAR_SAMPLES = 5;

function loadClearSamples() {
  try {
    const s = localStorage.getItem('tbh_clear_samples');
    return s ? JSON.parse(s) : {};
  } catch(e) { return {}; }
}

function saveClearSamples(samples) {
  try { localStorage.setItem('tbh_clear_samples', JSON.stringify(samples)); } catch(e) {}
}

function detectClear(stageKey, wave) {
  const now = Date.now();
  const isResetWave = (wave === 0 || wave === 1);

  if (clearTracker.stageKey !== stageKey) {
    // The save's currentStageKey often lags behind the stage actually
    // being farmed (it can take a while for the game to write the new
    // value). If we wiped clearStartTime/lastWave every time this label
    // changes, a transient/late update mid-clear would discard the timer
    // and the clear would never get recorded.
    //
    // So: just relabel the tracker to the new stageKey, but keep the
    // in-progress timing. The eventual recordClearSample() call below uses
    // whatever stageKey is current AT THE MOMENT THE CLEAR FINISHES (wave
    // resets to 0/1) - by then (clears take minutes), currentStageKey has
    // almost always caught up to the real stage.
    clearTracker.stageKey = stageKey;
    if (clearTracker.lastWave === null) {
      clearTracker.lastWave = wave;
      clearTracker.clearStartTime = (isResetWave ? now : null);
      return;
    }
  }

  // Check for wave reset (clear completed)
  if (clearTracker.lastWave !== null && isResetWave && clearTracker.lastWave > 1 && clearTracker.clearStartTime) {
    const elapsed = (now - clearTracker.clearStartTime) / 1000;
    if (elapsed > 1 && elapsed < 1800) { // sanity bounds: 1s to 30min
      recordClearSample(stageKey, elapsed);
    }
    clearTracker.clearStartTime = now;
  } else if (isResetWave && clearTracker.clearStartTime === null) {
    clearTracker.clearStartTime = now;
  }

  clearTracker.lastWave = wave;
}

function recordClearSample(stageKey, seconds) {
  const samples = loadClearSamples();
  if (!samples[stageKey]) samples[stageKey] = [];
  samples[stageKey].push(seconds);
  if (samples[stageKey].length > MAX_CLEAR_SAMPLES) samples[stageKey].shift();
  saveClearSamples(samples);
  
  // Auto-fill the corresponding input if it exists
  applyAutoClearTime(stageKey);
}

function median(arr) {
  const sorted = [...arr].sort((a,b) => a-b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
}

function getAvgClearTime(stageKey) {
  const samples = loadClearSamples();
  const arr = samples[stageKey];
  if (!arr || arr.length === 0) return null;

  // Filter outliers: discard samples that deviate too much from the median.
  // This prevents a single slow/interrupted run (e.g. lag, AFK, stage switch
  // mid-clear) from skewing the average used for farm calculations.
  let filtered = arr;
  if (arr.length >= 3) {
    const med = median(arr);
    filtered = arr.filter(v => v <= med * 1.4 && v >= med * 0.6);
    if (filtered.length === 0) filtered = arr; // safety: never end up empty
  }

  const avg = filtered.reduce((a,b) => a+b, 0) / filtered.length;
  return { avg: Math.round(avg), count: arr.length, usedCount: filtered.length };
}

function autoClearBadge(count) {
  const pct = Math.min(count / MAX_CLEAR_SAMPLES, 1) * 100;
  const color = count >= MAX_CLEAR_SAMPLES ? 'var(--good)' : 'var(--exp)';
  return '<div style="position:absolute;left:0;right:0;bottom:-3px;height:2px;background:var(--line2);border-radius:1px;overflow:hidden" title="'+count+'/'+MAX_CLEAR_SAMPLES+' clears measured">'+
    '<div style="width:'+pct+'%;height:100%;background:'+color+';transition:width 0.3s"></div>'+
  '</div>';
}

function applyAutoClearTime(stageKey) {
  const result = getAvgClearTime(stageKey);
  if (!result) return;

  // Check if this is the 1-1 anchor
  if (stageKey === '1101') {
    const inp = document.getElementById('cal11');
    if (inp && !inp.dataset.userEdited) {
      inp.value = result.avg;
      inp.placeholder = result.avg + ' (auto, ' + result.count + 'x)';
      buildCalSamples();
      renderRanking();
    }
    updateAutoBadge('cal11', result.count);
    return;
  }

  // Check if this is the max stage
  const maxSel = $('calMaxSelect');
  if (maxSel && maxSel.value === stageKey) {
    const inp = document.getElementById('calMaxTime');
    if (inp && !inp.dataset.userEdited) {
      inp.value = result.avg;
      inp.placeholder = result.avg + ' (auto, ' + result.count + 'x)';
      buildCalSamples();
      renderRanking();
    }
    updateAutoBadge('calMaxTime', result.count);
    return;
  }

  // Check extra cal stages
  const extra = extraCalStages.find(e => e.key === stageKey);
  if (extra) {
    const inp = document.getElementById('inp_'+extra.id);
    if (inp && !inp.dataset.userEdited) {
      extra.time = result.avg;
      inp.value = result.avg;
      inp.placeholder = result.avg + ' (auto, ' + result.count + 'x)';
      buildCalSamples();
      renderRanking();
      saveSettings();
    }
    updateAutoBadge('inp_'+extra.id, result.count);
  }
}

function updateAutoBadge(inputId, count) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  const wrap = inp.closest('.cal-card-inp');
  if (!wrap) return;
  if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
  let badge = wrap.querySelector('.auto-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.className = 'auto-badge';
    wrap.appendChild(badge);
  }
  badge.innerHTML = autoClearBadge(count);
}

// Quando o usuário troca o stage selecionado no calMaxSelect, o badge de
// progresso de clears (X/5) precisa refletir as amostras do NOVO stage,
// não ficar "preso" no progresso do stage anterior.
function refreshMaxStageBadge() {
  const maxSel = $('calMaxSelect');
  if (!maxSel) return;
  const stageKey = maxSel.value;
  if (!stageKey) {
    clearAutoBadge('calMaxTime');
    return;
  }
  const result = getAvgClearTime(stageKey);
  if (result) {
    updateAutoBadge('calMaxTime', result.count);
  } else {
    clearAutoBadge('calMaxTime');
  }
}

function clearAutoBadge(inputId) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  const wrap = inp.closest('.cal-card-inp');
  if (!wrap) return;
  const badge = wrap.querySelector('.auto-badge');
  if (badge) badge.remove();
}


// ── STAGE PICKER MODAL ──
function openStagePicker() {
  const modal = document.getElementById('stagePicker');
  if (!modal) return;
  modal.style.display = 'flex';
  renderPickerList('');
  const search = document.getElementById('pickerSearch');
  if (search) { search.value = ''; search.focus(); }
}

function closeStagePicker() {
  const modal = document.getElementById('stagePicker');
  if (modal) modal.style.display = 'none';
}

function filterPicker() {
  const q = document.getElementById('pickerSearch')?.value || '';
  renderPickerList(q);
}

function renderPickerList(query) {
  const list = document.getElementById('pickerList');
  if (!list) return;
  const used = getUsedKeys();
  const q = query.toLowerCase();

  const items = E.STAGE_ORDER
    .map(k => [k, E.STAGES[k]])
    .filter(([k, s]) => {
      if (!s) return false;
      if (used.has(k)) return false;
      if (!q) return true;
      const label = (E.DIFF_LABEL[s.diff]+' '+s.label+' '+s.name).toLowerCase();
      return label.includes(q);
    });

  list.innerHTML = items.map(([k, s]) => {
    const dc = DIFF_COLOR[s.diff] || 'var(--ink)';
    const diff = E.DIFF_LABEL[s.diff] || s.diff;
    return '<div class="picker-item" data-key="'+k+'" style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--line);cursor:pointer;">'+
      '<span style="font-size:10px;color:var(--mut);background:var(--panel2);border:1px solid var(--line2);padding:2px 6px;white-space:nowrap;min-width:28px;text-align:center">'+s.label+'</span>'+
      '<div>'+
        '<div style="font-size:12px;font-weight:600;color:'+dc+'">'+diff+' '+s.label+' — '+s.name+'</div>'+
        '<div style="font-size:10px;color:var(--dim)">'+diff+' · Lv '+s.lvl+'</div>'+
      '</div>'+
    '</div>';
  }).join('') || '<div style="padding:20px;text-align:center;color:var(--mut);font-size:12px;">no stages available</div>';

  list.querySelectorAll('.picker-item').forEach(el => {
    el.addEventListener('mouseenter', () => el.style.background = 'var(--panel2)');
    el.addEventListener('mouseleave', () => el.style.background = '');
    el.addEventListener('click', () => {
      const key = el.dataset.key;
      closeStagePicker();
      addExtraCalCard(key);
    });
  });
}

// ── TABS ──
function switchTab(tab){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  document.querySelectorAll('.pane').forEach(p=>p.classList.remove('on'));
  const btn=document.querySelector('[data-tab="'+tab+'"]');
  if(btn) btn.classList.add('on');
  const pane=$('pane-'+tab);
  if(pane) pane.classList.add('on');
  setText('titlePage',tab);
}

// ── TICK ──
function startTick(){
  if(sessionTick) clearInterval(sessionTick);
  sessionTick=setInterval(()=>{
    setText('sbarSession',LiveTracker.fmtDuration(LiveTracker.getSessionDuration()));
    setText('liveSession',LiveTracker.fmtDuration(LiveTracker.getSessionDuration()));
    setText('sbarTime',new Date().toLocaleTimeString(navigator.language,{hour:'2-digit',minute:'2-digit'}));
    if(lastSaveTime){const ago=Math.round((Date.now()-lastSaveTime)/1000);setText('liveLastUpdate','updated '+ago+'s');}
  },1000);
}

function resetSession(){LiveTracker.resetSession();setText('liveXPHr','—');setText('liveGoldHr','—');setText('liveBoxes','0');}

// ── LISTENERS ──
document.addEventListener('DOMContentLoaded',()=>{
  $('btnMin')?.addEventListener('click',()=>window.tbh.minimize());
  $('btnMax')?.addEventListener('click',()=>window.tbh.maximize());
  $('btnClose')?.addEventListener('click',()=>window.tbh.close());
  $('btnRetry')?.addEventListener('click',retryLoad);
  $('btnResetCal')?.addEventListener('click',resetCal);
  $('btnResetSession')?.addEventListener('click',resetSession);
  $('btnSuggestCal')?.addEventListener('click',suggestCalStage);
  $('btnAddCal')?.addEventListener('click', openStagePicker);
  $('closePickerBtn')?.addEventListener('click', closeStagePicker);
  $('pickerSearch')?.addEventListener('input', filterPicker);
  $('sortBtnExp')?.addEventListener('click',()=>setSort('exp'));
  $('sortBtnGold')?.addEventListener('click',()=>setSort('gold'));
  $('sortBtnBal')?.addEventListener('click',()=>setSort('bal'));
  document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>switchTab(t.dataset.tab)));
  $('cal11')?.addEventListener('input',()=>{$('cal11').dataset.userEdited='1';onCalChange();});
  $('calMaxTime')?.addEventListener('input',()=>{$('calMaxTime').dataset.userEdited='1';onCalChange();});
  $('calMaxSelect')?.addEventListener('change',()=>{$('calMaxSelect').dataset.userChanged='1';updateCalMaxLabel();onCalChange();refreshMaxStageBadge();});
  $('heroSelect')?.addEventListener('change',()=>{selectedHeroKey=parseInt($('heroSelect').value);saveSettings();renderRanking();});
  $('alertWebhookUrl')?.addEventListener('input', saveAlertSettings);
  $('alertWebhookUrl')?.addEventListener('change', saveAlertSettings);
  $('alertUserId')?.addEventListener('input', saveAlertSettings);
  $('alertUserId')?.addEventListener('change', saveAlertSettings);
  $('alertMinGrade')?.addEventListener('change', saveAlertSettings);
  $('btnTestWebhook')?.addEventListener('click', testWebhook);

  // Steam tab: manual refresh button
  $('btnRefreshPrices')?.addEventListener('click', async () => {
    const statusEl = $('steamRefreshStatus');
    if (statusEl) { statusEl.textContent = 'refreshing...'; statusEl.style.color = 'var(--mut)'; }
    // Clear cache to force full refetch
    itemPriceCache = {};
    try { localStorage.removeItem('tbh_item_prices'); } catch(e) {}
    invInitialized = false;
    await calcInventoryValue();
    if (statusEl) { statusEl.textContent = 'done ✓'; statusEl.style.color = 'var(--good)';
      setTimeout(() => { if(statusEl) statusEl.textContent = ''; }, 3000); }
  });
  init();
});
