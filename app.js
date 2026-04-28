// ── Catch-Idea · app.js ──────────────────────────────────────────────
// Free AI idea journal — OpenRouter (free Llama models) + localStorage
// No build step. Just open index.html or deploy to anywhere.
// ──────────────────────────────────────────────────────────────────────

const OR_URL    = "https://openrouter.ai/api/v1/chat/completions";
const OR_MODEL  = "meta-llama/llama-3.1-8b-instruct:free";
// vision model not free – fallback to text model with a note
const VIS_MODEL = "meta-llama/llama-3.1-8b-instruct:free";
const FALLBACK  = "mistralai/mistral-7b-instruct:free";
const S_IDEAS   = "ic_ideas_v2";
const S_KEY     = "ic_apikey";

const CATS = {
  Tech:     { emoji:"💻", color:"#60a5fa" },
  Business: { emoji:"📈", color:"#fbbf24" },
  Creative: { emoji:"🎨", color:"#f87171" },
  Personal: { emoji:"🌱", color:"#4ade80" },
  Other:    { emoji:"💡", color:"#c084fc" },
};

// ── State ──────────────────────────────────────────────────────────────
let state = {
  ideas:        [],
  apiKey:       "",
  view:         "vault",
  detailId:     null,
  filter:       "All",
  mode:         "text",
  ideaText:     "",
  photoData:    null,
  photoLoading: false,
  transcript:   "",
  listening:    false,
  analyzing:    false,
  analysis:     null,
  error:        "",
};

let recognition = null;

// ── Utilities ──────────────────────────────────────────────────────────
const uid     = () => Math.random().toString(36).slice(2, 10);
const fmtDate = (ts) => new Date(ts).toLocaleDateString("en", { month:"short", day:"numeric" });

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function catStyle(cat) {
  const c = CATS[cat] || CATS.Other;
  return { emoji: c.emoji, color: c.color };
}

async function resizeImage(dataUrl, maxDim = 1024) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width <= maxDim && height <= maxDim) {
        resolve(dataUrl);
        return;
      }
      const ratio = Math.min(maxDim / width, maxDim / height);
      width  = Math.round(width * ratio);
      height = Math.round(height * ratio);
      const canvas = document.createElement("canvas");
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(new Error("Failed to load image for resize"));
    img.src = dataUrl;
  });
}

// ── Persistence ────────────────────────────────────────────────────────
function loadStorage() {
  try {
    const raw = localStorage.getItem(S_IDEAS);
    if (raw) state.ideas = JSON.parse(raw);
  } catch {}
  state.apiKey = localStorage.getItem(S_KEY) || "";
}

function saveIdeas() {
  localStorage.setItem(S_IDEAS, JSON.stringify(state.ideas));
}

// ── OpenRouter API ─────────────────────────────────────────────────────
async function analyzeWithAI(text, imageBase64 = null) {
  // If image is present, we can't use a vision model for free;
  // instead we mention the photo and ask AI to make the best of text.
  const hasPhoto = !!imageBase64;
  const prompt = `Analyze this idea. Reply ONLY with valid JSON — no markdown, no explanation outside the JSON.

Idea: "${text}"${hasPhoto ? '\n(A photo was attached — analyze based on the description only, as the image cannot be viewed directly.)' : ''}

Return exactly this structure:
{
  "summary": "one compelling sentence",
  "category": "Tech" | "Business" | "Creative" | "Personal" | "Other",
  "score": <integer 1-10>,
  "actions": ["action 1","action 2","action 3"],
  "risks": ["risk 1","risk 2"],
  "opportunities": ["opportunity 1","opportunity 2"],
  "similar": ["existing thing 1","existing thing 2"],
  "verdict": "2-3 sentence honest assessment of viability"
}`;

  const userContent = hasPhoto
    ? [ { type: "text", text: prompt } ]
    : prompt;

  const model = OR_MODEL; // always text model (free)

  const res = await fetch(OR_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${state.apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      model,
      messages:   [{ role: "user", content: userContent }],
      max_tokens: 900,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error("Invalid API key. Check your OpenRouter key and try again.");
    if (res.status === 429) throw new Error("Rate limit hit. Wait a moment and try again.");
    throw new Error(err?.error?.message || `Request failed (${res.status}). Check your API key.`);
  }

  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "API error from OpenRouter.");

  const raw   = data.choices?.[0]?.message?.content || "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    // fallback with mistral
    try {
      const r2 = await fetch(OR_URL, {
        method: "POST",
        headers: { "Authorization": `Bearer ${state.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: FALLBACK, messages: [{ role:"user", content: userContent }], max_tokens: 900 }),
      });
      const d2   = await r2.json();
      const raw2 = d2.choices?.[0]?.message?.content || "";
      const m2   = raw2.match(/\{[\s\S]*\}/);
      if (m2) {
        try { return JSON.parse(m2[0]); } catch {}
      }
    } catch {}
    throw new Error("AI returned an unexpected format. Please try again.");
  }
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    throw new Error("AI response was malformed. Please try again.");
  }
}

// ── Render engine ──────────────────────────────────────────────────────
function render() {
  const content = document.getElementById("content");

  document.querySelectorAll(".nav-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.view === state.view);
  });

  const keyBtn = document.getElementById("keyBtn");
  if (state.apiKey) {
    keyBtn.textContent = "✓ key set";
    keyBtn.classList.add("is-set");
  } else {
    keyBtn.textContent = "add key";
    keyBtn.classList.remove("is-set");
  }

  switch (state.view) {
    case "capture":   content.innerHTML = renderCapture();   break;
    case "vault":     content.innerHTML = state.detailId ? renderDetail() : renderVault(); break;
    case "dashboard": content.innerHTML = renderDashboard(); break;
  }

  attachEvents();
}

// ── CAPTURE ────────────────────────────────────────────────────────────
function renderCapture() {
  const canAnalyze = !state.analyzing && !state.photoLoading &&
    (state.ideaText.trim().length > 3 || state.photoData);

  return `
<div class="capture-label">New Idea</div>

<div class="mode-tabs">
  ${["text","voice","photo"].map(m => `
    <button class="mode-tab${state.mode===m?" active":""}" data-mode="${m}">
      <span class="tab-icon">${m==="text"?"✏️":m==="voice"?"🎙":"📷"}</span>
      ${m.charAt(0).toUpperCase()+m.slice(1)}
    </button>`).join("")}
</div>

${state.mode === "text" ? `
  <textarea class="idea-textarea" id="ideaTA" placeholder="What's on your mind? Describe your idea — the AI will do the rest…" rows="6"></textarea>
` : ""}

${state.mode === "voice" ? `
  <div class="voice-box">
    <button class="voice-btn${state.listening?" listening":""}" id="voiceBtn">
      ${state.listening ? "⏹" : "🎙"}
    </button>
    <div class="voice-sub">${state.listening ? "Listening… tap to stop" : "Tap to start speaking"}</div>
    ${state.transcript ? `<div class="voice-transcript">"${escapeHtml(state.transcript)}"</div>` : ""}
  </div>
` : ""}

${state.mode === "photo" ? `
  <div class="photo-box" id="photoBox">
    <input type="file" id="photoInput" accept="image/*"/>
    ${state.photoLoading ? `
      <div class="photo-loading">
        <div class="spin"></div>
        <div>Processing photo…</div>
      </div>
    ` : state.photoData ? `
      <img src="${state.photoData}" alt="Captured idea" class="photo-preview"/>
    ` : `
      <div style="font-size:36px;margin-bottom:8px">📸</div>
      <div style="font-size:14px;color:var(--muted)">Tap to take or upload a photo</div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px">(Image analysis uses your text description only — free tier limitation)</div>
    `}
  </div>
  ${state.photoData ? `<textarea class="idea-textarea" id="photoTA" placeholder="Describe what’s in the photo for the AI…" rows="3" style="margin-top:10px"></textarea>` : ""}
` : ""}

${state.error ? `
  <div class="error-box">
    ⚠ ${escapeHtml(state.error)}
    ${state.error.includes("API key") ? `
      <button class="key-update-link" id="updateKeyFromError">Update API Key →</button>
    ` : ""}
  </div>` : ""}

${!state.analysis ? `
  <button class="analyze-btn" id="analyzeBtn" ${canAnalyze ? "" : "disabled"}>
    ${state.analyzing
      ? `<div class="spin"></div><span>AI is thinking…</span>`
      : `<span>✨</span><span>Analyze & Save</span>`}
  </button>
` : ""}

${state.analysis ? renderAnalysisCard(state.analysis, true) : ""}
`;
}

function renderAnalysisCard(a, withActions = false) {
  const { emoji, color } = catStyle(a.category);
  return `
<div class="result-card">
  <div class="result-header">
    <div class="result-score-ring">${escapeHtml(String(a.score))}/10</div>
    <div>
      <div class="result-summary">${escapeHtml(a.summary)}</div>
      <div class="result-cat" style="background:${color}18;color:${color};border:1px solid ${color}33">
        ${emoji} ${escapeHtml(a.category)}
      </div>
    </div>
  </div>

  <div class="result-section">
    <div class="section-label">Action Steps</div>
    ${(a.actions||[]).map((ac,i)=>`
      <div class="action-row"><div class="action-num">${i+1}</div>${escapeHtml(ac)}</div>`).join("")}
  </div>

  <div class="result-section">
    <div class="section-label">Opportunities</div>
    <div class="chip-row">${(a.opportunities||[]).map(o=>`<div class="chip green">${escapeHtml(o)}</div>`).join("")}</div>
  </div>

  <div class="result-section">
    <div class="section-label">Risks</div>
    <div class="chip-row">${(a.risks||[]).map(r=>`<div class="chip red">${escapeHtml(r)}</div>`).join("")}</div>
  </div>

  <div class="result-section">
    <div class="section-label">Similar Existing Things</div>
    <div class="chip-row">${(a.similar||[]).map(s=>`<div class="chip">${escapeHtml(s)}</div>`).join("")}</div>
  </div>

  <div class="result-section">
    <div class="section-label">Verdict</div>
    <div class="verdict-text">${escapeHtml(a.verdict)}</div>
  </div>

  ${withActions ? `
  <div class="save-row">
    <button class="save-main-btn" id="saveIdeaBtn">💾 Save to Vault</button>
    <button class="discard-btn" id="discardBtn">Discard</button>
  </div>` : ""}
</div>`;
}

// ── VAULT ──────────────────────────────────────────────────────────────
function renderVault() {
  const filtered = state.filter === "All"
    ? state.ideas
    : state.ideas.filter(i => i.analysis?.category === state.filter);

  const filters = ["All", ...Object.keys(CATS)];

  return `
<div class="vault-top">
  <div class="vault-title">Idea Vault</div>
  <div class="idea-count">${state.ideas.length} ideas</div>
</div>

<div class="filter-row">
  ${filters.map(f => `
    <button class="filter-pill${state.filter===f?" active":""}" data-filter="${f}">
      ${f!=="All" ? CATS[f]?.emoji+" " : ""}${f}
    </button>`).join("")}
</div>

${filtered.length === 0 ? `
  <div class="empty-state">
    <div class="empty-emoji">${state.ideas.length===0?"💭":"🔍"}</div>
    ${state.ideas.length === 0
      ? `No ideas yet.<br/>Hit <strong>Capture</strong> to add your first one.`
      : `No ideas in this category yet.`}
  </div>
` : `
  <div class="idea-grid">
    ${filtered.map(idea => {
      const { emoji, color } = catStyle(idea.analysis?.category || "Other");
      return `
      <div class="idea-card" data-id="${escapeHtml(idea.id)}" style="--card-color:${color}">
        <div class="card-top">
          <div class="card-cat-badge" style="background:${color}15;color:${color};border:1px solid ${color}30">
            ${emoji} ${escapeHtml(idea.analysis?.category||"Other")}
          </div>
          <div class="card-score">⭐ ${escapeHtml(String(idea.analysis?.score||"?"))}/10</div>
        </div>
        <div class="card-summary">${escapeHtml(idea.analysis?.summary||"Analyzing…")}</div>
        <div class="card-raw">${escapeHtml(idea.text)}</div>
        <div class="card-footer">
          <div class="card-date">${fmtDate(idea.ts)}</div>
          <button class="delete-card-btn" data-delete="${escapeHtml(idea.id)}" title="Delete">🗑</button>
        </div>
      </div>`;
    }).join("")}
  </div>
`}`;
}

// ── DETAIL ─────────────────────────────────────────────────────────────
function renderDetail() {
  const idea = state.ideas.find(i => i.id === state.detailId);
  if (!idea) return renderVault();
  return `
<button class="detail-back" id="backBtn">← Back to Vault</button>
${idea.photo ? `<img src="${idea.photo}" alt="Idea photo" class="detail-photo"/>` : ""}
<div class="detail-raw">${escapeHtml(idea.text)}</div>
${idea.analysis ? renderAnalysisCard(idea.analysis, false) : ""}
<button class="delete-btn" id="deleteIdeaBtn">🗑 Delete this idea</button>
`;
}

// ── DASHBOARD ──────────────────────────────────────────────────────────
function renderDashboard() {
  const total    = state.ideas.length;
  const avgScore = total ? Math.round(state.ideas.reduce((a,i)=>a+(i.analysis?.score||0),0)/total) : 0;
  const catCounts = Object.keys(CATS).map(c => ({
    c, n: state.ideas.filter(i => i.analysis?.category === c).length,
  }));
  const topIdeas = [...state.ideas]
    .sort((a,b) => (b.analysis?.score||0) - (a.analysis?.score||0))
    .slice(0,3);

  return `
<div class="dash-title">Your Ideas</div>

<div class="stat-grid">
  <div class="stat-card">
    <div class="stat-num">${total}</div>
    <div class="stat-label">Total ideas</div>
  </div>
  <div class="stat-card">
    <div class="stat-num">${avgScore}<span style="font-size:18px;color:var(--muted)">/10</span></div>
    <div class="stat-label">Avg AI score</div>
  </div>
</div>

<div class="stat-card" style="margin-bottom:10px">
  <div class="section-label" style="margin-bottom:12px">By Category</div>
  ${catCounts.filter(x=>x.n>0).map(({c,n}) => `
    <div class="cat-row">
      <div class="cat-row-label" style="color:${CATS[c].color}">${CATS[c].emoji} ${escapeHtml(c)}</div>
      <div class="cat-bar-wrap">
        <div class="cat-bar" style="width:${total?Math.round(n/total*100):0}%;background:${CATS[c].color}"></div>
      </div>
      <div class="cat-row-count">${n}</div>
    </div>`).join("")}
  ${catCounts.every(x=>x.n===0)
    ? `<div style="font-size:13px;color:var(--muted);text-align:center;padding:10px 0">No ideas yet</div>` : ""}
</div>

<div class="reminder-box">
  <div class="reminder-title">🔔 Idea Reminders</div>
  <div class="reminder-sub">Get browser nudges to revisit old ideas and take action before they fade away.</div>
  <button class="notif-btn" id="notifBtn">Enable reminders</button>
</div>

${topIdeas.length > 0 ? `
  <div class="top-ideas-section">
    <div class="section-label" style="margin:14px 0 10px">Top Rated Ideas</div>
    ${topIdeas.map(idea => {
      const { emoji, color } = catStyle(idea.analysis?.category||"Other");
      return `
      <div class="idea-card" data-id="${escapeHtml(idea.id)}" style="--card-color:${color};margin-bottom:8px">
        <div class="card-top">
          <div class="card-cat-badge" style="background:${color}15;color:${color};border:1px solid ${color}30">
            ${emoji} ${escapeHtml(idea.analysis?.category||"Other")}
          </div>
          <div class="card-score">⭐ ${escapeHtml(String(idea.analysis?.score||"?"))}/10</div>
        </div>
        <div class="card-summary">${escapeHtml(idea.analysis?.summary||"")}</div>
      </div>`;
    }).join("")}
  </div>` : ""}
`;
}

// ── Event binding ──────────────────────────────────────────────────────
function attachEvents() {
  // Textarea for text mode — value set + re-render on input
  const ta = document.getElementById("ideaTA");
  if (ta) {
    ta.value = state.ideaText;
    ta.addEventListener("input", e => {
      state.ideaText = e.target.value;
      render();  // <-- FIX: re-render so Analyze button updates
    });
  }

  // Textarea for photo context
  const pta = document.getElementById("photoTA");
  if (pta) {
    pta.value = (state.ideaText === "[Photo idea]" || state.ideaText === "[Photo idea]\n") ? "" : state.ideaText;
    pta.addEventListener("input", e => {
      state.ideaText = e.target.value;
      render();  // <-- FIX: same here
    });
  }

  // mode tabs — stop voice if switching away
  document.querySelectorAll(".mode-tab").forEach(b => {
    b.addEventListener("click", () => {
      if (state.listening) {
        recognition?.stop();
        state.listening = false;
      }
      state.mode = b.dataset.mode;
      state.analysis = null; state.error = "";
      if (state.mode !== "photo") { state.photoData = null; state.photoLoading = false; }
      render();
    });
  });

  // voice
  const vBtn = document.getElementById("voiceBtn");
  if (vBtn) vBtn.addEventListener("click", toggleVoice);

  // photo
  const pi = document.getElementById("photoInput");
  if (pi) pi.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    state.photoLoading = true; state.error = "";
    render();
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise((resolve, reject) => {
        reader.onload  = ev => resolve(ev.target.result);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(f);
      });
      const resized = await resizeImage(dataUrl);
      state.photoData = resized;
      state.ideaText  = "[Photo idea]\n";
      state.photoLoading = false;
      render();
    } catch (err) {
      state.photoLoading = false;
      state.error = "Failed to process photo. Try a smaller image.";
      render();
    }
  });

  // analyze
  const aBtn = document.getElementById("analyzeBtn");
  if (aBtn) aBtn.addEventListener("click", runAnalysis);

  // save idea
  const sBtn = document.getElementById("saveIdeaBtn");
  if (sBtn) sBtn.addEventListener("click", saveIdea);

  // discard
  const dBtn = document.getElementById("discardBtn");
  if (dBtn) dBtn.addEventListener("click", () => {
    state.analysis = null; state.ideaText = "";
    state.photoData = null; state.photoLoading = false; state.error = "";
    state.transcript = "";
    render();
  });

  // update key from error box
  const ukBtn = document.getElementById("updateKeyFromError");
  if (ukBtn) ukBtn.addEventListener("click", (e) => {
    e.preventDefault();
    showSetup();
  });

  // vault filters
  document.querySelectorAll(".filter-pill").forEach(b => {
    b.addEventListener("click", () => { state.filter = b.dataset.filter; render(); });
  });

  // vault card click → detail
  document.querySelectorAll(".idea-card[data-id]").forEach(card => {
    card.addEventListener("click", e => {
      if (e.target.closest(".delete-card-btn")) return;
      state.detailId = card.dataset.id;
      render();
    });
  });

  // delete from card
  document.querySelectorAll(".delete-card-btn").forEach(b => {
    b.addEventListener("click", e => {
      e.stopPropagation();
      deleteIdea(b.dataset.delete);
    });
  });

  // back from detail
  const backBtn = document.getElementById("backBtn");
  if (backBtn) backBtn.addEventListener("click", () => { state.detailId = null; render(); });

  // delete from detail
  const delBtn = document.getElementById("deleteIdeaBtn");
  if (delBtn) delBtn.addEventListener("click", () => deleteIdea(state.detailId));

  // notifications
  const nBtn = document.getElementById("notifBtn");
  if (nBtn) nBtn.addEventListener("click", requestNotif);

  // top-ideas in dashboard → detail
  document.querySelectorAll(".top-ideas-section .idea-card[data-id]").forEach(card => {
    card.addEventListener("click", () => {
      state.detailId = card.dataset.id;
      state.view = "vault";
      render();
    });
  });
}

// ── Actions ────────────────────────────────────────────────────────────
async function runAnalysis() {
  const text = state.ideaText.trim();
  if (!text && !state.photoData) return;
  if (!state.apiKey) { showSetup(); return; }

  state.analyzing = true; state.analysis = null; state.error = "";
  render();
  try {
    state.analysis = await analyzeWithAI(
      text || "Analyze this photo as a business/creative idea",
      state.photoData || null
    );
  } catch(e) {
    state.error = e.message;
  }
  state.analyzing = false;
  render();
}

function saveIdea() {
  if (!state.analysis) return;
  const idea = {
    id:       uid(),
    ts:       Date.now(),
    text:     state.ideaText.trim() || "Photo idea",
    photo:    state.photoData || null,
    analysis: state.analysis,
  };
  state.ideas.unshift(idea);
  saveIdeas();
  state.ideaText = ""; state.photoData = null;
  state.photoLoading = false;
  state.analysis = null; state.error = "";
  state.transcript = "";
  state.view = "vault";
  render();
}

function deleteIdea(id) {
  if (!confirm("Delete this idea?")) return;
  state.ideas = state.ideas.filter(i => i.id !== id);
  saveIdeas();
  state.detailId = null;
  render();
}

async function requestNotif() {
  if (!("Notification" in window)) { alert("Notifications not supported in this browser."); return; }
  const p = await Notification.requestPermission();
  if (p === "granted") {
    new Notification("Catch-Idea 💡", { body: "Don't forget your ideas — time to revisit and take action!" });
    alert("✅ Reminders enabled!");
  } else {
    alert("Permission denied. Enable notifications in your browser settings.");
  }
}

// ── Voice ──────────────────────────────────────────────────────────────
function toggleVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { alert("Voice input not supported in this browser.\nTry Chrome or Safari."); return; }

  if (state.listening) {
    recognition?.stop();
    state.listening = false;
    render();
    return;
  }

  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  let finalTranscript = "";

  recognition.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) {
        finalTranscript += r[0].transcript;
      } else {
        interim += r[0].transcript;
      }
    }
    state.transcript = finalTranscript + interim;
    state.ideaText   = state.transcript;
    render();
  };

  recognition.onend = () => {
    state.listening = false;
    render();
  };

  recognition.onerror = () => {
    state.listening = false;
    state.error = "Voice recognition failed. Please try again or use text mode.";
    render();
  };

  recognition.start();
  state.listening = true;
  state.transcript = "";
  finalTranscript  = "";
  state.error = "";
  render();
}

// ── Setup overlay ──────────────────────────────────────────────────────
function showSetup() {
  const overlay = document.getElementById("setupOverlay");
  const input   = document.getElementById("keyInput");
  overlay.classList.add("visible");
  input.value = state.apiKey;
  input.focus();
}

function hideSetup() {
  document.getElementById("setupOverlay").classList.remove("visible");
}

// ── Nav & key button ──────────────────────────────────────────────────
document.querySelectorAll(".nav-btn").forEach(b => {
  b.addEventListener("click", () => {
    state.view = b.dataset.view; state.detailId = null;
    state.analysis = null; state.error = "";
    if (state.listening) { recognition?.stop(); state.listening = false; }
    render();
  });
});

document.getElementById("keyBtn").addEventListener("click", showSetup);

document.getElementById("saveKeyBtn").addEventListener("click", () => {
  const val = document.getElementById("keyInput").value.trim();
  if (!val) return;
  state.apiKey = val;
  localStorage.setItem(S_KEY, val);
  hideSetup();
  state.error = "";
  render();
});

document.getElementById("keyInput").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("saveKeyBtn").click();
});

// ── Boot ───────────────────────────────────────────────────────────────
loadStorage();
if (!state.apiKey) showSetup();
render();
