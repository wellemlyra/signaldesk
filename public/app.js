const $ = (selector) => document.querySelector(selector);
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const labels = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
  critical: "Critical",
  major: "Major",
  minor: "Minor",
};
const headings = {
  overview: [
    "Overview",
    "Operations overview",
    "A clear picture of your services. A faster path to resolution.",
  ],
  incidents: [
    "Incidents",
    "Every incident. One place",
    "Follow the response from the first signal to the final resolution.",
  ],
  services: [
    "Services",
    "Know where things stand",
    "Service health, derived from the incidents in your workspace.",
  ],
  playbook: [
    "Response playbook",
    "A little structure. Less chaos",
    "A practical guide for the moments when every decision counts.",
  ],
};
let data,
  view = "overview",
  detailId,
  filters = { q: "", status: "", severity: "", service: "" },
  toastTimer;
async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Something went wrong. Please try again.");
  return result;
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 4000);
}
function time(value) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
function age(value) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(value)) / 60000),
  );
  return minutes < 60
    ? `${minutes}m ago`
    : minutes < 1440
      ? `${Math.floor(minutes / 60)}h ago`
      : `${Math.floor(minutes / 1440)}d ago`;
}
function tag(value) {
  return `<span class="tag ${escape(value)}">${["critical", "major", "minor"].includes(value) ? "◈" : '<span class="status-dot"></span>'} ${escape(labels[value])}</span>`;
}
function health(service) {
  return `<span class="health-label ${escape(service.health)}"><span class="status-dot"></span>${service.health === "operational" ? "Operational" : service.health === "degraded" ? "Degraded" : "Disrupted"}</span>`;
}
function serviceSymbol(id) {
  return (
    {
      api: "⌘",
      checkout: "↗",
      auth: "◇",
      notifications: "◷",
      storage: "▤",
      web: "▦",
    }[id] || "▦"
  );
}
function metric(label, value, unit, note, icon) {
  return `<article class="metric"><div class="metric-label">${label}<span class="metric-icon" aria-hidden="true">${icon}</span></div><div class="metric-value">${value}${unit ? `<small>${unit}</small>` : ""}</div><div class="metric-note">${note}</div></article>`;
}
function chart() {
  const max = Math.max(4, ...data.trend.flatMap((d) => [d.opened, d.resolved]));
  return `<section class="panel"><div class="panel-heading"><div><h2>Incident activity</h2><p>A week of signals and resolutions · UTC</p></div><span class="period">Last 7 days</span></div><div class="legend"><span><i></i> Opened</span><span><i class="secondary"></i> Resolved</span></div><div class="chart" role="img" aria-label="${escape(data.trend.map((d) => `${d.day}: ${d.opened} opened, ${d.resolved} resolved`).join("; "))}"><div class="chart-scale"><span>${max}</span><span>${Math.round(max / 2)}</span><span>0</span></div><div class="chart-plot">${data.trend.map((d) => `<div class="chart-day" title="${escape(d.day)}: ${d.opened} opened, ${d.resolved} resolved"><div class="bars"><div class="bar h${Math.round((d.opened / max) * 8)}"></div><div class="bar resolved h${Math.round((d.resolved / max) * 8)}"></div></div><span class="day-label">${new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" }).format(new Date(d.day + "T12:00:00Z"))}</span></div>`).join("")}</div></div></section>`;
}
function servicesPanel() {
  return `<section class="panel"><div class="panel-heading"><div><h2>Service health <span class="count-badge">${data.services.length}</span></h2><p>Current status across your stack</p></div><a class="quiet-link" href="#services">View all ↗</a></div><div class="service-list">${data.services.map((s) => `<div class="service-row"><span class="service-square" aria-hidden="true">${serviceSymbol(s.id)}</span><span>${escape(s.name)}</span>${health(s)}</div>`).join("")}</div></section>`;
}
function visibleIncidents() {
  return data.incidents.filter(
    (i) =>
      (!filters.q ||
        `${i.title} ${i.number}`
          .toLowerCase()
          .includes(filters.q.toLowerCase())) &&
      (!filters.status ||
        (filters.status === "active"
          ? i.status !== "resolved"
          : i.status === filters.status)) &&
      (!filters.severity || i.severity === filters.severity) &&
      (!filters.service || i.service_id === filters.service),
  );
}
function rows() {
  const all = visibleIncidents(),
    shown = view === "overview" ? all.slice(0, 5) : all;
  return shown.length
    ? shown
        .map(
          (i) =>
            `<tr><td><button class="incident-link" data-incident="${escape(i.id)}"><span class="incident-symbol" aria-hidden="true">ϟ</span><span><span class="incident-title">${escape(i.title)}</span><span class="incident-number">INC-${i.number}</span></span></button></td><td>${tag(i.severity)}</td><td>${tag(i.status)}</td><td>${escape(i.service_name)}</td><td><time datetime="${escape(i.created_at)}" title="${time(i.created_at)}">${age(i.created_at)}</time></td></tr>`,
        )
        .join("")
    : '<tr><td colspan="5"><div class="empty"><strong>No incidents found.</strong>Try another filter, or create your first incident.</div></td></tr>';
}
function renderRows() {
  $("#incident-rows").innerHTML = rows();
  const count = visibleIncidents().length;
  $("#table-count").textContent = count;
  $("#table-summary").textContent =
    `Showing ${view === "overview" ? Math.min(5, count) : count} of ${count} incidents`;
}
function table() {
  return `<section class="panel table-panel"><div class="panel-heading"><div><h2>${view === "overview" ? "Recent incidents" : "Incident workspace"} <span class="count-badge" id="table-count">${visibleIncidents().length}</span></h2><p>Every response starts with a clear signal.</p></div><div class="table-actions"><button class="button button-secondary" id="export">↓ Export JSON</button></div></div><div class="filters"><div class="search-wrap"><span aria-hidden="true">⌕</span><input id="search" type="search" aria-label="Search incidents" placeholder="Search incidents by title or ID…" value="${escape(filters.q)}"></div><select id="status-filter" aria-label="Filter by status"><option value="">All statuses</option><option value="active">Active only</option>${Object.entries(
    labels,
  )
    .filter(([key]) => !["critical", "major", "minor"].includes(key))
    .map(
      ([key, label]) =>
        `<option value="${key}" ${filters.status === key ? "selected" : ""}>${label}</option>`,
    )
    .join(
      "",
    )}</select><select id="severity-filter" aria-label="Filter by severity"><option value="">All severities</option>${["critical", "major", "minor"].map((s) => `<option value="${s}" ${filters.severity === s ? "selected" : ""}>${labels[s]}</option>`).join("")}</select>${filters.service ? '<button class="button button-secondary" id="clear-service">Clear service</button>' : ""}</div><div class="table-scroll"><table><thead><tr><th scope="col">INCIDENT</th><th scope="col">SEVERITY</th><th scope="col">STATUS</th><th scope="col">SERVICE</th><th scope="col">OPENED</th></tr></thead><tbody id="incident-rows">${rows()}</tbody></table></div><div class="table-bottom"><span id="table-summary">Showing ${view === "overview" ? Math.min(5, visibleIncidents().length) : visibleIncidents().length} of ${visibleIncidents().length} incidents</span>${view === "overview" ? '<a class="quiet-link" href="#incidents">View all incidents →</a>' : "<span>Newest first</span>"}</div></section>`;
}
function overview() {
  const m = data.metrics,
    affected = data.services.length - m.healthy;
  return `<div class="health-banner ${affected ? "" : "good"}"><span class="health-symbol" aria-hidden="true">${affected ? "ϟ" : "✓"}</span><div><strong>${affected ? `${affected} services need your attention` : "All services are operational"}</strong><p>${affected ? "Active incidents are affecting your workspace. Let’s get things back on track." : "There are no active incidents in this workspace."}</p></div><a class="quiet-link" href="#incidents">Review incidents →</a></div><div class="metrics">${metric("Active incidents", m.active, "", `<b class="${m.critical ? "warn" : ""}">${m.critical} critical</b> · requiring attention`, "ϟ")}${metric("Healthy services", m.healthy, `/ ${data.services.length}`, "Based on current incident status", "◉")}${metric("Mean time to resolve", m.mttr_minutes ?? "—", m.mttr_minutes === null ? "" : "min", "Opened → resolved · all resolved incidents", "◷")}${metric("Resolved incidents", m.resolved, "", `<b>${m.total ? Math.round((m.resolved / m.total) * 100) : 0}%</b> of all recorded incidents`, "✓")}</div><div class="dashboard-grid">${chart()}${servicesPanel()}</div>${table()}`;
}
function services() {
  return `<div class="services-grid">${data.services.map((s) => `<article class="panel service-card"><span class="service-square" aria-hidden="true">${serviceSymbol(s.id)}</span><h2>${escape(s.name)}</h2><p>${escape(s.category)} · ${s.active_count} active incident${s.active_count === 1 ? "" : "s"}</p><div class="service-card-bottom">${health(s)}<button class="quiet-link" data-service="${escape(s.id)}">View incidents →</button></div></article>`).join("")}</div><div class="playbook-note">Service health reflects open incidents: critical incidents mark a service as disrupted; other open incidents mark it as degraded. With no open incidents, a service is operational. No external health checks are running.</div>`;
}
function playbook() {
  const steps = [
    [
      "01",
      "Investigate the signal",
      "Start by understanding the impact. Capture what customers are experiencing before jumping to a solution.",
      [
        "Open an incident with a clear, specific title.",
        "Choose the affected service and severity.",
        "Document symptoms and what you have checked.",
      ],
    ],
    [
      "02",
      "Identify the cause",
      "Make the next action concrete. Record the evidence behind your working diagnosis.",
      [
        "Separate observations from assumptions.",
        "Move to Identified when you have isolated the cause.",
        "Add a timeline update with the mitigation plan.",
      ],
    ],
    [
      "03",
      "Monitor the recovery",
      "A deployed fix is a hypothesis. Check whether the service actually recovers.",
      [
        "Move to Monitoring after applying a mitigation.",
        "Record the checks you performed and their results.",
        "Return to Investigating if symptoms reappear.",
      ],
    ],
    [
      "04",
      "Resolve and learn",
      "Close the loop when recovery is verified. Leave enough context for the next responder.",
      [
        "Summarize impact, cause and recovery.",
        "Move to Resolved; the resolution time is recorded.",
        "Reopen the incident if the same issue returns.",
      ],
    ],
  ];
  return `<div class="playbook-grid">${steps.map(([n, title, description, items]) => `<article class="panel playbook-card"><div class="step">${n}</div><h2>${title}</h2><p>${description}</p><ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul></article>`).join("")}</div><div class="playbook-note"><strong>Severity guide:</strong> Critical — service unavailable or severe customer impact. Major — partial disruption or a core workflow affected. Minor — limited impact with a viable workaround. This guide is illustrative; real teams should agree on their own criteria.</div>`;
}
function render() {
  const requested = location.hash.slice(1) || "overview";
  view = Object.hasOwn(headings, requested) ? requested : "overview";
  const [short, title, description] = headings[view];
  document.title = `SignalDesk · ${short}`;
  $("#breadcrumb").textContent = short;
  $("#page-title").innerHTML = `${escape(title)}<span>.</span>`;
  $("#page-description").textContent = description;
  document.querySelectorAll("[data-view]").forEach((el) => {
    const active = el.dataset.view === view;
    el.classList.toggle("active", active);
    if (active) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  $("#nav-count").textContent = data.metrics.active;
  $("#content").innerHTML =
    view === "overview"
      ? overview()
      : view === "incidents"
        ? table()
        : view === "services"
          ? services()
          : playbook();
  if ($("#status-filter")) $("#status-filter").value = filters.status;
  $("#service-select").innerHTML = data.services
    .map((s) => `<option value="${escape(s.id)}">${escape(s.name)}</option>`)
    .join("");
}
async function load() {
  try {
    data = await api("/api/dashboard");
    $("#error-banner").hidden = true;
    render();
    return true;
  } catch (error) {
    $("#error-banner").textContent =
      `Could not load workspace: ${error.message} Check that the local server is running, then use Refresh.`;
    $("#error-banner").hidden = false;
    if (!data)
      $("#content").innerHTML =
        '<div class="empty">Workspace unavailable. Your saved data has not been changed.</div>';
    return false;
  }
}
function detailMarkup(i) {
  return `<div class="dialog-heading"><div><span class="eyebrow">INC-${i.number} · INCIDENT DETAIL</span><h2 id="detail-title">${escape(i.title)}</h2></div><button class="icon-button close-dialog" aria-label="Close incident detail">×</button></div><div class="detail-meta">${tag(i.severity)}${tag(i.status)}<span>${escape(i.service_name)}</span><span>Opened ${time(i.created_at)}</span></div><p class="detail-description">${escape(i.description)}</p><div class="detail-divider"></div><form id="update-form"><span class="section-label">Post an update</span><label>Status<select name="status"><option value="${escape(i.status)}">${escape(labels[i.status])} (current)</option>${i.next_statuses.map((s) => `<option value="${escape(s)}">${s === "investigating" ? "Reopen investigation" : escape(labels[s])}</option>`).join("")}</select></label><label>Response notes<textarea name="message" maxlength="2000" rows="3" placeholder="What changed? What happens next?"></textarea></label><p class="form-error" role="alert"></p><div class="dialog-actions"><button class="button button-primary" type="submit">Save update</button></div></form><div class="detail-divider"></div><span class="section-label">Activity timeline · ${i.events.length} events</span><ol class="timeline">${i.events.map((e) => `<li><p>${escape(e.message)}</p><time datetime="${escape(e.created_at)}">${time(e.created_at)}</time></li>`).join("")}</ol>`;
}
async function openDetail(id) {
  try {
    const incident = await api(`/api/incidents/${id}`);
    detailId = id;
    $("#detail-content").innerHTML = detailMarkup(incident);
    if (!$("#detail-dialog").open) $("#detail-dialog").showModal();
  } catch (error) {
    toast(error.message);
  }
}
$("#new-incident").addEventListener("click", () => {
  if (!data) return toast("Load your workspace first.");
  $("#create-form").reset();
  $("#create-form .form-error").textContent = "";
  $("#create-dialog").showModal();
});
$("#about").addEventListener("click", () => $("#about-dialog").showModal());
$("#refresh").addEventListener("click", async () => {
  $("#refresh").disabled = true;
  try {
    if (await load()) toast("Workspace refreshed.");
  } finally {
    $("#refresh").disabled = false;
  }
});
window.addEventListener("hashchange", () => {
  if (data) render();
});
document.addEventListener("click", (event) => {
  const close = event.target.closest(".close-dialog");
  if (close) close.closest("dialog").close();
  const incident = event.target.closest("[data-incident]");
  if (incident) openDetail(incident.dataset.incident);
  const service = event.target.closest("[data-service]");
  if (service) {
    filters = {
      q: "",
      status: "",
      severity: "",
      service: service.dataset.service,
    };
    location.hash = "incidents";
  }
  if (event.target.closest("#clear-service")) {
    filters.service = "";
    render();
  }
  if (event.target.closest("#export")) {
    const items = visibleIncidents();
    const blob = new Blob(
      [
        JSON.stringify(
          { exported_at: new Date().toISOString(), incidents: items },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = "signaldesk-incidents.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Exported ${items.length} incidents.`);
  }
});
$("#content").addEventListener("input", (event) => {
  if (event.target.id === "search") {
    filters.q = event.target.value;
    renderRows();
  }
});
$("#content").addEventListener("change", (event) => {
  if (event.target.id === "status-filter") filters.status = event.target.value;
  else if (event.target.id === "severity-filter")
    filters.severity = event.target.value;
  else return;
  renderRows();
});
$("#create-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target,
    button = form.querySelector("[type=submit]");
  button.disabled = true;
  form.querySelector(".form-error").textContent = "";
  try {
    const incident = await api("/api/incidents", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    $("#create-dialog").close();
    filters = { q: "", status: "", severity: "", service: "" };
    await load();
    toast(`INC-${incident.number} created.`);
    await openDetail(incident.id);
  } catch (error) {
    form.querySelector(".form-error").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
$("#detail-dialog").addEventListener("submit", async (event) => {
  if (event.target.id !== "update-form") return;
  event.preventDefault();
  const form = event.target,
    button = form.querySelector("[type=submit]");
  button.disabled = true;
  form.querySelector(".form-error").textContent = "";
  const input = Object.fromEntries(new FormData(form));
  if (!input.message.trim()) delete input.message;
  try {
    const incident = await api(`/api/incidents/${detailId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    $("#detail-content").innerHTML = detailMarkup(incident);
    $("#detail-content select").focus();
    await load();
    toast("Update saved to the timeline.");
  } catch (error) {
    form.querySelector(".form-error").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
await load();
