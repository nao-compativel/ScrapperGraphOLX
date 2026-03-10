// ═══════════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════════
let records = [],
  selectedBrand = "",
  viewMode = "grafo",
  autoZoom = true; // toggle: zoom automático ao focar cidade
let simulation, zoomBehavior, graphG;
let algoActive = null; // 'prim' | 'kruskal' | null

const FC = {
  Econômico: "#3ecf8e",
  Intermediário: "#f0c040",
  Padrão: "#e67e22",
  Premium: "#e84d3d",
  Luxo: "#9b59b6",
};
const FK = {
  Econômico: "f-eco",
  Intermediário: "f-inter",
  Padrão: "f-pad",
  Premium: "f-prem",
  Luxo: "f-luxo",
};

function cat(v) {
  if (v < 35000) return "Econômico";
  if (v < 70000) return "Intermediário";
  if (v < 120000) return "Padrão";
  if (v < 250000) return "Premium";
  return "Luxo";
}
function fmt(v) {
  return "R$ " + Math.round(v).toLocaleString("pt-BR");
}
function fmtKm(v) {
  return v != null ? Number(v).toLocaleString("pt-BR") + " km" : "—";
}
function getFiltered() {
  return selectedBrand
    ? records.filter((r) => r.marca === selectedBrand)
    : records;
}

// Tenta JSON primeiro (mais rápido de parsear), fallback para window.OLX_DATA
async function loadData() {
  try {
    const res = await fetch("dados_olx.json");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        records = data;
        return true;
      }
    }
  } catch (_) {
    /* sem arquivo JSON, tenta legado */
  }

  if (typeof window.OLX_DATA !== "undefined" && window.OLX_DATA.length > 0) {
    records = window.OLX_DATA;
    return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPUTED
// ═══════════════════════════════════════════════════════════════════════════════
function cityStats(recs) {
  const m = {};
  recs.forEach((r) => {
    if (!m[r.cidade])
      m[r.cidade] = {
        cidade: r.cidade,
        vals: [],
        marcas: new Set(),
        faixas: {},
      };
    m[r.cidade].vals.push(r.valor);
    m[r.cidade].marcas.add(r.marca);
    const f = cat(r.valor);
    m[r.cidade].faixas[f] = (m[r.cidade].faixas[f] || 0) + 1;
  });
  return Object.values(m)
    .map((c) => ({
      cidade: c.cidade,
      preco_medio: d3.mean(c.vals),
      preco_min: d3.min(c.vals),
      preco_max: d3.max(c.vals),
      total: c.vals.length,
      marcas: [...c.marcas],
      faixas: c.faixas,
    }))
    .sort((a, b) => a.preco_medio - b.preco_medio);
}

// ═══════════════════════════════════════════════════════════════════════════════
// INIT CONTROLS
// ═══════════════════════════════════════════════════════════════════════════════
function initBrandFilter() {
  const brands = [...new Set(records.map((r) => r.marca))].sort();
  const sel = document.getElementById("filterBrand");
  brands.forEach((b) => {
    const o = document.createElement("option");
    o.value = b;
    o.textContent = b;
    sel.appendChild(o);
  });
  sel.addEventListener("change", () => {
    selectedBrand = sel.value;
    clearAlgo();
    refresh();
  });
}

function initSearch() {
  const input = document.getElementById("searchInput"),
    results = document.getElementById("searchResults");
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) {
      results.style.display = "none";
      return;
    }
    const seen = new Map();
    records.forEach((r) => {
      if (
        !((r.modelo || "") + (r.titulo || "") + (r.marca || ""))
          .toLowerCase()
          .includes(q)
      )
        return;
      const k = r.marca + "||" + (r.modelo || r.titulo);
      if (!seen.has(k) || r.valor < seen.get(k).valor) seen.set(k, r);
    });
    const matches = [...seen.values()]
      .sort((a, b) => a.valor - b.valor)
      .slice(0, 12);
    if (!matches.length) {
      results.innerHTML = '<div class="sr-no">Nenhum resultado</div>';
      results.style.display = "block";
      return;
    }
    results.innerHTML = matches
      .map(
        (r, i) => `
      <div class="sr-item" data-i="${i}">
        <div class="sr-marca">${r.marca}</div>
        <div class="sr-modelo">${r.modelo || r.titulo}</div>
        <div class="sr-info">${fmt(r.valor)} · ${r.cidade}${r.ano ? " · " + r.ano : ""}${r.km ? " · " + fmtKm(r.km) : ""}</div>
      </div>`,
      )
      .join("");
    results.querySelectorAll(".sr-item").forEach((el) =>
      el.addEventListener("click", () => {
        showCarDetail(matches[+el.dataset.i]);
        results.style.display = "none";
        input.value =
          matches[+el.dataset.i].modelo || matches[+el.dataset.i].marca;
      }),
    );
    results.style.display = "block";
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-wrap")) results.style.display = "none";
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAR DETAIL
// ═══════════════════════════════════════════════════════════════════════════════
function showCarDetail(r) {
  document.getElementById("det-marca").textContent = r.marca;
  document.getElementById("det-modelo").textContent = r.modelo || "—";
  document.getElementById("det-titulo").textContent = r.titulo;
  document.getElementById("det-price").textContent = fmt(r.valor);
  document.getElementById("det-cidade").textContent = r.cidade;
  document.getElementById("det-bairro").textContent = r.bairro || "—";
  document.getElementById("det-ano").textContent = r.ano || "—";
  document.getElementById("det-km").textContent = fmtKm(r.km);
  const lnk = document.getElementById("det-link");
  if (r.link) {
    lnk.href = r.link;
    lnk.style.display = "block";
  } else lnk.style.display = "none";
  document.getElementById("car-detail").style.display = "block";
}
function closeDetail() {
  document.getElementById("car-detail").style.display = "none";
}
document.getElementById("closeDetail").addEventListener("click", closeDetail);

// ═══════════════════════════════════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════════════════════════════════
document.querySelectorAll(".tab-btn").forEach((btn) =>
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".tab-btn")
      .forEach((b) => b.classList.remove("active"));
    document
      .querySelectorAll(".tab-content")
      .forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// PANEL: CIDADES
// ═══════════════════════════════════════════════════════════════════════════════
function renderCidades() {
  const recs = getFiltered(),
    stats = cityStats(recs);
  const maxM = d3.max(stats, (c) => c.preco_medio) || 1,
    minM = d3.min(stats, (c) => c.preco_medio) || 0;
  const c = document.getElementById("tab-cidades");
  c.innerHTML = "";
  stats.forEach((s, i) => {
    const pct = ((s.preco_medio - minM) / (maxM - minM || 1)) * 100;
    const div = document.createElement("div");
    div.className = "city-card";
    div.innerHTML = `
      <div class="rank-badge">#${i + 1}</div>
      <div class="cc-name">${s.cidade}</div>
      <div class="cc-price">${fmt(s.preco_medio)}</div>
      <div class="cc-min">↓ mín ${fmt(s.preco_min)}</div>
      <div class="cc-count">${s.total} anúncio${s.total > 1 ? "s" : ""} · ${s.marcas.length} marca${s.marcas.length > 1 ? "s" : ""}</div>
      <div class="cc-bar"><div class="cc-bar-fill" style="width:${pct}%"></div></div>`;
    div.addEventListener("click", () => focusCity(s.cidade, div));
    c.appendChild(div);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// FOCUS CITY — highlight + multi-ring layout + zoom condicional
// ═══════════════════════════════════════════════════════════════════════════════
function focusCity(cidade, cardEl) {
  if (viewMode !== "grafo") return;

  // Só foca se a cidade realmente tem nós visíveis no grafo atual
  const carsFiltered = (window._graphCarNodes || []).filter(
    (n) => n.cidadeTarget === cidade,
  );
  if (!carsFiltered.length) return;

  document
    .querySelectorAll(".city-card")
    .forEach((c) => c.classList.remove("selected"));
  if (cardEl) cardEl.classList.add("selected");

  d3.selectAll(".node-city").attr("opacity", (n) =>
    n.id === cidade ? 1 : 0.1,
  );
  d3.selectAll(".node-car").attr("opacity", (n) =>
    n.cidadeTarget === cidade ? 1 : 0.04,
  );
  d3.selectAll(".link").attr("opacity", (l) => {
    const tgt = typeof l.target === "object" ? l.target.id : l.target;
    return tgt === cidade ? 0.5 : 0.015;
  });

  const cityNode = (window._graphCidades || []).find((c) => c.id === cidade);
  if (!cityNode || !simulation) return;

  const cars = carsFiltered;
  const n = cars.length;

  // ── Multi-ring layout — espaçamento generoso ─────────────────────────────
  cars.sort((a, b) => a.record.valor - b.record.valor);

  // Espaçamento por nó: mais espaço quando há menos carros
  const nodeSpacing = n <= 15 ? 48 : n <= 40 ? 38 : n <= 80 ? 30 : 24;
  const ringBase = 90; // raio do 1º anel — maior que antes
  const ringGrowth = 1.6; // fator de crescimento entre anéis

  const rings = [];
  let remaining = n,
    ringIdx = 0;
  while (remaining > 0) {
    const r = ringBase + ringIdx * nodeSpacing * ringGrowth;
    const fits = Math.max(6, Math.floor((2 * Math.PI * r) / nodeSpacing));
    const count = Math.min(fits, remaining);
    rings.push({ r, count });
    remaining -= count;
    ringIdx++;
  }

  // Fixa a cidade no lugar
  cityNode.fx = cityNode.x;
  cityNode.fy = cityNode.y;

  let placed = 0;
  rings.forEach(({ r, count }) => {
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
      const px = cityNode.x + Math.cos(angle) * r;
      const py = cityNode.y + Math.sin(angle) * r;
      cars[placed].fx = px;
      cars[placed].fy = py;
      cars[placed]._pinnedFx = px; // memoriza a posição do anel
      cars[placed]._pinnedFy = py;
      placed++;
    }
  });

  simulation.alpha(0.4).restart();

  // ── Zoom condicional (respeita o toggle) ─────────────────────────────────
  if (autoZoom && zoomBehavior) {
    const svg = d3.select("#main-svg");
    const W = document.getElementById("graph-area").clientWidth;
    const H = document.getElementById("graph-area").clientHeight;
    const outerR = rings[rings.length - 1].r + 60;
    const pad = 80;
    const scale = Math.min(
      (W - pad * 2) / (outerR * 2),
      (H - pad * 2) / (outerR * 2),
      1.8,
    );
    svg
      .transition()
      .duration(700)
      .ease(d3.easeCubicInOut)
      .call(
        zoomBehavior.transform,
        d3.zoomIdentity
          .translate(W / 2 - scale * cityNode.x, H / 2 - scale * cityNode.y)
          .scale(scale),
      );
  }

  document.getElementById("btnReset").style.display = "inline-block";
}

function resetFocus() {
  d3.selectAll(".node-city,.node-car").attr("opacity", 1);
  d3.selectAll(".link").attr("opacity", 0.2);
  const all = [
    ...(window._graphCidades || []),
    ...(window._graphCarNodes || []),
  ];
  all.forEach((n) => {
    n.fx = null;
    n.fy = null;
    delete n._pinnedFx;
    delete n._pinnedFy;
  });
  if (simulation) simulation.alpha(0.35).restart();
  const svg = d3.select("#main-svg");
  const W = document.getElementById("graph-area").clientWidth;
  const H = document.getElementById("graph-area").clientHeight;
  if (zoomBehavior)
    svg
      .transition()
      .duration(600)
      .ease(d3.easeCubicInOut)
      .call(
        zoomBehavior.transform,
        d3.zoomIdentity
          .translate(W / 2, H / 2)
          .scale(0.82)
          .translate(-W / 2, -H / 2),
      );
  document
    .querySelectorAll(".city-card")
    .forEach((c) => c.classList.remove("selected"));
  if (!algoActive) document.getElementById("btnReset").style.display = "none";
}

// ═══════════════════════════════════════════════════════════════════════════════
// PANEL: ESTATÍSTICAS
// ═══════════════════════════════════════════════════════════════════════════════
function renderEstatisticas() {
  const recs = getFiltered(),
    vals = recs.map((r) => r.valor).sort((a, b) => a - b),
    n = vals.length;
  if (!n) {
    document.getElementById("tab-estatisticas").innerHTML =
      '<div class="no-data">Sem dados</div>';
    return;
  }
  const mean = d3.mean(vals),
    median = d3.median(vals),
    std = d3.deviation(vals) || 0;
  const q1 = d3.quantile(vals, 0.25),
    q3 = d3.quantile(vals, 0.75),
    iqr = q3 - q1;
  const low = q1 - 1.5 * iqr,
    up = q3 + 1.5 * iqr;
  const bkt = {};
  vals.forEach((v) => {
    const k = Math.floor(v / 10000) * 10;
    bkt[k] = (bkt[k] || 0) + 1;
  });
  const mk = Object.keys(bkt).sort((a, b) => bkt[b] - bkt[a])[0];
  const bins = d3.bin().thresholds(10)(vals);
  document.getElementById("tab-estatisticas").innerHTML = `
    <div class="sec-hdr">Tendência central</div>
    <div class="stat-row"><span class="stat-label">Média</span><span class="stat-val yellow">${fmt(mean)}</span></div>
    <div class="stat-row"><span class="stat-label">Mediana</span><span class="stat-val green">${fmt(median)}</span></div>
    <div class="stat-row"><span class="stat-label">Moda (faixa)</span><span class="stat-val">${mk}k–${+mk + 10}k</span></div>
    <div class="stat-row"><span class="stat-label">Total</span><span class="stat-val">${n}</span></div>
    <div class="sec-hdr" style="margin-top:14px">Dispersão</div>
    <div class="stat-row"><span class="stat-label">Desvio padrão</span><span class="stat-val">${fmt(std)}</span></div>
    <div class="stat-row"><span class="stat-label">Q1 (25%)</span><span class="stat-val green">${fmt(q1)}</span></div>
    <div class="stat-row"><span class="stat-label">Q3 (75%)</span><span class="stat-val red">${fmt(q3)}</span></div>
    <div class="stat-row"><span class="stat-label">IQR</span><span class="stat-val">${fmt(iqr)}</span></div>
    <div class="sec-hdr" style="margin-top:14px">Amplitude</div>
    <div class="stat-row"><span class="stat-label">Mínimo</span><span class="stat-val green">${fmt(vals[0])}</span></div>
    <div class="stat-row"><span class="stat-label">Máximo</span><span class="stat-val red">${fmt(vals[n - 1])}</span></div>
    <div class="stat-row"><span class="stat-label">Amplitude</span><span class="stat-val">${fmt(vals[n - 1] - vals[0])}</span></div>
    <div class="sec-hdr" style="margin-top:14px">Distribuição</div>
    <svg id="hist-svg" height="90" style="width:100%"></svg>
    <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--muted);font-family:'JetBrains Mono';margin-top:3px">
      <span>${fmt(vals[0])}</span><span style="color:var(--accent)">▲ mediana</span><span>${fmt(vals[n - 1])}</span>
    </div>`;
  const W2 = document.getElementById("tab-estatisticas").clientWidth - 28,
    H2 = 80;
  const sv = d3.select("#hist-svg").attr("width", W2);
  const xS = d3
    .scaleLinear()
    .domain([vals[0], vals[n - 1]])
    .range([0, W2]);
  const yS = d3
    .scaleLinear()
    .domain([0, d3.max(bins, (b) => b.length)])
    .range([H2, 0]);
  const cS = d3
    .scaleLinear()
    .domain([vals[0], vals[n - 1]])
    .range(["#3ecf8e", "#e84d3d"]);
  sv.selectAll("rect")
    .data(bins)
    .enter()
    .append("rect")
    .attr("x", (b) => xS(b.x0) + 1)
    .attr("width", (b) => Math.max(0, xS(b.x1) - xS(b.x0) - 2))
    .attr("y", (b) => yS(b.length))
    .attr("height", (b) => H2 - yS(b.length))
    .attr("fill", (b) => cS((b.x0 + b.x1) / 2))
    .attr("rx", 2);
  sv.append("line")
    .attr("x1", xS(median))
    .attr("x2", xS(median))
    .attr("y1", 0)
    .attr("y2", H2)
    .attr("stroke", "#f0c040")
    .attr("stroke-width", 1.5)
    .attr("stroke-dasharray", "3,2");
}

// ═══════════════════════════════════════════════════════════════════════════════
// PANEL: FREQUÊNCIAS
// ═══════════════════════════════════════════════════════════════════════════════
function renderFrequencias() {
  const recs = getFiltered();
  const n = recs.length;
  if (!n) {
    document.getElementById("tab-frequencias").innerHTML =
      '<div class="no-data">Sem dados</div>';
    return;
  }

  const bMap = {},
    fMap = {},
    mMap = {},
    cheapByBrand = {},
    cheapByModelo = {};
  const order = ["Econômico", "Intermediário", "Padrão", "Premium", "Luxo"];

  // Detecção de outliers (fora de Q1−1.5×IQR / Q3+1.5×IQR)
  const vals = recs.map((r) => r.valor).sort((a, b) => a - b);
  const q1 = d3.quantile(vals, 0.25),
    q3 = d3.quantile(vals, 0.75);
  const iqr = q3 - q1,
    low = q1 - 1.5 * iqr,
    up = q3 + 1.5 * iqr;
  let outliers = 0;

  recs.forEach((r) => {
    bMap[r.marca] = (bMap[r.marca] || 0) + 1;
    const f = cat(r.valor);
    fMap[f] = (fMap[f] || 0) + 1;

    // Top modelos (usa modelo ou fallback para título)
    const mod =
      r.modelo && r.modelo !== "N/D"
        ? r.modelo
        : (r.titulo || "").split(" ").slice(1, 3).join(" ");
    if (mod) {
      mMap[mod] = (mMap[mod] || 0) + 1;
      if (!cheapByModelo[mod] || r.valor < cheapByModelo[mod].valor)
        cheapByModelo[mod] = r;
    }

    if (!cheapByBrand[r.marca] || r.valor < cheapByBrand[r.marca].valor)
      cheapByBrand[r.marca] = r;
    if (r.valor < low || r.valor > up) outliers++;
  });

  const byBrand = Object.entries(bMap).sort((a, b) => b[1] - a[1]);
  const byFaixa = order.filter((f) => fMap[f]).map((f) => [f, fMap[f]]);
  const byModelo = Object.entries(mMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  const maxB = Math.max(...byBrand.map((b) => b[1]), 1);
  const maxF = Math.max(...byFaixa.map((f) => f[1]), 1);
  const maxM = Math.max(...byModelo.map((m) => m[1]), 1);

  function freqRow(label, count, max, color, title = "") {
    return `
      <div class="freq-row">
        <div class="freq-label" title="${title || label}">${label}</div>
        <div class="freq-track">
          <div class="freq-fill" data-width="${((count / max) * 100).toFixed(2)}"
               style="width:0;background:${color}"></div>
        </div>
        <div class="freq-count">${count}</div>
      </div>`;
  }

  // Armazena referência para os callbacks dos botões
  const _cheapRefs = {};

  function cheapBtn(record, idKey) {
    if (!record) return "";
    const key = `cheap_${idKey}`;
    _cheapRefs[key] = record;
    return `<button class="cheap-btn" data-key="${key}"
              title="Ver detalhes: ${record.modelo || record.marca} — ${fmt(record.valor)}">
              ${record.modelo || record.marca} — ${fmt(record.valor)}
            </button>`;
  }

  const html = `
    <div class="sec-hdr">Resumo da seleção</div>
    <div class="stat-row">
      <span class="stat-label">Total de anúncios</span>
      <span class="stat-val yellow">${n}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Outliers de preço</span>
      <span class="stat-val ${outliers > 0 ? "red" : "green"}">${outliers}
        <span style="color:var(--muted);font-size:9px"> (fora 1.5×IQR)</span>
      </span>
    </div>

    <div class="sec-hdr" style="margin-top:14px">Frequência por marca</div>
    ${byBrand
      .map(([b, c]) => {
        const cheap = cheapByBrand[b];
        const idKey = "brand_" + b.replace(/\s+/g, "_");
        _cheapRefs["cheap_" + idKey] = cheap;
        return (
          freqRow(b, c, maxB, "#4d9de0", b) +
          `<div class="stat-row cheap-row" style="margin-top:-2px;margin-bottom:8px">
          <span class="stat-label">↳ mais barato</span>
          <span class="stat-val">${cheapBtn(cheap, idKey)}</span>
        </div>`
        );
      })
      .join("")}

    <div class="sec-hdr" style="margin-top:14px">Top modelos anunciados</div>
    ${byModelo
      .map(([m, c]) => {
        const cheap = cheapByModelo[m];
        const idKey = "mod_" + m.replace(/\s+/g, "_").slice(0, 20);
        _cheapRefs["cheap_" + idKey] = cheap;
        return (
          freqRow(
            m.length > 12 ? m.slice(0, 12) + "…" : m,
            c,
            maxM,
            "#9b59b6",
            m,
          ) +
          (cheap
            ? `<div class="stat-row cheap-row" style="margin-top:-2px;margin-bottom:8px">
          <span class="stat-label">↳ mín</span>
          <span class="stat-val">${cheapBtn(cheap, idKey)}</span>
        </div>`
            : "")
        );
      })
      .join("")}

    <div class="sec-hdr" style="margin-top:14px">Faixa de preço</div>
    ${byFaixa
      .map(
        ([f, c]) => `
      <div class="freq-row">
        <div class="freq-label">
          <span class="faixa-badge ${FK[f]}">${f.split(" ")[0]}</span>
        </div>
        <div class="freq-track">
          <div class="freq-fill" data-width="${((c / maxF) * 100).toFixed(2)}"
               style="width:0;background:${FC[f]}"></div>
        </div>
        <div class="freq-count">${c}</div>
      </div>`,
      )
      .join("")}

    <div class="sec-hdr" style="margin-top:14px">P(faixa)</div>
    ${byFaixa
      .map(
        ([f, c]) => `
      <div class="stat-row">
        <span class="stat-label">${f.split(" ")[0]}</span>
        <span class="stat-val" style="color:${FC[f]}">${((c / n) * 100).toFixed(1)}%</span>
      </div>`,
      )
      .join("")}
  `;

  const tab = document.getElementById("tab-frequencias");
  tab.innerHTML = html;

  // Delegação de evento para os botões de carro mais barato
  tab.querySelectorAll(".cheap-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rec = _cheapRefs[btn.dataset.key];
      if (rec) showCarDetail(rec);
    });
  });

  /* animação das barras */
  requestAnimationFrame(() => {
    tab.querySelectorAll(".freq-fill").forEach((bar, i) => {
      bar.style.transition = `width 0.9s cubic-bezier(.22,.61,.36,1) ${i * 0.04}s`;
      bar.style.width = bar.dataset.width + "%";
    });
  });
}

// ── Auto-zoom: encaixa todos os nós visíveis na viewport ─────────────────────
function autoFitAll(duration = 600) {
  if (!zoomBehavior || !window._graphCidades) return;
  const allNodes = [
    ...(window._graphCidades || []),
    ...(window._graphCarNodes || []),
  ];
  if (!allNodes.length) return;

  const W = document.getElementById("graph-area").clientWidth;
  const H = document.getElementById("graph-area").clientHeight;
  const pad = 60;

  const xs = allNodes.map((n) => n.x).filter(Boolean);
  const ys = allNodes.map((n) => n.y).filter(Boolean);
  if (!xs.length) return;

  const x0 = Math.min(...xs),
    x1 = Math.max(...xs);
  const y0 = Math.min(...ys),
    y1 = Math.max(...ys);
  const bw = x1 - x0 || 1,
    bh = y1 - y0 || 1;

  const scale = Math.min(
    (W - pad * 2) / bw,
    (H - pad * 2) / bh,
    1.5, // nunca zoom in demais
  );
  const tx = W / 2 - scale * ((x0 + x1) / 2);
  const ty = H / 2 - scale * ((y0 + y1) / 2);

  d3.select("#main-svg")
    .transition()
    .duration(duration)
    .ease(d3.easeCubicInOut)
    .call(
      zoomBehavior.transform,
      d3.zoomIdentity.translate(tx, ty).scale(scale),
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRAPH: FORCE-DIRECTED (carros individuais)
// ═══════════════════════════════════════════════════════════════════════════════
function renderGrafo() {
  const recs = getFiltered(),
    svg = d3.select("#main-svg");
  svg.selectAll("*").remove();
  if (simulation) simulation.stop();
  window._graphFirstFitDone = false; // resetar flag a cada rebuild
  const W = document.getElementById("graph-area").clientWidth;
  const H = document.getElementById("graph-area").clientHeight;
  zoomBehavior = d3
    .zoom()
    .scaleExtent([0.06, 8])
    .on("zoom", (e) => graphG.attr("transform", e.transform));
  svg.call(zoomBehavior);
  graphG = svg.append("g");
  const g = graphG;

  // Cidade nodes
  const cMap = {};
  recs.forEach((r) => {
    if (!cMap[r.cidade])
      cMap[r.cidade] = { id: r.cidade, type: "city", vals: [], faixas: {} };
    cMap[r.cidade].vals.push(r.valor);
    const f = cat(r.valor);
    cMap[r.cidade].faixas[f] = (cMap[r.cidade].faixas[f] || 0) + 1;
  });
  const cidades = Object.values(cMap);
  cidades.forEach((c) => {
    c.mean = d3.mean(c.vals);
    c.min = d3.min(c.vals);
    c.count = c.vals.length;
    const dom = Object.entries(c.faixas).sort((a, b) => b[1] - a[1])[0][0];
    c.color = FC[dom];
  });

  // Car nodes — samplea por cidade se a base for muito grande
  const MAX_CARS_PER_CITY = 40;
  const recsSampled = (() => {
    const byCity = {};
    recs.forEach((r) => {
      if (!byCity[r.cidade]) byCity[r.cidade] = [];
      if (byCity[r.cidade].length < MAX_CARS_PER_CITY) byCity[r.cidade].push(r);
    });
    return Object.values(byCity).flat();
  })();

  // Car nodes (one per listing)
  const carNodes = recsSampled.map((r, i) => ({
    id: "car_" + i,
    type: "car",
    record: r,
    faixa: cat(r.valor),
    cidadeTarget: r.cidade,
  }));

  window._graphCidades = cidades;
  window._graphCarNodes = carNodes;

  const links = carNodes.map((c) => ({ source: c.id, target: c.cidadeTarget }));
  const nodes = [...cidades, ...carNodes];
  const sCity = d3
    .scaleSqrt()
    .domain([1, d3.max(cidades, (c) => c.count) || 1])
    .range([22, 52]);

  // Edges
  const link = g
    .append("g")
    .selectAll("line")
    .data(links)
    .enter()
    .append("line")
    .attr("class", "link")
    .attr(
      "stroke",
      (l) =>
        FC[
          carNodes.find(
            (n) =>
              n.id === (typeof l.source === "object" ? l.source.id : l.source),
          )?.faixa
        ] || "#444",
    )
    .attr("stroke-opacity", 0.2)
    .attr("stroke-width", 0.8);

  // Nodes
  const node = g
    .append("g")
    .selectAll("g")
    .data(nodes)
    .enter()
    .append("g")
    .attr("class", (d) => (d.type === "city" ? "node-city" : "node-car"))
    .style("cursor", "pointer")
    .call(d3.drag().on("start", ds).on("drag", dd).on("end", de));

  node.each(function (d) {
    const el = d3.select(this);
    if (d.type === "city") {
      const r = sCity(d.count);
      el.append("circle")
        .attr("r", r)
        .attr("fill", d.color)
        .attr("fill-opacity", 0.12)
        .attr("stroke", d.color)
        .attr("stroke-width", 2.5)
        .attr("stroke-opacity", 0.75);
      el.append("circle")
        .attr("r", r + 5)
        .attr("fill", "none")
        .attr("stroke", d.color)
        .attr("stroke-width", 0.5)
        .attr("stroke-opacity", 0.2)
        .attr("stroke-dasharray", "4,3");
      el.append("text")
        .attr("text-anchor", "middle")
        .attr("dy", ".35em")
        .attr("fill", d.color)
        .attr("font-family", "Syne")
        .attr("font-weight", 700)
        .attr("font-size", Math.max(9, Math.min(14, r * 0.38)))
        .attr("pointer-events", "none")
        .text(d.id.length > 13 ? d.id.split(" ")[0] : d.id);
    } else {
      const cor = FC[d.faixa];
      const label = (d.record.modelo || d.record.marca || "")
        .split(" ")
        .slice(0, 2)
        .join(" ");
      el.append("circle")
        .attr("r", 7)
        .attr("fill", cor)
        .attr("fill-opacity", 0.85)
        .attr("stroke", "#fff")
        .attr("stroke-width", 0.6)
        .attr("stroke-opacity", 0.25);
      el.append("text")
        .attr("x", 10)
        .attr("dy", ".35em")
        .attr("fill", cor)
        .attr("font-family", "Syne")
        .attr("font-weight", 600)
        .attr("font-size", 8)
        .attr("pointer-events", "none")
        .attr("opacity", 0.88)
        .text(label);
    }
  });

  const tt = document.getElementById("tooltip");
  const isMobile = () => window.matchMedia("(max-width: 768px)").matches;

  function showTT(ev, d) {
    if (d.type === "city") {
      tt.innerHTML = `<div class="tt-title">${d.id}</div>Média: <b>${fmt(d.mean)}</b><br>Mín: <b>${fmt(d.min)}</b><br>Anúncios: <b>${d.count}</b>`;
    } else {
      const r = d.record;
      tt.innerHTML =
        `<div class="tt-title">${r.marca} ${r.modelo || ""}</div><b>${fmt(r.valor)}</b><br>` +
        `${r.cidade}${r.bairro && r.bairro !== "N/D" ? " · " + r.bairro : ""}<br>` +
        `${r.ano ? "Ano " + r.ano : ""}${r.km ? " · " + fmtKm(r.km) : ""}`;
    }
    const area = document.getElementById("graph-area");
    const rect = area.getBoundingClientRect();
    const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const clientY = ev.touches ? ev.touches[0].clientY : ev.clientY;
    const ox = clientX - rect.left,
      oy = clientY - rect.top;
    // Evita que tooltip saia pela direita
    const ttW = 230;
    const left = ox + 14 + ttW > area.clientWidth ? ox - ttW - 8 : ox + 14;
    tt.style.left = left + "px";
    tt.style.top = oy - 10 + "px";
    tt.style.opacity = 1;
  }

  function handleNodeClick(ev, d) {
    if (d.type === "city") {
      const sub = recs.filter((r) => r.cidade === d.id);
      showCarDetail(sub.reduce((a, c) => (c.valor < a.valor ? c : a), sub[0]));
    } else {
      showCarDetail(d.record);
    }
    if (isMobile()) {
      tt.style.opacity = 0;
    }
  }

  node
    .on("mousemove", showTT)
    .on("mouseleave", () => (tt.style.opacity = 0))
    .on("click", handleNodeClick)
    // Touch: tap abre o card, long-press mostra tooltip brevemente
    .on(
      "touchstart",
      (ev, d) => {
        ev.preventDefault();
        showTT(ev, d);
      },
      { passive: false },
    )
    .on(
      "touchend",
      (ev, d) => {
        ev.preventDefault();
        setTimeout(() => {
          tt.style.opacity = 0;
        }, 1200);
        handleNodeClick(ev, d);
      },
      { passive: false },
    );

  // Simulation — forças calibradas para manter tudo dentro da tela
  const cityCount = cidades.length;
  const cityCharge = Math.max(-1400, -3200 / Math.sqrt(cityCount || 1));
  const carCharge = Math.max(-35, -120 / Math.sqrt(cityCount || 1));

  // Mapa pré-computado: evita cidades.find() a cada iteração de forceLink
  const cidadeMap = Object.fromEntries(cidades.map((c) => [c.id, c]));

  let _tickFrame = 0;

  simulation = d3
    .forceSimulation(nodes)
    .force(
      "link",
      d3
        .forceLink(links)
        .id((d) => d.id)
        .distance((l) => {
          const tgt =
            typeof l.target === "object" ? l.target : cidadeMap[l.target];
          return tgt ? 42 + Math.sqrt(tgt.count) * 11 : 52;
        })
        .strength(0.7),
    )
    .force(
      "charge",
      d3
        .forceManyBody()
        .strength((d) => (d.type === "city" ? cityCharge : carCharge))
        .distanceMax(600),
    )
    .force("center", d3.forceCenter(W / 2, H / 2).strength(0.06))
    .force("x", d3.forceX(W / 2).strength(0.035))
    .force("y", d3.forceY(H / 2).strength(0.035))
    .force(
      "collision",
      d3
        .forceCollide()
        .radius((d) => (d.type === "city" ? sCity(d.count) + 14 : 10))
        .strength(0.95),
    )
    .alphaDecay(0.022)
    .on("tick", () => {
      // Throttle: quando quase estável, pula 2 em cada 3 frames
      _tickFrame++;
      if (simulation.alpha() < 0.05 && _tickFrame % 3 !== 0) return;

      link
        .attr("x1", (l) => l.source.x)
        .attr("y1", (l) => l.source.y)
        .attr("x2", (l) => l.target.x)
        .attr("y2", (l) => l.target.y);
      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    })
    .on("end", () => {
      // Só faz autoFit na primeira estabilização (carga inicial).
      // Depois disso, focusCity/resetFocus controlam o zoom manualmente.
      if (!window._graphFirstFitDone) {
        window._graphFirstFitDone = true;
        autoFitAll();
      }
      if (algoActive === "prim") runPrim();
      else if (algoActive === "kruskal") runKruskal();
    });

  // Re-apply algo overlay if active (durante simulação ainda em curso)
  if (algoActive === "prim") setTimeout(runPrim, 1200);
  else if (algoActive === "kruskal") setTimeout(runKruskal, 1200);

  function ds(e) {
    if (!e.active) simulation.alphaTarget(0.3).restart();
    e.subject.fx = e.subject.x;
    e.subject.fy = e.subject.y;
  }
  function dd(e) {
    e.subject.fx = e.x;
    e.subject.fy = e.y;
  }
  function de(e) {
    if (!e.active) simulation.alphaTarget(0);
    // Se o nó foi fixado pelo focusCity (tem _pinnedFx), restaura a posição
    // em vez de liberá-lo — evita que ele saia do lugar ao clicar
    if (e.subject._pinnedFx !== undefined) {
      e.subject.fx = e.subject._pinnedFx;
      e.subject.fy = e.subject._pinnedFy;
    } else {
      e.subject.fx = null;
      e.subject.fy = null;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRAPH: BUBBLES
// ═══════════════════════════════════════════════════════════════════════════════
function renderBolhas() {
  const recs = getFiltered(),
    svg = d3.select("#main-svg");
  svg.selectAll("*").remove();
  if (simulation) simulation.stop();
  const W = document.getElementById("graph-area").clientWidth;
  const H = document.getElementById("graph-area").clientHeight;
  const g = svg.append("g");
  svg.call(
    d3
      .zoom()
      .scaleExtent([0.2, 5])
      .on("zoom", (e) => g.attr("transform", e.transform)),
  );
  const stats = cityStats(recs);
  const tt = document.getElementById("tooltip");
  const rS = d3
    .scaleSqrt()
    .domain([
      d3.min(stats, (c) => c.preco_medio),
      d3.max(stats, (c) => c.preco_medio),
    ])
    .range([22, 72]);
  const cS = d3
    .scaleSequential(d3.interpolateRdYlGn)
    .domain([
      d3.max(stats, (c) => c.preco_medio),
      d3.min(stats, (c) => c.preco_medio),
    ]);
  simulation = d3
    .forceSimulation(stats)
    .force("charge", d3.forceManyBody().strength(8))
    .force("center", d3.forceCenter(W / 2, H / 2))
    .force(
      "collision",
      d3.forceCollide((d) => rS(d.preco_medio) + 5),
    );
  const bub = g
    .selectAll("g")
    .data(stats)
    .enter()
    .append("g")
    .style("cursor", "pointer");
  bub
    .append("circle")
    .attr("r", (d) => rS(d.preco_medio))
    .attr("fill", (d) => cS(d.preco_medio))
    .attr("fill-opacity", 0.78)
    .attr("stroke", "#fff3")
    .attr("stroke-width", 1);
  bub
    .append("text")
    .attr("text-anchor", "middle")
    .attr("dy", "-.2em")
    .attr("fill", "#fff")
    .attr("font-family", "Syne")
    .attr("font-weight", 700)
    .attr("font-size", (d) =>
      Math.max(8, Math.min(13, rS(d.preco_medio) * 0.28)),
    )
    .text((d) => d.cidade.split(" ")[0]);
  bub
    .append("text")
    .attr("text-anchor", "middle")
    .attr("dy", "1em")
    .attr("fill", "#ffffffbb")
    .attr("font-family", "JetBrains Mono")
    .attr("font-size", (d) =>
      Math.max(7, Math.min(11, rS(d.preco_medio) * 0.22)),
    )
    .text((d) => "R$" + (d.preco_medio / 1000).toFixed(0) + "k");
  bub
    .on("mousemove", (ev, d) => {
      tt.innerHTML = `<div class="tt-title">${d.cidade}</div>Média: <b>${fmt(d.preco_medio)}</b><br>Mín: <b>${fmt(d.preco_min)}</b><br>Anúncios: <b>${d.total}</b>`;
      tt.style.opacity = 1;
      tt.style.left = ev.offsetX + 14 + "px";
      tt.style.top = ev.offsetY - 10 + "px";
    })
    .on("mouseleave", () => (tt.style.opacity = 0))
    .on("click", (_, d) => {
      const sub = recs.filter((r) => r.cidade === d.cidade);
      showCarDetail(sub.reduce((a, c) => (c.valor < a.valor ? c : a), sub[0]));
    });
  simulation.on("tick", () =>
    bub.attr("transform", (d) => `translate(${d.x},${d.y})`),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ██████████████████  ALGORITMOS DE GRAFOS  ████████████████████████████████████
//
// Modelagem do grafo de cidades:
//   • Vértices  = cidades
//   • Arestas   = todos os pares de cidades (grafo completo)
//   • Peso      = diferença de preço médio entre as duas cidades
//                 → arestas leves conectam cidades com preços semelhantes
//
// Prim:    encontra a Árvore Geradora Mínima (MST) partindo da cidade mais
//          barata. Revela a "rota de menor distância econômica" entre cidades.
//
// Kruskal: também encontra a MST, mas escolhendo globalmente as arestas de
//          menor peso em ordem crescente. O resultado é o mesmo (MST única),
//          mas a animação mostra as arestas sendo adicionadas pelo peso —
//          tornando visível quais pares de cidades são economicamente
//          mais próximos no mercado.
// ═══════════════════════════════════════════════════════════════════════════════

function buildCityGraph() {
  const recs = getFiltered();
  const stats = cityStats(recs);
  // All pairs → complete graph
  const edges = [];
  for (let i = 0; i < stats.length; i++) {
    for (let j = i + 1; j < stats.length; j++) {
      edges.push({
        u: stats[i].cidade,
        v: stats[j].cidade,
        weight: Math.abs(stats[i].preco_medio - stats[j].preco_medio),
        meanU: stats[i].preco_medio,
        meanV: stats[j].preco_medio,
      });
    }
  }
  return { nodes: stats, edges };
}

// ── Union-Find (para Kruskal) ──────────────────────────────────────────────────
function makeUF(ids) {
  const p = {},
    r = {};
  ids.forEach((id) => {
    p[id] = id;
    r[id] = 0;
  });
  function find(x) {
    if (p[x] !== x) p[x] = find(p[x]);
    return p[x];
  }
  function union(a, b) {
    const ra = find(a),
      rb = find(b);
    if (ra === rb) return false;
    if (r[ra] < r[rb]) p[ra] = rb;
    else if (r[ra] > r[rb]) p[rb] = ra;
    else {
      p[rb] = ra;
      r[ra]++;
    }
    return true;
  }
  return { find, union };
}

// ── Draw MST overlay on the existing city layer ────────────────────────────────
function drawMSTOverlay(mstEdges, color, animDelay = 60) {
  if (!graphG) return;
  const cidades = window._graphCidades || [];
  const posMap = {};
  cidades.forEach((c) => (posMap[c.id] = { x: c.x, y: c.y }));

  // Dim all existing car-city edges
  d3.selectAll(".link").attr("opacity", 0.04);
  d3.selectAll(".node-car").attr("opacity", 0.08);
  d3.selectAll(".node-city").attr("opacity", 0.4);

  // Draw MST edges one by one with animation
  const mstG = graphG.append("g").attr("class", "mst-layer");
  let i = 0;
  function step() {
    if (i >= mstEdges.length) return showAlgoSummary(mstEdges, color);
    const e = mstEdges[i];
    const pu = posMap[e.u],
      pv = posMap[e.v];
    if (!pu || !pv) {
      i++;
      return setTimeout(step, animDelay);
    }
    // Animated line
    const line = mstG
      .append("line")
      .attr("x1", pu.x)
      .attr("y1", pu.y)
      .attr("x2", pu.x)
      .attr("y2", pu.y)
      .attr("stroke", color)
      .attr("stroke-width", 2.5)
      .attr("stroke-opacity", 0)
      .attr("stroke-linecap", "round");
    line
      .transition()
      .duration(animDelay * 4)
      .attr("x2", pv.x)
      .attr("y2", pv.y)
      .attr("stroke-opacity", 0.85);
    // Weight label at midpoint
    mstG
      .append("text")
      .attr("x", (pu.x + pv.x) / 2)
      .attr("y", (pu.y + pv.y) / 2 - 5)
      .attr("text-anchor", "middle")
      .attr("fill", color)
      .attr("font-family", "JetBrains Mono")
      .attr("font-size", 9)
      .attr("opacity", 0)
      .text("Δ" + fmt(e.weight))
      .transition()
      .delay(animDelay * 3)
      .duration(200)
      .attr("opacity", 0.8);
    // Highlight endpoints
    d3.selectAll(".node-city")
      .filter((d) => d.id === e.u || d.id === e.v)
      .transition()
      .duration(200)
      .attr("opacity", 1);
    i++;
    setTimeout(step, animDelay * 2);
  }
  setTimeout(step, 300);
}

function showAlgoSummary(mstEdges, color) {
  const totalCost = mstEdges.reduce((s, e) => s + e.weight, 0);
  const leg = document.getElementById("algo-legend");
  leg.style.display = "block";
  document.getElementById("al-body").innerHTML =
    `<div class="al-step">Arestas na MST: <b>${mstEdges.length}</b></div>` +
    `<div class="al-step">Custo total (Δpreço): <span class="al-cost">${fmt(totalCost)}</span></div>` +
    `<div class="al-step" style="margin-top:8px;color:var(--text)">Pares de cidades mais próximas economicamente:</div>` +
    mstEdges
      .slice(0, 4)
      .map(
        (e) =>
          `<div class="al-step">• ${e.u.split(" ")[0]} ↔ ${e.v.split(" ")[0]} <span class="al-cost">Δ${fmt(e.weight)}</span></div>`,
      )
      .join("");
}

// ── PRIM ──────────────────────────────────────────────────────────────────────
function runPrim() {
  algoActive = "prim";
  document.getElementById("btnReset").style.display = "inline-block";
  document.getElementById("algo-legend").style.display = "none";
  document.getElementById("al-title").textContent =
    "🌲 Prim — MST por Preço Médio";
  d3.select(".mst-layer").remove();

  const { nodes, edges } = buildCityGraph();
  if (nodes.length < 2) return;

  // Sort edges by weight for fast lookup
  const adjMap = {};
  edges.forEach((e) => {
    if (!adjMap[e.u]) adjMap[e.u] = [];
    if (!adjMap[e.v]) adjMap[e.v] = [];
    adjMap[e.u].push({ to: e.v, weight: e.weight, e });
    adjMap[e.v].push({ to: e.u, weight: e.weight, e });
  });

  // Start from cheapest city
  const start = nodes.reduce((a, b) =>
    b.preco_medio < a.preco_medio ? b : a,
  ).cidade;
  const inMST = new Set([start]);
  const mstEdges = [];

  while (inMST.size < nodes.length) {
    let best = null;
    inMST.forEach((u) => {
      (adjMap[u] || []).forEach(({ to, weight, e }) => {
        if (!inMST.has(to) && (!best || weight < best.weight))
          best = { ...e, u, v: to };
      });
    });
    if (!best) break;
    inMST.add(best.v);
    mstEdges.push(best);
  }

  drawMSTOverlay(mstEdges, "#3ecf8e", 80);
}

// ── KRUSKAL ───────────────────────────────────────────────────────────────────
function runKruskal() {
  algoActive = "kruskal";
  document.getElementById("btnReset").style.display = "inline-block";
  document.getElementById("algo-legend").style.display = "none";
  document.getElementById("al-title").textContent =
    "🔗 Kruskal — MST por Preço Médio";
  d3.select(".mst-layer").remove();

  const { nodes, edges } = buildCityGraph();
  if (nodes.length < 2) return;

  const sorted = [...edges].sort((a, b) => a.weight - b.weight);
  const uf = makeUF(nodes.map((n) => n.cidade));
  const mstEdges = [];

  for (const e of sorted) {
    if (mstEdges.length >= nodes.length - 1) break;
    if (uf.union(e.u, e.v)) mstEdges.push(e);
  }

  drawMSTOverlay(mstEdges, "#9b59b6", 70);
}

function clearAlgo() {
  algoActive = null;
  d3.select(".mst-layer").remove();
  document.getElementById("algo-legend").style.display = "none";
  document.getElementById("btnPrim").classList.remove("prim-active");
  document.getElementById("btnKruskal").classList.remove("kruskal-active");
}

// Algo button handlers
document.getElementById("btnPrim").addEventListener("click", () => {
  if (viewMode !== "grafo") {
    viewMode = "grafo";
    document.querySelectorAll("[data-mode]").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === "grafo");
    });
    renderGrafo();
    renderCidades();
    renderEstatisticas();
    renderFrequencias();
  }
  clearAlgo();
  document.getElementById("btnPrim").classList.add("prim-active");
  algoActive = "prim";
  if (simulation && simulation.alpha() < 0.05) runPrim();
  else {
    algoActive = "prim";
  }
});

document.getElementById("btnKruskal").addEventListener("click", () => {
  if (viewMode !== "grafo") {
    viewMode = "grafo";
    document.querySelectorAll("[data-mode]").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === "grafo");
    });
    renderGrafo();
    renderCidades();
    renderEstatisticas();
    renderFrequencias();
  }
  clearAlgo();
  document.getElementById("btnKruskal").classList.add("kruskal-active");
  algoActive = "kruskal";
  if (simulation && simulation.alpha() < 0.05) runKruskal();
  else {
    algoActive = "kruskal";
  }
});

document.getElementById("btnReset").addEventListener("click", () => {
  clearAlgo();
  resetFocus();
});

// ── Toggle de auto-zoom ────────────────────────────────────────────────────────
document.getElementById("btnZoomLock").addEventListener("click", () => {
  autoZoom = !autoZoom;
  const btn = document.getElementById("btnZoomLock");
  btn.textContent = autoZoom ? "🔍 Auto-zoom" : "🔒 Zoom fixo";
  btn.classList.toggle("active", autoZoom);
  btn.title = autoZoom
    ? "Auto-zoom ativado — clique para fixar o zoom"
    : "Zoom fixo — clique para reativar o auto-zoom";
});

// ═══════════════════════════════════════════════════════════════════════════════
// MODE TOGGLE + REFRESH
// ═══════════════════════════════════════════════════════════════════════════════
document.querySelectorAll("[data-mode]").forEach((btn) =>
  btn.addEventListener("click", () => {
    document
      .querySelectorAll("[data-mode]")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    viewMode = btn.dataset.mode;
    renderGraph();
  }),
);

function renderGraph() {
  if (viewMode === "grafo") renderGrafo();
  else renderBolhas();
}
function refresh() {
  document.getElementById("btnReset").style.display = "none";
  document.getElementById("algo-legend").style.display = "none";
  renderGraph();
  renderCidades();
  renderEstatisticas();
  renderFrequencias();
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATA WARNING
// ═══════════════════════════════════════════════════════════════════════════════
function showDataWarning() {
  document.getElementById("graph-area").innerHTML = `
    <div class="data-warn">
      <div style="font-size:28px;margin-bottom:12px">⚠️</div>
      <div style="font-size:14px;font-weight:700;margin-bottom:8px">Arquivo <code>dados_olx.js</code> não encontrado</div>
      <div>1. Execute <code>python scrapPaginas_v4.py</code><br>
           2. Coloque <code>dados_olx.js</code> e <code>AnalisadorOLX.html</code> na mesma pasta<br>
           3. Reabra o HTML no navegador</div>
    </div>`;
  ["cidades", "estatisticas", "frequencias"].forEach(
    (t) =>
      (document.getElementById("tab-" + t).innerHTML =
        '<div class="no-data">Aguardando dados_olx.js</div>'),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════════
// ── Debounce util ─────────────────────────────────────────────────────────────
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

window.addEventListener("load", async () => {
  if (!(await loadData())) {
    showDataWarning();
    return;
  }
  initBrandFilter();
  initSearch();
  refresh();
  window.addEventListener("resize", debounce(renderGraph, 150));

  // Pausa a simulação quando a aba fica em background
  document.addEventListener("visibilitychange", () => {
    if (!simulation) return;
    if (document.hidden) simulation.stop();
    else if (simulation.alpha() > 0.001) simulation.restart();
  });
});
