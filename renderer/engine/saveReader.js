// TBH Hub — Save File Reader
// Decrypts ES3 save file and parses player data

const SAVE_PASSWORD = 'emuMqG3bLYJ938ZDCfieWJ';

async function decryptES3(input) {
  const arr = Array.isArray(input) ? input : Array.from(new Uint8Array(input));
  const bytes = new Uint8Array(arr);
  const iv = bytes.slice(0, 16);
  const ct = bytes.slice(16);

  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey(
    'raw', enc.encode(SAVE_PASSWORD), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: iv, iterations: 100, hash: 'SHA-1' },
    base,
    { name: 'AES-CBC', length: 128 },
    false,
    ['decrypt']
  );

  let out = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, ct)
  );

  // Decompress if gzip
  if (out[0] === 0x1f && out[1] === 0x8b) {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(out);
    writer.close();
    const chunks = [];
    const reader = ds.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    let total = 0;
    chunks.forEach(c => total += c.length);
    out = new Uint8Array(total);
    let offset = 0;
    chunks.forEach(c => { out.set(c, offset); offset += c.length; });
  }

  // Remove PKCS7 padding
  const pad = out[out.length - 1];
  if (pad >= 1 && pad <= 16) out = out.slice(0, out.length - pad);

  return JSON.parse(new TextDecoder().decode(out));
}

async function parseSave(input) {
  const root = await decryptES3(input);
  // UniqueId values are 18-digit integers that exceed JS Number.MAX_SAFE_INTEGER.
  // JSON.parse truncates them silently. The reviver intercepts UniqueId fields
  // and keeps them as strings before float64 truncation occurs.
  const psd = JSON.parse(root.PlayerSaveData.value, (key, value) => {
    if (key === 'UniqueId' && typeof value === 'number') return String(value);
    return value;
  });
  const common = psd.commonSaveData;

  // Heroes
  const heroMap = {};
  (psd.heroSaveDatas || []).forEach(h => {
    heroMap[h.heroKey] = {
      key: h.heroKey,
      level: h.HeroLevel || 1,
      exp: h.HeroExp || 0,
      unlocked: h.IsUnLock !== false,
    };
  });

  const arrangedKeys = common.arrangedHeroKey || [];
  const partyHeroes = arrangedKeys.map(k => heroMap[k]).filter(Boolean);
  const maxPartyLevel = Math.max(...partyHeroes.map(h => h.level), 1);

  // Rune saves: key -> level
  const runeSaves = {};
  (psd.RuneSaveData || []).forEach(r => {
    if (r.Level > 0) runeSaves[String(r.RuneKey)] = r.Level;
  });

  // Bonuses via engine
  const bonuses = window.TBHEngine.computeBonuses(runeSaves);

  // Inventory
  const inventory = (psd.inventorySaveDatas || []).map(i => ({
    id: i.ItemId,
    qty: i.Quantity || 1,
  }));
  const stash = (psd.stashSaveDatas || []).map(i => ({
    id: i.ItemId,
    qty: i.Quantity || 1,
  }));

  // Gold in wallet
  const gold = (psd.currenySaveDatas || []).find(c => c.Key === 100001)?.Quantity || 0;

  // Boxes
  const boxTypes = psd.BoxData?.BoxTypes || [];
  const boxQty   = psd.BoxData?.BoxQuantity || [];

  // Play time
  const playTime = common.playTime || 0;

  // Raw items for drop detection — UniqueId is already a string (preserved
  // by the reviver applied to psd above, avoiding float64 truncation).
  const rawItems = (psd.itemSaveDatas || []).map(i => ({
    UniqueId: String(i.UniqueId),
    ItemKey: i.ItemKey,
  }));

  return {
    currentStageKey:  String(common.currentStageKey),
    maxCompletedStage: String(common.maxCompletedStage),
    currentWave: common.currentStageWave || 0,
    arrangedKeys,
    partyHeroes,
    heroMap,
    maxPartyLevel,
    bonuses,
    runeSaves,
    inventory,
    stash,
    gold,
    boxTypes,
    boxQty,
    playTime,
    rawItems,
  };
}

window.SaveReader = { parseSave };
