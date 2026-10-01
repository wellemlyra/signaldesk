import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStore } from "../src/store.js";
import { createApp } from "../src/server.js";
const input = {
  title: "Checkout is unavailable",
  description: "Customers see an error when placing orders.",
  service_id: "checkout",
  severity: "critical",
};
function storeTest(name, fn) {
  test(name, () => {
    const store = createStore(":memory:", { seed: false });
    try {
      fn(store);
    } finally {
      store.close();
    }
  });
}
storeTest(
  "incident lifecycle records an audit trail, MTTR and service recovery",
  (store) => {
    const incident = store.create(input, "2026-01-01T12:00:00.000Z");
    assert.equal(incident.status, "investigating");
    assert.equal(
      store.snapshot().services.find((s) => s.id === "checkout").health,
      "disrupted",
    );
    store.update(
      incident.id,
      { status: "identified", message: "Provider failure confirmed." },
      "2026-01-01T12:10:00.000Z",
    );
    store.update(
      incident.id,
      { status: "monitoring" },
      "2026-01-01T12:20:00.000Z",
    );
    const resolved = store.update(
      incident.id,
      { status: "resolved" },
      "2026-01-01T12:40:00.000Z",
    );
    assert.equal(resolved.events.length, 5);
    assert.equal(resolved.resolved_at, "2026-01-01T12:40:00.000Z");
    assert.equal(store.snapshot().metrics.mttr_minutes, 40);
    assert.equal(
      store.snapshot().services.find((s) => s.id === "checkout").health,
      "operational",
    );
  },
);
storeTest(
  "invalid transitions are rejected without partial writes",
  (store) => {
    const i = store.create(input);
    assert.throws(
      () =>
        store.update(i.id, {
          status: "monitoring",
          message: "Must not be saved",
        }),
      /Cannot move/,
    );
    assert.equal(store.get(i.id).status, "investigating");
    assert.equal(store.get(i.id).events.length, 1);
  },
);
storeTest(
  "reopening clears resolution and restores the health impact",
  (store) => {
    const i = store.create(input);
    store.update(i.id, { status: "resolved" });
    store.update(i.id, { status: "investigating" });
    assert.equal(store.get(i.id).resolved_at, null);
    assert.equal(store.snapshot().metrics.resolved, 0);
    assert.equal(store.snapshot().metrics.mttr_minutes, null);
    assert.equal(store.snapshot().metrics.active, 1);
  },
);
storeTest(
  "validation rejects malformed incident and update inputs",
  (store) => {
    for (const patch of [
      { title: "abc" },
      { description: "short" },
      { severity: "urgent" },
      { service_id: "missing" },
      { title: 123 },
      { title: "a".repeat(121) },
    ])
      assert.throws(() => store.create({ ...input, ...patch }));
    assert.equal(store.list().length, 0);
    const i = store.create(input);
    assert.throws(() => store.update(i.id, {}), /Provide/);
    assert.throws(() => store.update(i.id, { message: "  " }), /Update/);
    assert.throws(() => store.update(i.id, { status: "unknown" }), /Invalid/);
    assert.throws(
      () => store.update(i.id, { status: "investigating" }),
      /Add an update/,
    );
  },
);
storeTest(
  "filters combine correctly and SQL metacharacters are literal",
  (store) => {
    store.create(input);
    store.create({
      ...input,
      title: "100% traffic on API",
      service_id: "api",
      severity: "minor",
    });
    assert.equal(store.list({ severity: "minor", q: "100%" }).length, 1);
    assert.equal(store.list({ q: "%" }).length, 1);
    assert.equal(store.list({ q: "' OR 1=1 --" }).length, 0);
    assert.equal(
      store.list({ service: "checkout", status: "active" }).length,
      1,
    );
    assert.throws(() => store.list({ status: "nope" }), /Invalid/);
  },
);
storeTest(
  "multiple incidents keep a service degraded until every incident resolves",
  (store) => {
    const a = store.create(input),
      b = store.create({ ...input, severity: "minor" });
    store.update(a.id, { status: "resolved" });
    assert.equal(
      store.snapshot().services.find((s) => s.id === "checkout").health,
      "degraded",
    );
    store.update(b.id, { status: "resolved" });
    assert.equal(
      store.snapshot().services.find((s) => s.id === "checkout").health,
      "operational",
    );
  },
);
test("SQLite survives restart and seed does not duplicate existing data", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "signaldesk-test-"));
  let store;
  try {
    const db = path.join(dir, "test.sqlite");
    store = createStore(db);
    const total = store.list().length;
    const created = store.create(input);
    store.close();
    store = createStore(db);
    assert.equal(store.list().length, total + 1);
    assert.equal(store.get(created.id).title, input.title);
  } finally {
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("HTTP API supports creation, read, update, filtering and error responses", async (t) => {
  const store = createStore(":memory:", { seed: false });
  const app = createApp(store);
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => app.close(resolve));
    store.close();
  });
  const base = `http://127.0.0.1:${app.address().port}`;
  const request = (url, method = "GET", body, headers = {}) =>
    fetch(base + url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const response = await request("/api/incidents", "POST", input);
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(
    (await (await request(`/api/incidents/${created.id}`)).json()).events
      .length,
    1,
  );
  assert.equal(
    (
      await request(`/api/incidents/${created.id}`, "PATCH", {
        status: "monitoring",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(`/api/incidents/${created.id}`, "PATCH", {
        status: "resolved",
      })
    ).status,
    200,
  );
  assert.equal(
    (await (await request("/api/incidents?status=active")).json()).length,
    0,
  );
  assert.equal(
    (await (await request("/api/dashboard")).json()).metrics.resolved,
    1,
  );
  assert.equal(
    (
      await request("/api/incidents", "POST", input, {
        Origin: "https://example.com",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/incidents", "POST", input, {
        "Content-Type": "text/plain",
      })
    ).status,
    415,
  );
  assert.equal(
    (
      await request("/api/incidents", "POST", {
        ...input,
        description: "x".repeat(17000),
      })
    ).status,
    413,
  );
  assert.equal((await request("/api/incidents", "POST", [])).status, 400);
  assert.equal(
    (
      await fetch(base + "/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{broken",
      })
    ).status,
    400,
  );
  assert.equal(
    (await request("/api/incidents/00000000-0000-0000-0000-000000000000"))
      .status,
    404,
  );
  assert.equal((await request("/api/incidents", "DELETE")).status, 405);
  assert.equal((await request("/.env")).status, 404);
  const page = await request("/");
  assert.equal(page.status, 200);
  assert.match(
    page.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.match(await page.text(), /Operations overview/);
});
