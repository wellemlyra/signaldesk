import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export const STATUSES = [
  "investigating",
  "identified",
  "monitoring",
  "resolved",
];
export const SEVERITIES = ["critical", "major", "minor"];
const NEXT = {
  investigating: ["identified", "resolved"],
  identified: ["monitoring", "resolved"],
  monitoring: ["resolved", "investigating"],
  resolved: ["investigating"],
};
export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
function text(value, name, max, min = 1) {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max
  )
    throw new AppError(`${name} must contain ${min}–${max} characters.`);
  return value.trim();
}
function member(value, values, name) {
  if (!values.includes(value)) throw new AppError(`Invalid ${name}.`);
  return value;
}

export function createStore(filename = ":memory:", { seed = true } = {}) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY, number INTEGER UNIQUE NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
      service_id TEXT NOT NULL REFERENCES services(id), severity TEXT NOT NULL CHECK(severity IN ('critical','major','minor')),
      status TEXT NOT NULL CHECK(status IN ('investigating','identified','monitoring','resolved')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, resolved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, incident_id TEXT NOT NULL REFERENCES incidents(id), kind TEXT NOT NULL,
      message TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_incident ON events(incident_id, created_at);
    PRAGMA user_version = 1;`);
  const serviceRows = [
    ["api", "Core API", "Platform"],
    ["checkout", "Checkout", "Commerce"],
    ["auth", "Authentication", "Identity"],
    ["notifications", "Notifications", "Messaging"],
    ["storage", "Object storage", "Infrastructure"],
    ["web", "Web application", "Experience"],
  ];
  for (const row of serviceRows)
    db.prepare("INSERT OR IGNORE INTO services VALUES (?, ?, ?)").run(...row);
  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  function get(id) {
    const incident = db
      .prepare(
        "SELECT i.*, s.name AS service_name FROM incidents i JOIN services s ON s.id=i.service_id WHERE i.id=?",
      )
      .get(id);
    if (!incident) throw new AppError("Incident not found.", 404);
    return {
      ...incident,
      events: db
        .prepare(
          "SELECT * FROM events WHERE incident_id=? ORDER BY created_at DESC, rowid DESC",
        )
        .all(id),
      next_statuses: NEXT[incident.status],
    };
  }
  function event(id, kind, message, at) {
    db.prepare("INSERT INTO events VALUES (?, ?, ?, ?, ?)").run(
      randomUUID(),
      id,
      kind,
      message,
      at,
    );
  }
  function create(input, at = new Date().toISOString()) {
    const title = text(input.title, "Title", 120, 5);
    const description = text(input.description, "Description", 3000, 10);
    const severity = member(input.severity, SEVERITIES, "severity");
    if (
      !db
        .prepare("SELECT id FROM services WHERE id=?")
        .get(String(input.service_id))
    )
      throw new AppError("Choose an existing service.");
    return transaction(() => {
      const id = randomUUID();
      const number = db
        .prepare("SELECT COALESCE(MAX(number), 1000) + 1 AS n FROM incidents")
        .get().n;
      db.prepare(
        "INSERT INTO incidents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)",
      ).run(
        id,
        number,
        title,
        description,
        input.service_id,
        severity,
        "investigating",
        at,
        at,
      );
      event(id, "created", "Incident opened. Investigation started.", at);
      return get(id);
    });
  }
  function update(id, input, at = new Date().toISOString()) {
    return transaction(() => {
      const current = get(id);
      if (input.status === undefined && input.message === undefined)
        throw new AppError("Provide a status or an update.");
      const status =
        input.status === undefined
          ? current.status
          : member(input.status, STATUSES, "status");
      const message =
        input.message === undefined ? "" : text(input.message, "Update", 2000);
      if (status !== current.status && !NEXT[current.status].includes(status))
        throw new AppError(
          `Cannot move from ${current.status} to ${status}.`,
          409,
        );
      if (status === current.status && !message)
        throw new AppError("Add an update or choose a different status.");
      db.prepare(
        "UPDATE incidents SET status=?, updated_at=?, resolved_at=? WHERE id=?",
      ).run(
        status,
        at,
        status === "resolved" ? current.resolved_at || at : null,
        id,
      );
      if (status !== current.status)
        event(
          id,
          "status",
          `Status changed from ${current.status} to ${status}.`,
          at,
        );
      if (message) event(id, "note", message, at);
      return get(id);
    });
  }
  function list({ q = "", status = "", severity = "", service = "" } = {}) {
    if (status && status !== "active") member(status, STATUSES, "status");
    if (severity) member(severity, SEVERITIES, "severity");
    const clauses = [],
      values = [];
    if (q) {
      clauses.push(
        "(i.title LIKE ? ESCAPE '\\' OR CAST(i.number AS TEXT) LIKE ? ESCAPE '\\')",
      );
      const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
      values.push(pattern, pattern);
    }
    if (status === "active") clauses.push("i.status != 'resolved'");
    else if (status) {
      clauses.push("i.status=?");
      values.push(status);
    }
    if (severity) {
      clauses.push("i.severity=?");
      values.push(severity);
    }
    if (service) {
      clauses.push("i.service_id=?");
      values.push(service);
    }
    return db
      .prepare(
        `SELECT i.*, s.name AS service_name FROM incidents i JOIN services s ON s.id=i.service_id ${clauses.length ? "WHERE " + clauses.join(" AND ") : ""} ORDER BY i.created_at DESC, i.number DESC`,
      )
      .all(...values);
  }
  function snapshot() {
    const incidents = list();
    const services = db
      .prepare("SELECT * FROM services ORDER BY name")
      .all()
      .map((s) => {
        const active = incidents.filter(
          (i) => i.service_id === s.id && i.status !== "resolved",
        );
        return {
          ...s,
          active_count: active.length,
          health: active.some((i) => i.severity === "critical")
            ? "disrupted"
            : active.length
              ? "degraded"
              : "operational",
        };
      });
    const resolved = incidents.filter((i) => i.resolved_at);
    const active = incidents.filter((i) => i.status !== "resolved");
    const trend = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() - 6 + index);
      const day = date.toISOString().slice(0, 10);
      return {
        day,
        opened: incidents.filter((i) => i.created_at.startsWith(day)).length,
        resolved: incidents.filter((i) => i.resolved_at?.startsWith(day))
          .length,
      };
    });
    return {
      services,
      incidents,
      trend,
      metrics: {
        active: active.length,
        critical: active.filter((i) => i.severity === "critical").length,
        resolved: resolved.length,
        total: incidents.length,
        healthy: services.filter((s) => s.health === "operational").length,
        mttr_minutes: resolved.length
          ? Math.round(
              resolved.reduce(
                (sum, i) =>
                  sum +
                  (Date.parse(i.resolved_at) - Date.parse(i.created_at)) /
                    60000,
                0,
              ) / resolved.length,
            )
          : null,
      },
    };
  }
  if (seed && !db.prepare("SELECT COUNT(*) AS n FROM incidents").get().n) {
    const fixtures = [
      [
        "Elevated latency on payment requests",
        "Checkout requests are taking longer than expected. The team is checking the payment provider connection.",
        "checkout",
        "critical",
        42,
        "investigating",
      ],
      [
        "Delayed transactional emails",
        "Delivery queue is growing for order confirmation emails. Messages remain queued for retry.",
        "notifications",
        "major",
        128,
        "identified",
      ],
      [
        "Intermittent API response errors",
        "A small subset of API requests returned errors after the latest release. A rollback has been applied.",
        "api",
        "minor",
        205,
        "monitoring",
      ],
      [
        "Session refresh failures",
        "Some sessions failed to refresh. The authentication cache was cleared and the fix verified.",
        "auth",
        "major",
        1490,
        "resolved",
      ],
      [
        "Slow image delivery",
        "Object storage response times increased during a scheduled replication job.",
        "storage",
        "minor",
        2910,
        "resolved",
      ],
      [
        "Search results unavailable",
        "Search requests failed after an index update. The previous index was restored.",
        "web",
        "major",
        4330,
        "resolved",
      ],
      [
        "API connection pool exhausted",
        "A traffic spike exhausted the connection pool. Pool limits were adjusted and verified.",
        "api",
        "critical",
        5680,
        "resolved",
      ],
      [
        "Sign-in email delays",
        "Sign-in emails were delayed due to a provider queue. Delivery recovered after retry.",
        "auth",
        "minor",
        7200,
        "resolved",
      ],
      [
        "Checkout validation issue",
        "A validation rule rejected valid postal codes. The rule was corrected and orders recovered.",
        "checkout",
        "minor",
        8650,
        "resolved",
      ],
    ];
    for (const [
      title,
      description,
      service_id,
      severity,
      age,
      status,
    ] of fixtures) {
      const opened = Date.now() - age * 60000;
      const item = create(
        { title, description, service_id, severity },
        new Date(opened).toISOString(),
      );
      if (status !== "investigating")
        update(
          item.id,
          {
            status: "identified",
            message:
              "The source of the issue has been isolated. Mitigation is in progress.",
          },
          new Date(opened + 12 * 60000).toISOString(),
        );
      if (["monitoring", "resolved"].includes(status))
        update(
          item.id,
          {
            status: "monitoring",
            message: "Mitigation applied. Watching the service for recurrence.",
          },
          new Date(opened + 24 * 60000).toISOString(),
        );
      if (status === "resolved")
        update(
          item.id,
          {
            status: "resolved",
            message: "Recovery verified. Service is operating normally.",
          },
          new Date(opened + (35 + (age % 55)) * 60000).toISOString(),
        );
    }
  }
  return { create, update, get, list, snapshot, close: () => db.close() };
}
