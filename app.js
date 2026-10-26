/* 模擬考檢討系統：學生頁（index.html）與老師檢查頁（review.html）共用。
   考卷資料放在 exams/<id>.json，用班級代碼加密；exams/index.json 只有考試名稱。 */
const $ = id => document.getElementById(id);
const CODE_KEY = "exam-review-code";
const ls = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
const params = new URLSearchParams(location.search);

/* ---------- 解密 ---------- */
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function decrypt(env, code){
  const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({name:"PBKDF2", salt:b64(env.salt), iterations:env.iter, hash:"SHA-256"},
    km, {name:"AES-GCM", length:256}, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({name:"AES-GCM", iv:b64(env.iv)}, key, b64(env.data));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function getJSON(url){
  const r = await fetch(url, {cache:"no-cache"});
  if(!r.ok) throw new Error(url + " " + r.status);
  return r.json();
}

/* 班級代碼畫面；通過後呼叫 onOK(index, code) */
async function gate(onOK){
  let index;
  try{ index = await getJSON("exams/index.json"); }
  catch(e){ $("gate").hidden = false; $("gerr").textContent = "讀不到考試資料，請確認網路後重新整理。"; return; }
  const tryCode = async code => {
    try{ await decrypt(index.check, code); return true; }catch(e){ return false; }
  };
  const saved = ls.get(CODE_KEY, "");
  if(saved && await tryCode(saved)) return onOK(index, saved);
  $("gate").hidden = false;
  $("gform").onsubmit = async e => {
    e.preventDefault();
    const code = $("gcode").value.trim();
    if(!code) return;
    $("gerr").textContent = "檢查中…";
    if(await tryCode(code)){ ls.set(CODE_KEY, code); $("gate").hidden = true; $("gerr").textContent = ""; onOK(index, code); }
    else $("gerr").textContent = "代碼不對，請再確認一次（問老師）。";
  };
  $("gcode").focus();
}

/* ---------- 題目渲染 ---------- */
// {key:文字} → 可標螢光筆的片段；文字裡可以放 <span class="blank">□□</span> 這類標籤
const mark = s => (s || "").replace(/\{(\w+):((?:<[^>]*>|[^}])*)\}/g, (m, k, t) => `<span class="m" data-k="${k}">${t}</span>`);
const paras = s => (s || "").split(/\n+/).map(p => `<p>${mark(p)}</p>`).join("");

function paperHTML(exam, n){
  const q = exam.questions[n], g = q.group ? exam.groups[q.group] : null;
  let h = "";
  if(g){
    if(g.title) h += `<div class="gtitle">${g.title}</div>`;
    if(g.passage) h += `<div class="passage">${paras(g.passage)}</div>`;
    if(g.img) h += `<div class="figure"><img src="${g.img}" alt="題組附圖"></div>`;
    if(g.gloss) h += `<div class="gloss">📖 ${g.gloss}</div>`;
  }
  if(q.passage){
    h += `<div><span class="qno">${n}.</span></div><div class="passage">${paras(q.passage)}</div>`;
  }
  if(q.img) h += `<div class="figure"><img src="${q.img}" alt="第 ${n} 題附圖"></div>`;
  if(q.gloss) h += `<div class="gloss">📖 ${q.gloss}</div>`;
  h += `<div>${q.passage ? "" : `<span class="qno">${n}.</span>`}${mark(q.stem)}</div><ol class="opts">`;
  for(const L of ["A","B","C","D"]) if(q.opts && q.opts[L] !== undefined)
    h += `<li class="opt" data-o="${L}"><span class="L">(${L})</span>${mark(q.opts[L])}</li>`;
  return h + "</ol>";
}

function videoEmbed(url){
  if(!url) return null;
  let m = url.match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/);
  if(m) return `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0&playsinline=1`;
  m = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
  if(m) return `https://drive.google.com/file/d/${m[1]}/preview`;
  return null;
}
const hasSteps = q => !!(q && q.steps && q.steps.length);
const isReady = q => hasSteps(q) || !!(q && q.video);

/* ---------- 學生頁 ---------- */
function studentApp(){
  let exam = null, cur = null, idx = -1, playing = false, token = 0, rate = 1;
  const stKey = () => "exam-review-st-" + exam.id;

  gate((index, code) => {
    const list = index.exams.filter(e => !e.hidden || params.get("all") === "1");
    const want = params.get("exam");
    if(want && index.exams.some(e => e.id === want)) return openExam(want, code, params.get("q"));
    $("list").hidden = false;
    $("exams").innerHTML = "";
    if(!list.length) $("exams").innerHTML = `<div class="box">還沒有可以檢討的考試。</div>`;
    for(const e of list){
      const b = document.createElement("button");
      b.className = "exam";
      b.innerHTML = `<div><b>${e.title}</b><span>${e.subject || ""}　${e.date || ""}　有講解 ${e.ready}／${e.total} 題</span></div><span class="go">進入 →</span>`;
      b.onclick = () => openExam(e.id, code);
      $("exams").append(b);
    }
  });

  async function openExam(id, code, q){
    $("list").hidden = true;
    try{ exam = await decrypt(await getJSON(`exams/${id}.json`), code); exam.id = id; }
    catch(e){ $("list").hidden = false; $("exams").insertAdjacentHTML("afterbegin", `<div class="box err">這份考試打不開，請重新整理再試一次。</div>`); return; }
    document.title = exam.title + "　檢討";
    $("etitle").textContent = exam.title + "　檢討";
    const ready = Object.values(exam.questions).filter(isReady).length;
    $("esub").textContent = `${exam.subject || ""}．共 ${exam.total} 題．有講解 ${ready} 題`;
    $("toList").hidden = !!params.get("exam") && !document.referrer;
    drawGrid();
    $("home").hidden = false;
    if(q && isReady(exam.questions[q])) openQ(q);
  }
  $("toList").onclick = () => { stop(); $("home").hidden = true; $("list").hidden = false; };

  function drawGrid(){
    const st = ls.get(stKey(), {});
    const g = $("grids"); g.innerHTML = "";
    const sections = exam.sections && exam.sections.length ? exam.sections : [{name:"", from:1, to:exam.total}];
    for(const s of sections){
      if(s.name){ const h = document.createElement("div"); h.className = "sec"; h.textContent = s.name; g.append(h); }
      const grid = document.createElement("div"); grid.className = "grid";
      for(let n = s.from; n <= s.to; n++){
        const btn = document.createElement("button"), q = exam.questions[n];
        btn.className = "num"; btn.textContent = n;
        if(isReady(q)){
          btn.classList.add("ready");
          if(st[n] === "ok") btn.classList.add("st-ok");
          if(st[n] === "no") btn.classList.add("st-no");
          const sm = document.createElement("small");
          sm.textContent = st[n] === "ok" ? "懂了" : st[n] === "no" ? "不懂" : q.video ? "有影片" : "有講解";
          btn.append(sm);
          btn.onclick = () => openQ(String(n));
        } else { btn.disabled = true; btn.title = "這題還沒有講解"; }
        grid.append(btn);
      }
      g.append(grid);
    }
  }

  function openQ(n){
    cur = String(n); idx = -1; stop();
    const q = exam.questions[cur];
    $("tag").textContent = `第 ${cur} 題` + (q.type ? `．${q.type}` : "");
    const v = videoEmbed(q.video);
    $("vbox").hidden = !v;
    $("vbox").innerHTML = v ? `<div class="video"><iframe src="${v}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="老師講解影片"></iframe></div>
      <p class="vnote">這題有老師錄的影片。${hasSteps(q) ? "下面也可以聽語音講解。" : ""}</p>` : "";
    $("paper").innerHTML = paperHTML(exam, cur);
    $("dots").innerHTML = "";
    (q.steps || []).forEach((_, i) => {
      const d = document.createElement("button");
      d.className = "dot"; d.setAttribute("aria-label", `第 ${i+1} 步`); d.onclick = () => go(i, true);
      $("dots").append(d);
    });
    $("ansv").textContent = q.answer || "";
    $("endnote").textContent = "記錄只存在這台平板上。";
    $("ctlWrap").hidden = $("again").hidden = !hasSteps(q);
    $("home").hidden = true; $("view").hidden = false; scrollTo(0, 0);
    apply();
  }
  function closeQ(){ stop(); $("vbox").innerHTML = ""; $("view").hidden = true; $("home").hidden = false; drawGrid(); scrollTo(0, 0); }

  function apply(){
    const q = exam.questions[cur], paper = $("paper"), steps = q.steps || [];
    paper.querySelectorAll(".m").forEach(e => {
      e.classList.remove("hl", "rv");
      if(e.dataset.was !== undefined){ e.textContent = e.dataset.was; delete e.dataset.was; }
    });
    paper.querySelectorAll(".opt").forEach(e => e.classList.remove("out", "ok"));
    for(let i = 0; i <= idx; i++){
      const s = steps[i];
      for(const [k, v] of Object.entries(s.rv || {})){
        const e = paper.querySelector(`[data-k="${k}"]`);
        if(e){ e.dataset.was = e.textContent; e.textContent = v; e.classList.add("rv"); }
      }
      (s.x || []).forEach(L => paper.querySelector(`[data-o="${L}"]`)?.classList.add("out"));
      (s.ok || []).forEach(L => paper.querySelector(`[data-o="${L}"]`)?.classList.add("ok"));
    }
    let target = null;
    if(idx >= 0){
      const s = steps[idx];
      (s.hl || []).forEach(k => paper.querySelectorAll(`[data-k="${k}"]`).forEach(e => { e.classList.add("hl"); target = target || e; }));
      const L = (s.ok || s.x || [])[0];
      if(!target && L) target = paper.querySelector(`[data-o="${L}"]`);
    }
    if(target){
      const r = target.getBoundingClientRect(), bottom = innerHeight - document.querySelector(".player").offsetHeight;
      if(r.top < 60 || r.bottom > bottom - 10) scrollBy({top: r.top - bottom / 2 + r.height / 2, behavior: "smooth"});
    }
    $("cap").innerHTML = !steps.length
      ? `<span class="who">答案</span>這題請看上面老師的影片。`
      : idx < 0
        ? `<span class="who">準備好了嗎？</span>按「播放講解」開始，也可以按下面的小格子跳到任何一步。`
        : `<span class="who">第 ${idx+1} 步／共 ${steps.length} 步</span>${steps[idx].cap}`;
    [...$("dots").children].forEach((d, i) => { d.classList.toggle("on", i === idx); d.classList.toggle("past", i < idx); });
    $("prev").disabled = idx <= 0;
    $("next").disabled = idx >= steps.length - 1;
    $("play").textContent = playing ? "❚❚ 暫停" : (idx < 0 ? "▶ 播放講解" : "▶ 繼續");
    $("end").hidden = !(steps.length ? idx === steps.length - 1 : true);
  }

  /* 語音：用平板內建的中文語音 */
  const synth = window.speechSynthesis;
  let voice = null;
  const pickVoice = () => {
    const vs = synth.getVoices();
    voice = vs.find(v => /zh[-_]TW/i.test(v.lang)) || vs.find(v => /zh[-_](HK|Hant)/i.test(v.lang)) || vs.find(v => /^zh/i.test(v.lang)) || null;
  };
  if(synth){ pickVoice(); synth.onvoiceschanged = pickVoice; }

  function speakStep(){
    const my = ++token, s = exam.questions[cur].steps[idx], text = s.say || s.cap;
    const after = () => {
      if(my !== token) return;
      if(playing && idx < exam.questions[cur].steps.length - 1)
        setTimeout(() => { if(my === token && playing){ idx++; apply(); speakStep(); } }, 450);
      else { playing = false; apply(); }
    };
    if(synth){
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "zh-TW"; if(voice) u.voice = voice; u.rate = rate;
      u.onend = after;
      u.onerror = e => { if(e.error !== "interrupted" && e.error !== "canceled") after(); };
      synth.speak(u);
    } else setTimeout(after, Math.max(2500, text.length * 230 / rate)); // 沒有語音時照字幕長度自動換步
  }
  function stop(){ playing = false; token++; if(synth) synth.cancel(); }
  function go(i, speak){
    stop(); idx = i; apply();
    if(speak){ playing = true; apply(); speakStep(); }
  }

  $("back").onclick = closeQ;
  $("play").onclick = () => { if(playing){ stop(); apply(); } else go(idx < 0 ? 0 : idx, true); };
  $("prev").onclick = () => go(Math.max(0, idx - 1), true);
  $("next").onclick = () => go(Math.min(exam.questions[cur].steps.length - 1, idx + 1), true);
  $("again").onclick = () => { scrollTo({top:0, behavior:"smooth"}); go(0, true); };
  const mark2 = (v, msg) => { const st = ls.get(stKey(), {}); st[cur] = v; ls.set(stKey(), st); $("endnote").textContent = msg; };
  $("iok").onclick = () => mark2("ok", "已記下「懂了」。按「回題號」看下一題。");
  $("ino").onclick = () => mark2("no", "已記下「還是不懂」，記得找老師問，也可以再聽一次。");
  document.querySelectorAll(".speed button").forEach(b => b.onclick = () => {
    rate = +b.dataset.r;
    document.querySelectorAll(".speed button").forEach(x => x.setAttribute("aria-pressed", x === b));
    if(playing) go(idx, true);
  });
}

/* ---------- 老師檢查頁：一次列出所有題目和講解稿 ---------- */
function reviewApp(){
  gate(async (index, code) => {
    const want = params.get("exam");
    if(!want){
      $("list").hidden = false;
      for(const e of index.exams){
        const b = document.createElement("button");
        b.className = "exam";
        b.innerHTML = `<div><b>${e.title}</b><span>${e.date || ""}　有講解 ${e.ready}／${e.total} 題${e.hidden ? "　（學生看不到）" : ""}</span></div><span class="go">檢查 →</span>`;
        b.onclick = () => { location.search = "?exam=" + encodeURIComponent(e.id); };
        $("exams").append(b);
      }
      return;
    }
    const exam = await decrypt(await getJSON(`exams/${want}.json`), code);
    document.title = exam.title + "　講解稿";
    $("etitle").textContent = exam.title + "　講解稿檢查";
    const out = $("all");
    for(let n = 1; n <= exam.total; n++){
      const q = exam.questions[n], sec = document.createElement("section");
      sec.className = "rq"; sec.id = "q" + n;
      if(!q){ sec.innerHTML = `<div class="rhead"><b>第 ${n} 題</b><span class="miss">還沒有資料</span></div>`; out.append(sec); continue; }
      let h = `<div class="rhead"><b>第 ${n} 題</b>${q.type ? `<span class="tag">${q.type}</span>` : ""}<span class="tag">答案 ${q.answer || "？"}</span>`;
      if(q.video) h += `<span class="tag">有影片</span>`;
      if(isReady(q)) h += `<a class="tag" href="index.html?exam=${encodeURIComponent(want)}&q=${n}" target="_blank">在學生畫面試聽 →</a>`;
      h += `</div><div class="paper">${paperHTML(exam, n)}</div>`;
      if(hasSteps(q)){
        h += `<ol class="steps">` + q.steps.map(s => `<li>${s.cap}${s.say && s.say !== s.cap ? `<span class="say">念法：${s.say}</span>` : ""}</li>`).join("") + `</ol>`;
      } else if(!q.video) h += `<p class="miss">這題還沒有講解。</p>`;
      sec.innerHTML = h;
      out.append(sec);
    }
    $("rv").hidden = false;
  });
}
