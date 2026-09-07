import assert from "node:assert/strict";
import { test } from "node:test";

import { SEED_ASSETS, createSeedState } from "../data/seed";
import {
  STORAGE_KEY,
  createWorkOrder,
  filterAssets,
  nextWorkOrderId,
  parsePlantState,
  readPlantState,
  resetDemo,
  sortWorkOrdersNewestFirst,
  updateWorkOrderPriority,
  validateWorkOrderInput,
  type NewWorkOrderInput,
  type WorkOrderFormValues,
} from "./maintenance-store";

class FakeLocalStorage {
  private entries = new Map<string, string>();
  failWrites = false;

  getItem(key: string): string | null {
    const value = this.entries.get(key);
    return value === undefined ? null : value;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.entries.set(key, value);
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }
}

interface FakeWindow {
  storage: FakeLocalStorage;
  localStorage: FakeLocalStorage;
  events: Array<{ type: string }>;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  dispatchEvent: (event: { type: string }) => boolean;
}

function installFakeWindow(): FakeWindow {
  const storage = new FakeLocalStorage();
  const listeners = new Map<string, Array<() => void>>();
  const events: Array<{ type: string }> = [];
  const win: FakeWindow = {
    storage,
    localStorage: storage,
    events,
    addEventListener: (type, listener) => {
      const set = listeners.get(type) ?? [];
      set.push(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type, listener) => {
      const set = listeners.get(type) ?? [];
      listeners.set(
        type,
        set.filter((entry) => entry !== listener),
      );
    },
    dispatchEvent: (event) => {
      events.push(event);
      const set = listeners.get(event.type) ?? [];
      for (const listener of set) listener();
      return true;
    },
  };
  Object.defineProperty(globalThis, "window", { value: win, configurable: true, writable: true });
  return win;
}

const VALID_INPUT: NewWorkOrderInput = {
  assetId: "P-204A",
  title: "Bearing vibration on Pump P-204A",
  description:
    "Drive-end bearing vibration exceeds the alert level; bearing temperature measured at 86 C.",
  priority: "High",
  assignedTeam: "Mechanical Maintenance",
  status: "Open",
};

const EMPTY_VALUES: WorkOrderFormValues = {
  assetId: "",
  title: "",
  description: "",
  priority: "",
  assignedTeam: "",
  status: "",
};

test("seeds the demo state and persists it when storage is empty", () => {
  const win = installFakeWindow();
  const read = readPlantState();

  assert.equal(read.source, "seed");
  assert.equal(read.storageAvailable, true);
  assert.deepEqual(read.state, createSeedState());
  assert.deepEqual(JSON.parse(win.storage.getItem(STORAGE_KEY) ?? "null"), createSeedState());
});

test("falls back to seed state when stored data is missing or malformed", () => {
  const malformed = [
    "not json at all",
    JSON.stringify({ version: 99, assets: [], workOrders: [] }),
    JSON.stringify({ version: 1, assets: "nope", workOrders: [] }),
    JSON.stringify({ version: 1, assets: [], workOrders: [] }),
    JSON.stringify({
      ...createSeedState(),
      workOrders: [{ ...createSeedState().workOrders[0], priority: "Urgent" }],
    }),
    JSON.stringify({
      ...createSeedState(),
      assets: [{ ...createSeedState().assets[0], maintenance: [{ id: "x" }] }],
    }),
  ];

  for (const raw of malformed) {
    const win = installFakeWindow();
    win.storage.setItem(STORAGE_KEY, raw);
    const read = readPlantState();

    assert.equal(read.source, "seed");
    assert.deepEqual(read.state, createSeedState());
    assert.deepEqual(JSON.parse(win.storage.getItem(STORAGE_KEY) ?? "null"), createSeedState());
  }
});

test("parses a valid stored state back into the same shape", () => {
  const state = createSeedState();
  assert.deepEqual(parsePlantState(JSON.stringify(state)), state);
});

test("creates a work order with the next stable ID and prepends it", () => {
  const win = installFakeWindow();
  const before = readPlantState().state;
  const result = createWorkOrder(VALID_INPUT);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.workOrder.id, "WO-1043");
  assert.ok(!Number.isNaN(Date.parse(result.workOrder.createdAt)));

  const after = readPlantState().state;
  assert.equal(after.workOrders.length, before.workOrders.length + 1);
  assert.equal(after.workOrders[0].id, "WO-1043");
  assert.equal(after.workOrders[0].assetId, "P-204A");
  assert.equal(after.workOrders[0].priority, "High");

  const persisted = JSON.parse(win.storage.getItem(STORAGE_KEY) ?? "null") as {
    workOrders: Array<{ id: string }>;
  };
  assert.equal(persisted.workOrders[0].id, "WO-1043");
});

test("assigns incrementing IDs across multiple creations", () => {
  installFakeWindow();
  const first = createWorkOrder(VALID_INPUT);
  const second = createWorkOrder(VALID_INPUT);

  assert.equal(first.ok && first.workOrder.id, "WO-1043");
  assert.equal(second.ok && second.workOrder.id, "WO-1044");
});

test("updates one work order priority and persists it", () => {
  const win = installFakeWindow();
  const before = readPlantState().state;
  const untouched = before.workOrders.find((workOrder) => workOrder.id === "WO-1041");

  const result = updateWorkOrderPriority("WO-1042", "High");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.previousPriority, "Medium");
  assert.equal(result.workOrder.priority, "High");

  const after = readPlantState().state;
  assert.equal(after.workOrders.find((workOrder) => workOrder.id === "WO-1042")?.priority, "High");
  assert.deepEqual(
    after.workOrders.find((workOrder) => workOrder.id === "WO-1041"),
    untouched,
  );
  assert.equal(
    win.events.some((event) => event.type === "plantops:state-changed"),
    true,
  );

  const persisted = JSON.parse(win.storage.getItem(STORAGE_KEY) ?? "null") as {
    workOrders: Array<{ id: string; priority: string }>;
  };
  assert.equal(
    persisted.workOrders.find((workOrder) => workOrder.id === "WO-1042")?.priority,
    "High",
  );
});

test("rejects unknown work orders and invalid priorities without changing state", () => {
  const win = installFakeWindow();
  const before = readPlantState().state;

  assert.deepEqual(updateWorkOrderPriority("WO-9999", "High"), {
    ok: false,
    error: "not-found",
  });
  assert.deepEqual(updateWorkOrderPriority("WO-1042", "Urgent"), {
    ok: false,
    error: "invalid-priority",
  });
  assert.deepEqual(readPlantState().state, before);
  assert.equal(win.events.filter((event) => event.type === "plantops:state-changed").length, 0);
});

test("reports a storage failure when updating priority", () => {
  const win = installFakeWindow();
  readPlantState();
  win.storage.failWrites = true;

  assert.deepEqual(updateWorkOrderPriority("WO-1042", "High"), {
    ok: false,
    error: "storage-unavailable",
  });
});

test("reset restores the exact seed state and removes rehearsal work orders", () => {
  const win = installFakeWindow();
  assert.equal(createWorkOrder(VALID_INPUT).ok, true);
  assert.equal(createWorkOrder(VALID_INPUT).ok, true);

  assert.equal(resetDemo().ok, true);
  const read = readPlantState();

  assert.equal(read.source, "stored");
  assert.deepEqual(read.state, createSeedState());
  assert.deepEqual(JSON.parse(win.storage.getItem(STORAGE_KEY) ?? "null"), createSeedState());
});

test("reports a storage failure when writes throw and keeps the readable state", () => {
  const win = installFakeWindow();
  win.storage.failWrites = true;

  const read = readPlantState();
  assert.equal(read.storageAvailable, false);
  assert.deepEqual(read.state, createSeedState());

  assert.deepEqual(createWorkOrder(VALID_INPUT), { ok: false, error: "storage-unavailable" });
  assert.deepEqual(resetDemo(), { ok: false });
});

test("validateWorkOrderInput flags every missing field", () => {
  installFakeWindow();
  const { assets } = readPlantState().state;
  const errors = validateWorkOrderInput(EMPTY_VALUES, assets);

  assert.deepEqual(Object.keys(errors).sort(), [
    "assetId",
    "assignedTeam",
    "description",
    "priority",
    "status",
    "title",
  ]);
});

test("validateWorkOrderInput accepts the demo work order values", () => {
  installFakeWindow();
  const { assets } = readPlantState().state;
  const errors = validateWorkOrderInput(
    {
      assetId: "P-204A",
      title: "Bearing vibration on Pump P-204A",
      description:
        "Drive-end bearing vibration exceeds the alert level; bearing temperature measured at 86 C.",
      priority: "High",
      assignedTeam: "Mechanical Maintenance",
      status: "Open",
    },
    assets,
  );

  assert.deepEqual(errors, {});
});

test("validateWorkOrderInput rejects an unknown asset and invalid enum values", () => {
  installFakeWindow();
  const { assets } = readPlantState().state;
  const errors = validateWorkOrderInput(
    {
      assetId: "P-999Z",
      title: "Something",
      description: "Something happened.",
      priority: "Urgent",
      assignedTeam: "Catering",
      status: "Done",
    },
    assets,
  );

  assert.notEqual(errors.assetId, undefined);
  assert.notEqual(errors.priority, undefined);
  assert.notEqual(errors.assignedTeam, undefined);
  assert.notEqual(errors.status, undefined);
  assert.equal(errors.title, undefined);
  assert.equal(errors.description, undefined);
});

test("sortWorkOrdersNewestFirst orders by creation time descending", () => {
  const orders = [
    { ...VALID_INPUT, id: "WO-1", createdAt: "2026-09-01T00:00:00.000Z" },
    { ...VALID_INPUT, id: "WO-3", createdAt: "2026-09-03T00:00:00.000Z" },
    { ...VALID_INPUT, id: "WO-2", createdAt: "2026-09-02T00:00:00.000Z" },
  ];

  assert.deepEqual(
    sortWorkOrdersNewestFirst(orders).map((order) => order.id),
    ["WO-3", "WO-2", "WO-1"],
  );
});

test("filterAssets matches on id, name, type, and location", () => {
  const { assets } = createSeedState();

  assert.equal(filterAssets(assets, "").length, assets.length);
  assert.deepEqual(
    filterAssets(assets, "pump").map((asset) => asset.id),
    ["P-204A"],
  );
  assert.deepEqual(
    filterAssets(assets, "P-204A").map((asset) => asset.id),
    ["P-204A"],
  );
  assert.deepEqual(
    filterAssets(assets, "centrifugal").map((asset) => asset.id),
    ["P-204A"],
  );
  assert.deepEqual(
    filterAssets(assets, "rooftop").map((asset) => asset.id),
    ["CH-201"],
  );
  assert.deepEqual(filterAssets(assets, "does-not-exist"), []);
});

test("nextWorkOrderId continues from the highest existing sequence", () => {
  const withCreatedAt = (id: string) => ({
    ...VALID_INPUT,
    id,
    createdAt: "2026-09-01T00:00:00.000Z",
  });
  assert.equal(nextWorkOrderId([]), "WO-1001");
  assert.equal(nextWorkOrderId([withCreatedAt("WO-1042")]), "WO-1043");
  assert.equal(nextWorkOrderId([withCreatedAt("WO-9999")]), "WO-10000");
});

test("keeps the inspection report's fault findings out of the seeded pump data", () => {
  const pump = SEED_ASSETS.find((asset) => asset.id === "P-204A");
  assert.notEqual(pump, undefined);
  if (pump === undefined) return;

  const text = pump.maintenance
    .map((entry) => `${entry.summary} ${entry.kind}`)
    .join(" ")
    .toLowerCase();
  assert.doesNotMatch(text, /vibration/);
  assert.doesNotMatch(text, /86/);
});
