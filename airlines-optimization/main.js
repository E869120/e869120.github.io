(() => {
'use strict';

/* ----------------------------- constants ----------------------------- */
const START = 6 * 60;      // 06:00
const END = 21 * 60;       // 21:00
const STEP = 5;            // 5 minutes
const TARGET_TIMES = (() => {
  const arr = [];
  for (let t = 11 * 60; t <= 21 * 60; t += 30) arr.push(t);
  return arr;
})();

/* ----------------------------- DOM helpers ----------------------------- */
const $ = (id) => document.getElementById(id);
const seedInput = $('seedInput');
const casesInput = $('casesInput');
const downloadBtn = $('downloadBtn');
const inputArea = $('inputArea');
const outputArea = $('outputArea');
const vizBtn = $('vizBtn');
const pngBtn = $('pngBtn');
const statusEl = $('status');
const scoreText = $('scoreText');
const errorText = $('errorText');
const canvas = $('scheduleCanvas');
const ctx = canvas.getContext('2d');
const themeSelect = $('themeSelect');

const rmLeft = $('rmLeft');
const rmRight = $('rmRight');
const barSq = $('barSq');
const barCi = $('barCi');
const valSq = $('valSq');
const valCi = $('valCi');

/* ----------------------------- utilities ----------------------------- */
function clamp(x, lo, hi){ return Math.max(lo, Math.min(hi, x)); }
function pad2(n){ return String(n).padStart(2, '0'); }
function formatTime(min){
  if (min < 0) return '---';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${pad2(h)}:${pad2(m)}`;
}
function parseTime(s){
  const m = /^(\d\d):(\d\d)$/.exec(s);
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  return hh * 60 + mm;
}
function isStepTime(min){ return (min - START) % STEP === 0 && min >= START && min <= END; }

function tokenize(text){
  return text.trim().length ? text.trim().split(/\s+/) : [];
}

function fmtBig(n){
  // BigInt with comma separators
  const s = n.toString();
  const neg = s.startsWith('-');
  const t = neg ? s.slice(1) : s;
  const out = t.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return neg ? '-' + out : out;
}

function setStatus(msg){ statusEl.textContent = msg; }

function colorWithAlpha(cssColor, alpha){
  const c = (cssColor || '').trim();
  let r=255, g=255, b=255;
  if (c.startsWith('#')){
    const h = c.slice(1);
    if (h.length === 3){
      r = parseInt(h[0]+h[0], 16);
      g = parseInt(h[1]+h[1], 16);
      b = parseInt(h[2]+h[2], 16);
    }else if (h.length >= 6){
      r = parseInt(h.slice(0,2), 16);
      g = parseInt(h.slice(2,4), 16);
      b = parseInt(h.slice(4,6), 16);
    }
  }else{
    const m = /^rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c);
    if (m){ r = Number(m[1]); g = Number(m[2]); b = Number(m[3]); }
  }
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ----------------------------- RNG (xorshift32) ----------------------------- */
class XorShift32 {
  constructor(seed){
    // keep non-zero
    let x = (seed >>> 0);
    if (x === 0) x = 2463534242;
    this.x = x;
  }
  nextU32(){
    // xorshift32
    let x = this.x >>> 0;
    x ^= (x << 13) >>> 0;
    x ^= (x >>> 17) >>> 0;
    x ^= (x << 5) >>> 0;
    this.x = x >>> 0;
    return this.x;
  }
  next(){
    return this.nextU32() / 4294967296; // [0,1)
  }
  int(lo, hi){ // inclusive
    const r = this.nextU32();
    const span = (hi - lo + 1) >>> 0;
    return lo + (r % span);
  }
  real(lo, hi){
    return lo + (hi - lo) * this.next();
  }
}

/* ----------------------------- generator ----------------------------- */
function generateCase(seed){
  const rng = new XorShift32(seed);
  // Problem constants
  const N = 47, R = 1000, M = 400, K = 25;

  const R2 = R * R;

  function randPointInCircle(){
    while (true){
      const x = rng.int(-R, R);
      const y = rng.int(-R, R);
      if (x*x + y*y <= R2) return [x, y];
    }
  }
  function genCities(){
    const cities = [];
    for (let i = 0; i < N; i++){
      const [x, y] = randPointInCircle();
      const w = Math.floor(1e7 / rng.real(1, 100));
      cities.push({x, y, w});
    }
    cities.sort((a,b) => b.w - a.w);
    return cities;
  }
  function dist(c1, c2){
    const dx = c1.x - c2.x, dy = c1.y - c2.y;
    return Math.hypot(dx, dy);
  }
  function duration(c1, c2){
    const d = dist(c1, c2);
    // NOTE: official formula is 60*d/800 + 40, then ceil to 5-minute grid.
    const raw = 60 * d / 800 + 40;
    // ceil to 5-min; epsilon to fight floating
    const q = raw / 5 - 1e-12;
    return Math.ceil(q) * 5;
  }
  function pickWeighted(cities){
    let sum = 0;
    for (const c of cities) sum += c.w;
    let r = rng.real(0, sum);
    for (let i = 0; i < cities.length; i++){
      r -= cities[i].w;
      if (r <= 0) return i;
    }
    return cities.length - 1;
  }
  function pickTime(){
    const steps = Math.floor((END - START) / STEP);
    return START + rng.int(0, steps) * STEP;
  }

  while (true){
    const cities = genCities();

    // ensure at least one pair with dist >= 0.25R
    let ok = false;
    for (let i = 0; i < N && !ok; i++){
      for (let j = 0; j < N; j++){
        if (i === j) continue;
        if (dist(cities[i], cities[j]) >= 0.25 * R){ ok = true; break; }
      }
    }
    if (!ok) continue;

    const flights = [];
    for (let i = 0; i < M; i++){
      while (true){
        const a = pickWeighted(cities);
        const b = pickWeighted(cities);
        if (a === b) continue;
        const t = pickTime();
        const dur = duration(cities[a], cities[b]);
        const s = t - dur;
        if (s < START) continue;
        flights.push({a: a+1, s, b: b+1, t});
        break;
      }
    }

    // stringify
    const lines = [];
    lines.push(`${N} ${R}`);
    for (let i = 0; i < N; i++){
      const c = cities[i];
      lines.push(`${c.x} ${c.y} ${c.w}`);
    }
    lines.push(`${M}`);
    for (const f of flights){
      lines.push(`${f.a} ${formatTime(f.s)} ${f.b} ${formatTime(f.t)}`);
    }
    lines.push(`${K}`);
    // Windows環境での誤検知防止と互換性のため、CRLF(\r\n)で結合します
    return lines.join('\r\n');
  }
}

function downloadTextFile(filename, text){
  const blob = new Blob([text], {type: 'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ----------------------------- ZIP (Deflate) for Download ----------------------------- */
async function downloadZip(filename, files){
  try {
    // 高速・軽量な圧縮ライブラリ fflate を CDN から動的インポート
    const fflate = await import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js');
    
    // fflate用のオブジェクトに変換
    const zipData = {};
    for (const f of files){
      zipData[f.name] = f.data;
    }
    
    // 標準的な圧縮アルゴリズム(Deflate)でZIP化
    const zipped = fflate.zipSync(zipData);
    
    const blob = new Blob([zipped], {type: 'application/zip'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (e) {
    console.error(e);
    alert("ZIP生成ライブラリの読み込みに失敗しました。インターネット接続を確認してください。");
  }
}

/* ----------------------------- parsing & validation ----------------------------- */
function parseInput(text){
  const tok = tokenize(text);
  let p = 0;
  const err = [];
  function need(){
    if (p >= tok.length){ err.push('Input is incomplete.'); return null; }
    return tok[p++];
  }
  const Ns = need(); const Rs = need();
  if (Ns === null || Rs === null) return {err, data:null};
  const N = Number(Ns), R = Number(Rs);
  if (!Number.isInteger(N) || !Number.isInteger(R)) err.push('N or R is not an integer.');
  const cities = [];
  for (let i=0;i<N;i++){
    const xs=need(), ys=need(), ws=need();
    if (xs===null||ys===null||ws===null) break;
    const x=Number(xs), y=Number(ys), w=Number(ws);
    cities.push({x,y,w});
  }
  const Ms = need();
  if (Ms===null) return {err, data:null};
  const M = Number(Ms);
  const sqFlights = [];
  for (let i=0;i<M;i++){
    const aS=need(), sS=need(), bS=need(), tS=need();
    if (aS===null||sS===null||bS===null||tS===null) break;
    const a=Number(aS)-1, b=Number(bS)-1;
    const s=parseTime(sS), t=parseTime(tS);
    sqFlights.push({from:a, to:b, dep:s, arr:t});
  }
  const Ks = need();
  const K = Ks===null ? null : Number(Ks);

  if (err.length) return {err, data:null};

  return {err:[], data:{N,R,cities,M,sqFlights,K}};
}

function buildDurations(data){
  const {N, cities} = data;
  const dur = Array.from({length:N}, () => new Int16Array(N));
  const dist = Array.from({length:N}, () => new Float64Array(N));
  for (let i=0;i<N;i++){
    for (let j=0;j<N;j++){
      const dx = cities[i].x - cities[j].x;
      const dy = cities[i].y - cities[j].y;
      const d = Math.hypot(dx, dy);
      dist[i][j] = d;
      const raw = 60 * d / 800 + 40;
      const q = raw / 5 - 1e-12;
      const minutes = Math.ceil(q) * 5;
      dur[i][j] = minutes;
    }
  }
  return {dur, dist};
}

function validateAndParseOutput(text, data, dur){
  const tok = tokenize(text);
  let p = 0;
  const errors = [];
  const K = data.K;
  if (!Number.isInteger(K)) errors.push('Input K is invalid.');
  const planes = [];
  const allFlights = [];

  function readInt(label){
    if (p >= tok.length){ errors.push(`Output ended early while reading ${label}.`); return null; }
    const v = Number(tok[p++]);
    if (!Number.isInteger(v)) { errors.push(`${label} is not an integer.`); return null; }
    return v;
  }
  function readTime(label){
    if (p >= tok.length){ errors.push(`Output ended early while reading ${label}.`); return null; }
    const s = tok[p++];
    const t = parseTime(s);
    if (t === null){ errors.push(`${label} is not HH:MM: ${s}`); return null; }
    return t;
  }

  for (let i=0;i<K;i++){
    const c = readInt(`c_${i+1}`);
    if (c === null) break;
    if (c < 0) errors.push(`c_${i+1} must be >= 0.`);
    const flights = [];
    let prevB = null;
    let prevArr = null;
    for (let j=0;j<c;j++){
      const a1 = readInt(`a_${i+1},${j+1}`);
      const s = readTime(`s_${i+1},${j+1}`);
      const b1 = readInt(`b_${i+1},${j+1}`);
      const t = readTime(`t_${i+1},${j+1}`);
      if (a1===null||s===null||b1===null||t===null) break;

      const a = a1 - 1, b = b1 - 1;

      if (!(0 <= a && a < data.N)) errors.push(`City index out of range: a=${a1}`);
      if (!(0 <= b && b < data.N)) errors.push(`City index out of range: b=${b1}`);
      if (a === b) errors.push(`a == b at plane ${i+1} flight ${j+1}`);
      if (!isStepTime(s)) errors.push(`Departure time must be 5-min grid within 06:00-21:00: ${formatTime(s)} (plane ${i+1} flight ${j+1})`);
      if (!isStepTime(t)) errors.push(`Arrival time must be 5-min grid within 06:00-21:00: ${formatTime(t)} (plane ${i+1} flight ${j+1})`);
      if (t < s) errors.push(`Arrival time is earlier than departure time (plane ${i+1} flight ${j+1})`);
      if (t > END) errors.push(`The arrival time is later than 21:00 (plane ${i+1} flight ${j+1})`);
      if (s < START) errors.push(`The departure time is earlier than 06:00 (plane ${i+1} flight ${j+1})`);

      if (prevB !== null){
        if (prevB !== a) errors.push(`Connection city mismatch: previous b != next a (plane ${i+1}, flight ${j})`);
        if (prevArr !== null && prevArr > s) errors.push(`Time order violation: t_{j} > s_{j+1} (plane ${i+1}, between flight ${j} and ${j+1})`);
      }
      prevB = b;
      prevArr = t;

      if (0 <= a && a < data.N && 0 <= b && b < data.N){
        const needDur = dur[a][b];
        const gotDur = t - s;
        if (gotDur !== needDur){
          errors.push(`Invalid duration (plane ${i+1} flight ${j+1}): got ${gotDur}min, expected ${needDur}min`);
        }
      }

      const ff = {from:a, to:b, dep:s, arr:t, plane:i};
      flights.push(ff);
      allFlights.push(ff);
    }
    planes.push({c, flights});
  }

  if (errors.length) return {errors, planes, allFlights};

  if (p < tok.length){
    // treat as warning, not fatal
    // but show as error for strictness? We'll warn in status.
    setStatus(`Warning: output has extra tokens (${tok.length - p}). Ignored.`);
  }

  return {errors:[], planes, allFlights};
}

/* ----------------------------- routing / scoring ----------------------------- */
function sortFlightsDesc(flights){
  const arr = flights.slice();
  arr.sort((a,b) => (b.dep - a.dep) || (b.arr - a.arr));
  return arr;
}

function computeLatestDeparturesForDest(flightsDesc, N, dest, deadline){
  // dp[city] = latest departure time to reach dest by deadline; -1 means -inf
  const dp = new Int16Array(N);
  dp.fill(-1);
  dp[dest] = deadline;
  for (let i=0;i<flightsDesc.length;i++){
    const f = flightsDesc[i];
    const toOk = dp[f.to] >= f.arr;
    if (toOk && f.dep > dp[f.from]){
      dp[f.from] = f.dep;
    }
  }
  return dp;
}

function computeAllDP(flightsDesc, N){
  const dpAll = Array.from({length:N}, () => Array(TARGET_TIMES.length));
  for (let dest=0; dest<N; dest++){
    for (let k=0;k<TARGET_TIMES.length;k++){
      dpAll[dest][k] = computeLatestDeparturesForDest(flightsDesc, N, dest, TARGET_TIMES[k]);
    }
  }
  return dpAll;
}

function computeScoreAndShare(data, durDist, circleFlights){
  const N = data.N;
  const R = data.R;
  const {dist} = durDist;

  // eligibility and weight products
  const eligible = Array.from({length:N}, () => new Uint8Array(N));
  const wProd = Array.from({length:N}, () => Array(N));
  for (let i=0;i<N;i++){
    for (let j=0;j<N;j++){
      eligible[i][j] = (i!==j && dist[i][j] >= 0.25 * R) ? 1 : 0;
      wProd[i][j] = BigInt(data.cities[i].w) * BigInt(data.cities[j].w);
    }
  }

  const sqDesc = sortFlightsDesc(data.sqFlights);
  const ciDesc = sortFlightsDesc(circleFlights);

  const dpSq = computeAllDP(sqDesc, N);
  const dpCi = computeAllDP(ciDesc, N);

  let vSq = 0n, vCi = 0n;
  for (let dest=0; dest<N; dest++){
    for (let k=0;k<TARGET_TIMES.length;k++){
      const dsq = dpSq[dest][k];
      const dci = dpCi[dest][k];
      for (let src=0; src<N; src++){
        if (!eligible[src][dest]) continue;
        const w = wProd[src][dest];
        if (dsq[src] < dci[src]) vCi += w;
        else vSq += w;
      }
    }
  }
  const total = vSq + vCi;
  const score = (total === 0n) ? 0n : (1000000n * vCi) / total;
  return {vSq, vCi, total, score, dpSq, dpCi};
}

/* ----------------------------- drawing: schedule ----------------------------- */
function drawSchedule(planes, expectedK){
  // resize canvas to displayed size (avoid overflow + keep text crisp)
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(1, Math.floor(rect.width));
  const cssH = Math.max(1, Math.floor(rect.height));
  const dpr = window.devicePixelRatio || 1;
  const needW = Math.floor(cssW * dpr);
  const needH = Math.floor(cssH * dpr);
  if (canvas.width !== needW || canvas.height !== needH){
    canvas.width = needW;
    canvas.height = needH;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // compute layout
  const K = (Number.isInteger(expectedK) && expectedK > 0)
    ? expectedK
    : Math.max(1, planes.length || 1);
  const W = cssW;
  const H = cssH;

  // clear
  ctx.clearRect(0, 0, W, H);

  // colors derived from CSS vars:
  const style = getComputedStyle(document.body);
  const grid = style.getPropertyValue('--grid').trim();
  const line = style.getPropertyValue('--line').trim();
  const muted = style.getPropertyValue('--muted').trim();
  const ci = style.getPropertyValue('--ci').trim();
  const mono = style.getPropertyValue('--mono').trim();

  const marginL = 40;
  const marginR = 24;
  const marginT = 10;
  const marginB = 34;
  const plotW = W - marginL - marginR;
  const plotH = H - marginT - marginB;
  const rowH = plotH / K;

  function xOf(min){
    const t = (min - START) / (END - START);
    return marginL + t * plotW;
  }

  // grid vertical: every 30 min, thicker at hour
  for (let m = START; m <= END; m += 30){
    const x = xOf(m);
    ctx.strokeStyle = grid;
    ctx.lineWidth = (m % 60 === 0) ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(x, marginT);
    ctx.lineTo(x, marginT + plotH);
    ctx.stroke();
  }
  // horizontal lines
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  for (let i = 0; i <= K; i++){
    const y = marginT + i * rowH;
    ctx.beginPath();
    ctx.moveTo(marginL, y);
    ctx.lineTo(marginL + plotW, y);
    ctx.stroke();
  }

  // axis border
  ctx.strokeStyle = line;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(marginL, marginT, plotW, plotH);

  // y labels
  ctx.fillStyle = muted;
  ctx.font = `12px ${mono}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (let i = 0; i < K; i++){
    const y = marginT + (i + 0.5) * rowH;
    ctx.fillText(String(i + 1), 12, y);
  }

  // x labels at 6,9,12,15,18,21 (make sure 21:00 isn't clipped)
  ctx.textBaseline = 'alphabetic';
  ctx.font = `12px ${mono}`;
  ctx.fillStyle = muted;
  const labelHours = [6, 9, 12, 15, 18, 21];
  for (const h of labelHours){
    const m = h * 60;
    const x = xOf(m);
    if (h === 6) ctx.textAlign = 'left';
    else if (h === 21) ctx.textAlign = 'right';
    else ctx.textAlign = 'center';
    ctx.fillText(`${h}:00`, x, H - 12);
  }

  // draw flights (alternate shade per flight within each plane)
  const ciStrong = colorWithAlpha(ci, 0.95);
  const ciLight = colorWithAlpha(ci, 0.55);
  const labelFont = `10px ${mono}`;

  for (let i = 0; i < K; i++){
    const row = planes[i] ? planes[i].flights : [];
    for (let j = 0; j < row.length; j++){
      const f = row[j];
      const fill = (j % 2 === 0) ? ciStrong : ciLight;
      const x1 = xOf(f.dep);
      const x2 = xOf(f.arr);
      const y1 = marginT + i * rowH + 2;
      const hh = rowH - 4;
      const ww = Math.max(1, x2 - x1);

      ctx.fillStyle = fill;
      ctx.fillRect(x1, y1, ww, hh);

      // label if space
      const label = `${f.from + 1}→${f.to + 1}`;
      ctx.font = labelFont;
      const tw = ctx.measureText(label).width;
      if (tw + 6 <= ww){
        ctx.fillStyle = 'white';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(label, x1 + 3, y1 + hh / 2);
      }
    }
  }
}

function saveCanvasAsPng(){
  const a = document.createElement('a');
  a.download = 'schedule.png';
  a.href = canvas.toDataURL('image/png');
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ----------------------------- Share Graph ----------------------------- */
function updateShareGraph(vSq, vCi){
  // values shown are divided by 1e10
  const vSq10 = vSq / 10000000000n;
  const vCi10 = vCi / 10000000000n;
  valSq.textContent = fmtBig(vSq10);
  valCi.textContent = fmtBig(vCi10);

  const max = (vSq10 > vCi10) ? vSq10 : vCi10;
  const denom = max === 0n ? 1 : Number(max);
  const wSq = max === 0n ? 0 : (Number(vSq10) / denom) * 100;
  const wCi = max === 0n ? 0 : (Number(vCi10) / denom) * 100;

  barSq.style.width = `${clamp(wSq, 0, 100)}%`;
  barCi.style.width = `${clamp(wCi, 0, 100)}%`;
}

/* ----------------------------- Random Moves ----------------------------- */
function buildWeightedPicker(weights){
  const prefix = new Float64Array(weights.length);
  let sum = 0;
  for (let i=0;i<weights.length;i++){
    sum += weights[i];
    prefix[i] = sum;
  }
  return {
    sum,
    pick(rng){
      let r = rng.real(0, sum);
      // binary search
      let lo=0, hi=prefix.length-1;
      while (lo<hi){
        const mid = (lo+hi)>>1;
        if (r < prefix[mid]) hi = mid;
        else lo = mid+1;
      }
      return lo;
    }
  };
}

function updateRandomMoves(data, dist, dpSq, dpCi){
  rmLeft.innerHTML = '';
  rmRight.innerHTML = '';

  const seed = Number(seedInput.value || 0);
  const rng = new XorShift32((seed ^ 0x9e3779b9) >>> 0);

  const N = data.N;
  const w = data.cities.map(c => c.w);
  const picker = buildWeightedPicker(w);

  const rows = [];
  const want = 32;

  let guard = 0;
  while (rows.length < want && guard < 20000){
    guard++;
    const a = picker.pick(rng);
    const b = picker.pick(rng);
    if (a === b) continue;
    if (dist[a][b] < 0.25 * data.R) continue; // keep consistent with scoring pairs
    const k = rng.int(0, TARGET_TIMES.length-1);
    const T = TARGET_TIMES[k];

    const sSq = dpSq[b][k][a];
    const sCi = dpCi[b][k][a];

    rows.push({
      city: `${a+1}→${b+1}`,
      time: formatTime(T),
      sq: formatTime(sSq),
      ci: formatTime(sCi),
      sqRaw: sSq,
      ciRaw: sCi,
    });
  }

  const half = Math.ceil(rows.length / 2);
  const left = rows.slice(0, half);
  const right = rows.slice(half);

  function addRow(tbody, r){
    const tr = document.createElement('tr');

    // Determine winner: later departure time is better; ties go to Square.
    let win = 'sq';
    if (r.sqRaw < 0 && r.ciRaw >= 0) win = 'ci';
    else if (r.sqRaw >= 0 && r.ciRaw < 0) win = 'sq';
    else if (r.sqRaw >= 0 && r.ciRaw >= 0){
      win = (r.sqRaw >= r.ciRaw) ? 'sq' : 'ci';
    }else{
      win = 'sq'; // both --- : treat as tie
    }

    const sqCls = `sq${win === 'sq' ? ' win-sq' : ''}`;
    const ciCls = `ci${win === 'ci' ? ' win-ci' : ''}`;
    tr.innerHTML = `<td>${r.city}</td><td>${r.time}</td><td class="${sqCls}">${r.sq}</td><td class="${ciCls}">${r.ci}</td>`;
    tbody.appendChild(tr);
  }
  for (const r of left) addRow(rmLeft, r);
  for (const r of right) addRow(rmRight, r);

  // fill empty rows for aesthetics
  const padTo = Math.ceil(want / 2);
  function pad(tbody){
    while (tbody.children.length < padTo){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>&nbsp;</td><td></td><td class="sq"></td><td class="ci"></td>`;
      tbody.appendChild(tr);
    }
  }
  pad(rmLeft); pad(rmRight);
}

/* ----------------------------- main visualize ----------------------------- */
function visualize(){
  setStatus('');
  errorText.textContent = '';
  scoreText.textContent = 'Score = —';
  updateShareGraph(0n, 0n);
  rmLeft.innerHTML = ''; rmRight.innerHTML = '';

  const inText = inputArea.value;
  const outText = outputArea.value;

  const parsed = parseInput(inText);
  if (parsed.err.length){
    errorText.textContent = parsed.err.join('\n');
    return;
  }
  const data = parsed.data;

  const durDist = buildDurations(data);

  const out = validateAndParseOutput(outText, data, durDist.dur);
  if (out.errors.length){
    // invalid => score 0, show errors
    scoreText.textContent = 'Score = 0';
    errorText.textContent = out.errors.join('\n');
    // still draw what we can
    drawSchedule(out.planes, data.K);
    return;
  }

  // score + share
  const scoreRes = computeScoreAndShare(data, durDist, out.allFlights);
  const scoreNum = scoreRes.score;
  const sharePct = scoreRes.total === 0n ? 0 : Number((scoreRes.vCi * 1000000n) / scoreRes.total) / 10000; // 2 decimals
  scoreText.textContent = `Score = ${fmtBig(scoreNum)} (Share: ${sharePct.toFixed(2)}%)`;

  drawSchedule(out.planes, data.K);
  updateShareGraph(scoreRes.vSq, scoreRes.vCi);
  updateRandomMoves(data, durDist.dist, scoreRes.dpSq, scoreRes.dpCi);
}

/* ----------------------------- event wiring ----------------------------- */
function loadInputForCurrentSeed(showStatus=true){
  const seed = (Number(seedInput.value || 0) >>> 0);
  try{
    inputArea.value = generateCase(seed);
    if (showStatus) setStatus(`Loaded input for seed ${seed}.`);
  }catch(e){
    console.error(e);
    if (showStatus) setStatus('Error while generating input: ' + (e && e.message ? e.message : String(e)));
  }
}

let seedDebounce = null;
seedInput.addEventListener('input', () => {
  clearTimeout(seedDebounce);
  seedDebounce = setTimeout(() => loadInputForCurrentSeed(true), 200);
});

downloadBtn.addEventListener('click', async () => {
  const seed0 = (Number(seedInput.value || 0) >>> 0);
  let cases = Number(casesInput.value || 1);
  if (!Number.isFinite(cases)) cases = 1;
  cases = Math.floor(cases);
  cases = clamp(cases, 1, 500);
  casesInput.value = String(cases);

  const enc = new TextEncoder();
  // ★ UTF-8 の BOM (Byte Order Mark) を定義
  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]); 
  
  const files = [];
  let first = '';
  for (let i = 0; i < cases; i++){
    const s = (seed0 + i) >>> 0;
    
    // ★ テキストの末尾に必ずWindows標準の改行(CRLF)を入れる
    let text = generateCase(s);
    if (!text.endsWith('\r\n')) text += '\r\n';
    
    if (i === 0) first = text;
    const name = `${String(i).padStart(4,'0')}.txt`;
    
    // ★ BOM と テキストデータを結合する
    const textBytes = enc.encode(text);
    const data = new Uint8Array(bom.length + textBytes.length);
    data.set(bom, 0);
    data.set(textBytes, bom.length);
    
    files.push({name, data});
  }

  inputArea.value = first;
  setStatus('ZIPを生成中...');
  await downloadZip(`inputs_seed${seed0}_cases${cases}.zip`, files);
  setStatus(`Generated ${cases} case(s) as ZIP. Loaded 0000.txt (seed ${seed0}) into Input.`);
});

vizBtn.addEventListener('click', () => {
  try{
    const t0 = performance.now();
    visualize();
    const t1 = performance.now();
    setStatus(`Done. (${(t1 - t0).toFixed(1)} ms)`);
  }catch(e){
    console.error(e);
    setStatus('Error: ' + (e && e.message ? e.message : String(e)));
  }
});

pngBtn.addEventListener('click', () => {
  saveCanvasAsPng();
});

themeSelect.addEventListener('change', () => {
  const v = themeSelect.value;
  document.body.classList.toggle('theme-dark', v === 'dark');
  document.body.classList.toggle('theme-light', v === 'light');
  // redraw
  try{ visualize(); }catch(_){}
});

// default theme
document.body.classList.add('theme-dark');

// initial input (seed=0)
loadInputForCurrentSeed(false);

})();