export const STATE_VERSION = 1;

export type OperatingStatus = "Running" | "Standby" | "Down";
export type MaintenanceKind = "Preventive" | "Corrective";
export type WorkOrderPriority = "Low" | "Medium" | "High";
export type WorkOrderStatus = "Open" | "In Progress" | "On Hold";

export interface MaintenanceEntry {
  readonly id: string;
  readonly date: string;
  readonly kind: MaintenanceKind;
  readonly summary: string;
  readonly technician: string;
}

export interface Asset {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly location: string;
  readonly operatingStatus: OperatingStatus;
  readonly model: string;
  readonly installed: string;
  readonly maintenance: readonly MaintenanceEntry[];
}

export interface WorkOrder {
  readonly id: string;
  readonly assetId: string;
  readonly title: string;
  readonly description: string;
  readonly priority: WorkOrderPriority;
  readonly assignedTeam: string;
  readonly status: WorkOrderStatus;
  readonly createdAt: string;
}

export interface PlantState {
  readonly version: number;
  readonly assets: readonly Asset[];
  readonly workOrders: readonly WorkOrder[];
}

export const PRIORITIES: readonly WorkOrderPriority[] = ["Low", "Medium", "High"];

export const WORK_ORDER_STATUSES: readonly WorkOrderStatus[] = ["Open", "In Progress", "On Hold"];

export const TEAMS: readonly string[] = [
  "Mechanical Maintenance",
  "Electrical",
  "Instrumentation & Controls",
  "Utilities",
];

export const SEED_ASSETS: readonly Asset[] = [
  {
    id: "P-204A",
    name: "Pump P-204A",
    type: "Centrifugal pump",
    location: "Water treatment building, bay 2",
    operatingStatus: "Running",
    model: "KSB Etanorm 80-200",
    installed: "2019",
    maintenance: [
      {
        id: "MNT-P204A-2026-06",
        date: "2026-06-14",
        kind: "Preventive",
        summary: "Annual grease service of drive-end and non-drive-end bearings per OEM schedule.",
        technician: "R. Okafor",
      },
      {
        id: "MNT-P204A-2026-02",
        date: "2026-02-02",
        kind: "Preventive",
        summary: "Coupling alignment check after motor service. Readings within tolerance.",
        technician: "M. Reyes",
      },
      {
        id: "MNT-P204A-2025-11",
        date: "2025-11-19",
        kind: "Corrective",
        summary: "Replaced worn mechanical seal cartridge and updated the seal inspection log.",
        technician: "R. Okafor",
      },
    ],
  },
  {
    id: "C-112",
    name: "Compressor C-112",
    type: "Reciprocating air compressor",
    location: "Compressor room, line 1",
    operatingStatus: "Running",
    model: "Atlas Copco GA 75 VSD",
    installed: "2021",
    maintenance: [
      {
        id: "MNT-C112-2026-08",
        date: "2026-08-28",
        kind: "Preventive",
        summary: "300-hour check. V-belt set shows glazing; replacement scheduled.",
        technician: "M. Reyes",
      },
      {
        id: "MNT-C112-2026-05",
        date: "2026-05-11",
        kind: "Preventive",
        summary: "Air filter element replaced, intake valve inspected.",
        technician: "T. Lindqvist",
      },
    ],
  },
  {
    id: "B-330",
    name: "Boiler B-330",
    type: "Hot-water boiler",
    location: "Heating plant",
    operatingStatus: "Standby",
    model: "Weil E270",
    installed: "2016",
    maintenance: [
      {
        id: "MNT-B330-2026-07",
        date: "2026-07-22",
        kind: "Preventive",
        summary: "Annual combustion tune-up completed ahead of winter standby.",
        technician: "T. Lindqvist",
      },
      {
        id: "MNT-B330-2026-03",
        date: "2026-03-04",
        kind: "Corrective",
        summary: "Replaced low-water cutoff probe after intermittent trips.",
        technician: "A. Fontaine",
      },
    ],
  },
  {
    id: "CV-07",
    name: "Conveyor CV-07",
    type: "Belt conveyor",
    location: "Packaging hall, line 3",
    operatingStatus: "Running",
    model: "Interroll H3000",
    installed: "2022",
    maintenance: [
      {
        id: "MNT-CV07-2026-09",
        date: "2026-09-02",
        kind: "Preventive",
        summary: "Belt tracking adjusted, idler rollers greased.",
        technician: "M. Reyes",
      },
    ],
  },
  {
    id: "CH-201",
    name: "Chiller CH-201",
    type: "Water chiller",
    location: "Rooftop plant",
    operatingStatus: "Running",
    model: "Trane CGAM-120",
    installed: "2018",
    maintenance: [
      {
        id: "MNT-CH201-2026-04",
        date: "2026-04-17",
        kind: "Preventive",
        summary: "Condenser coil cleaned, refrigerant charge verified.",
        technician: "A. Fontaine",
      },
    ],
  },
] as const satisfies readonly Asset[];

export const SEED_WORK_ORDERS: readonly WorkOrder[] = [
  {
    id: "WO-1042",
    assetId: "C-112",
    title: "Replace V-belt set on Compressor C-112",
    description:
      "Belt set shows glazing and cracking at the 300-hour check. Replace the full set before the next peak-load period.",
    priority: "Medium",
    assignedTeam: "Mechanical Maintenance",
    status: "In Progress",
    createdAt: "2026-08-28T09:40:00.000Z",
  },
  {
    id: "WO-1041",
    assetId: "B-330",
    title: "Quarterly safety relief valve test, Boiler B-330",
    description:
      "Scheduled pressure relief valve inspection and certification for the heating plant boiler.",
    priority: "Low",
    assignedTeam: "Utilities",
    status: "Open",
    createdAt: "2026-09-01T08:15:00.000Z",
  },
] as const satisfies readonly WorkOrder[];

export function createSeedState(): PlantState {
  return {
    version: STATE_VERSION,
    assets: SEED_ASSETS.map((asset) => ({
      ...asset,
      maintenance: asset.maintenance.map((entry) => ({ ...entry })),
    })),
    workOrders: SEED_WORK_ORDERS.map((workOrder) => ({ ...workOrder })),
  };
}
