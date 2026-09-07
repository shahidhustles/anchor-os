import {
  PRIORITIES,
  TEAMS,
  WORK_ORDER_STATUSES,
  createSeedState,
  STATE_VERSION,
  type Asset,
  type MaintenanceEntry,
  type MaintenanceKind,
  type OperatingStatus,
  type PlantState,
  type WorkOrder,
  type WorkOrderPriority,
  type WorkOrderStatus,
} from "@/data/seed";

export const STORAGE_KEY = "plantops-demo-state:v1";

const CHANGE_EVENT = "plantops:state-changed";
const TITLE_MAX_LENGTH = 120;

export const OPERATING_STATUSES: readonly OperatingStatus[] = ["Running", "Standby", "Down"];
const MAINTENANCE_KINDS: readonly MaintenanceKind[] = ["Preventive", "Corrective"];

export interface PlantStateRead {
  readonly state: PlantState;
  readonly source: "stored" | "seed";
  readonly storageAvailable: boolean;
}

export interface NewWorkOrderInput {
  readonly assetId: string;
  readonly title: string;
  readonly description: string;
  readonly priority: WorkOrderPriority;
  readonly assignedTeam: string;
  readonly status: WorkOrderStatus;
}

export type CreateWorkOrderResult =
  | { readonly ok: true; readonly workOrder: WorkOrder }
  | { readonly ok: false; readonly error: "storage-unavailable" };

export type UpdateWorkOrderPriorityResult =
  | {
      readonly ok: true;
      readonly workOrder: WorkOrder;
      readonly previousPriority: WorkOrderPriority;
    }
  | {
      readonly ok: false;
      readonly error: "invalid-priority" | "not-found" | "storage-unavailable";
    };

export interface WorkOrderFormValues {
  readonly assetId: string;
  readonly title: string;
  readonly description: string;
  readonly priority: string;
  readonly assignedTeam: string;
  readonly status: string;
}

export type WorkOrderFieldErrors = Partial<Record<keyof WorkOrderFormValues, string>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function matches<T extends string>(options: readonly T[], value: unknown): value is T {
  return typeof value === "string" && options.some((option) => option === value);
}

function parseMaintenanceEntry(value: unknown): MaintenanceEntry | null {
  if (!isRecord(value)) return null;
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.date) ||
    !isNonEmptyString(value.summary) ||
    !isNonEmptyString(value.technician) ||
    !matches(MAINTENANCE_KINDS, value.kind)
  ) {
    return null;
  }
  return {
    id: value.id,
    date: value.date,
    kind: value.kind,
    summary: value.summary,
    technician: value.technician,
  };
}

function parseAsset(value: unknown): Asset | null {
  if (!isRecord(value)) return null;
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.type) ||
    !isNonEmptyString(value.location) ||
    !matches(OPERATING_STATUSES, value.operatingStatus) ||
    !isNonEmptyString(value.model) ||
    !isNonEmptyString(value.installed) ||
    !Array.isArray(value.maintenance)
  ) {
    return null;
  }
  const maintenance: MaintenanceEntry[] = [];
  for (const item of value.maintenance) {
    const entry = parseMaintenanceEntry(item);
    if (entry === null) return null;
    maintenance.push(entry);
  }
  return {
    id: value.id,
    name: value.name,
    type: value.type,
    location: value.location,
    operatingStatus: value.operatingStatus,
    model: value.model,
    installed: value.installed,
    maintenance,
  };
}

function parseWorkOrder(value: unknown): WorkOrder | null {
  if (!isRecord(value)) return null;
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.assetId) ||
    !isNonEmptyString(value.title) ||
    !isNonEmptyString(value.description) ||
    !matches(PRIORITIES, value.priority) ||
    !isNonEmptyString(value.assignedTeam) ||
    !matches(WORK_ORDER_STATUSES, value.status) ||
    !isNonEmptyString(value.createdAt)
  ) {
    return null;
  }
  return {
    id: value.id,
    assetId: value.assetId,
    title: value.title,
    description: value.description,
    priority: value.priority,
    assignedTeam: value.assignedTeam,
    status: value.status,
    createdAt: value.createdAt,
  };
}

export function parsePlantState(raw: string): PlantState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.version !== STATE_VERSION) return null;
  if (!Array.isArray(parsed.assets) || parsed.assets.length === 0) return null;
  if (!Array.isArray(parsed.workOrders)) return null;

  const assets: Asset[] = [];
  for (const item of parsed.assets) {
    const asset = parseAsset(item);
    if (asset === null) return null;
    assets.push(asset);
  }
  const assetIds = new Set(assets.map((asset) => asset.id));
  if (assetIds.size !== assets.length) return null;

  const workOrders: WorkOrder[] = [];
  for (const item of parsed.workOrders) {
    const workOrder = parseWorkOrder(item);
    if (workOrder === null) return null;
    if (!assetIds.has(workOrder.assetId)) return null;
    workOrders.push(workOrder);
  }

  return { version: STATE_VERSION, assets, workOrders };
}

function getStorage(): Storage | null {
  try {
    const storage = window.localStorage;
    return storage === null || storage === undefined ? null : storage;
  } catch {
    return null;
  }
}

function writeStorage(state: PlantState): boolean {
  const storage = getStorage();
  if (storage === null) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function persistSeedState(): { state: PlantState; storageAvailable: boolean } {
  const state = createSeedState();
  return { state, storageAvailable: writeStorage(state) };
}

export function readPlantState(): PlantStateRead {
  if (typeof window === "undefined") {
    return { state: createSeedState(), source: "seed", storageAvailable: false };
  }
  const storage = getStorage();
  if (storage === null) {
    return { state: createSeedState(), source: "seed", storageAvailable: false };
  }
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { state: createSeedState(), source: "seed", storageAvailable: false };
  }
  if (raw === null) {
    const { state, storageAvailable } = persistSeedState();
    return { state, source: "seed", storageAvailable };
  }
  const parsed = parsePlantState(raw);
  if (parsed === null) {
    const { state, storageAvailable } = persistSeedState();
    return { state, source: "seed", storageAvailable };
  }
  return { state: parsed, source: "stored", storageAvailable: true };
}

export function nextWorkOrderId(workOrders: readonly WorkOrder[]): string {
  let highest = 1000;
  for (const workOrder of workOrders) {
    const match = /^WO-(\d+)$/.exec(workOrder.id);
    if (match !== null) highest = Math.max(highest, Number(match[1]));
  }
  return `WO-${String(highest + 1).padStart(4, "0")}`;
}

export function createWorkOrder(input: NewWorkOrderInput): CreateWorkOrderResult {
  const { state } = readPlantState();
  const workOrder: WorkOrder = {
    id: nextWorkOrderId(state.workOrders),
    assetId: input.assetId,
    title: input.title.trim(),
    description: input.description.trim(),
    priority: input.priority,
    assignedTeam: input.assignedTeam,
    status: input.status,
    createdAt: new Date().toISOString(),
  };
  const next: PlantState = {
    version: STATE_VERSION,
    assets: state.assets,
    workOrders: [workOrder, ...state.workOrders],
  };
  if (!writeStorage(next)) return { ok: false, error: "storage-unavailable" };
  notifyStateChange();
  return { ok: true, workOrder };
}

export function updateWorkOrderPriority(
  workOrderId: string,
  priority: string,
): UpdateWorkOrderPriorityResult {
  if (!matches(PRIORITIES, priority)) return { ok: false, error: "invalid-priority" };

  const { state } = readPlantState();
  const existing = state.workOrders.find((workOrder) => workOrder.id === workOrderId);
  if (existing === undefined) return { ok: false, error: "not-found" };

  const updated: WorkOrder = { ...existing, priority };
  const next: PlantState = {
    version: STATE_VERSION,
    assets: state.assets,
    workOrders: state.workOrders.map((workOrder) =>
      workOrder.id === workOrderId ? updated : workOrder,
    ),
  };
  if (!writeStorage(next)) return { ok: false, error: "storage-unavailable" };
  notifyStateChange();
  return { ok: true, workOrder: updated, previousPriority: existing.priority };
}

export function resetDemo(): { readonly ok: boolean } {
  const ok = writeStorage(createSeedState());
  if (ok) notifyStateChange();
  return { ok };
}

export function filterAssets(assets: readonly Asset[], query: string): Asset[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...assets];
  return assets.filter((asset) =>
    [asset.id, asset.name, asset.type, asset.location].some((field) =>
      field.toLowerCase().includes(q),
    ),
  );
}

export function sortWorkOrdersNewestFirst(workOrders: readonly WorkOrder[]): WorkOrder[] {
  return [...workOrders].sort((a, b) =>
    a.createdAt === b.createdAt ? b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt),
  );
}

export function validateWorkOrderInput(
  values: WorkOrderFormValues,
  assets: readonly Asset[],
): WorkOrderFieldErrors {
  const errors: WorkOrderFieldErrors = {};

  if (values.assetId === "") {
    errors.assetId = "Choose the asset this work order applies to.";
  } else if (!assets.some((asset) => asset.id === values.assetId)) {
    errors.assetId = "Choose a tracked asset.";
  }

  const title = values.title.trim();
  if (title === "") {
    errors.title = "Enter a short work order title.";
  } else if (title.length > TITLE_MAX_LENGTH) {
    errors.title = `Keep the title to ${TITLE_MAX_LENGTH} characters or fewer.`;
  }

  if (values.description.trim() === "") {
    errors.description = "Describe the work, citing the findings that justify it.";
  }

  if (!matches(PRIORITIES, values.priority)) {
    errors.priority = "Choose a priority.";
  }

  if (!TEAMS.some((team) => team === values.assignedTeam)) {
    errors.assignedTeam = "Choose an assigned team.";
  }

  if (!matches(WORK_ORDER_STATUSES, values.status)) {
    errors.status = "Choose a status.";
  }

  return errors;
}

function notifyStateChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function subscribeToStateChanges(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function toUtcParts(iso: string): { day: string; month: string; year: string } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return {
    day: String(date.getUTCDate()).padStart(2, "0"),
    month: MONTHS[date.getUTCMonth()],
    year: String(date.getUTCFullYear()),
  };
}

export function formatDate(iso: string): string {
  const parts = toUtcParts(iso);
  return parts === null ? iso : `${parts.day} ${parts.month} ${parts.year}`;
}

export function formatDateTime(iso: string): string {
  const parts = toUtcParts(iso);
  if (parts === null) return iso;
  const date = new Date(iso);
  const time = `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
  return `${parts.day} ${parts.month} ${parts.year}, ${time} UTC`;
}
