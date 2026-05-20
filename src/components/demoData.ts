// Iconic Connect — Phase 1 demo data (Lab + Admin portals)

export type CaseStatus =
  | "Submitted"
  | "In Validation"
  | "In Design"
  | "Internal QC"
  | "Pending Client Approval"
  | "Feedback"
  | "On Hold"
  | "Cancelled"
  | "Completed";

export type CaseType =
  | "Crown & Bridge"
  | "Implants"
  | "Removables"
  | "Dentures"
  | "Surgical Guides"
  | "Splints / Nightguards";

export interface DentalCase {
  id: string;
  patientRef: string; // lab's internal patient ref (no PII required)
  caseType: CaseType;
  restoration: string;
  modelRequired: boolean;
  toothNumbers: number[]; // USA Universal Numbering 1–32
  status: CaseStatus;
  client: string; // lab name
  designer?: string;
  qcLead?: string;
  createdAt: string;
  updatedAt: string;
  dueDate: string;
  notes: string;
  timeline: { date: string; event: string; actor: string }[];
  feedback?: { from: "Client" | "Internal QC"; date: string; message: string }[];
}

export interface Offer {
  id: string;
  title: string;
  brand: string;
  category: "Intraoral Scanner" | "Materials" | "Equipment" | "Software" | "Consumables";
  description: string;
  discount: string;
  validTill: string;
  targetClients?: string[]; // empty = all
  targetLocations?: string[];
  sponsored: boolean;
}

export interface Invoice {
  id: string;
  client: string;
  month: string; // e.g. "January 2026"
  caseCount: number;
  amount: number;
  status: "Draft" | "Pending" | "Paid" | "Overdue";
  generatedAt: string;
  dueDate: string;
  payLink: string;
}

export interface SupportTicket {
  id: string;
  subject: string;
  type: "Technical" | "Billing" | "Case Issue" | "Feature Request" | "Other";
  urgency: "Low" | "Medium" | "High" | "Critical";
  status: "Open" | "In Progress" | "Resolved";
  createdAt: string;
  lastUpdate: string;
}

export interface Tutorial {
  id: string;
  title: string;
  description: string;
  duration: string;
  category: "Getting Started" | "Cases" | "Billing" | "Support" | "Tips";
  thumbnail: string; // emoji
}

export interface ClientAccount {
  id: string;
  company: string;
  poc: string;
  email: string;
  phone: string;
  location: string;
  onboardedAt: string;
  status: "Active" | "Onboarding" | "Paused";
  monthlyVolume: number;
  priceList: { caseType: CaseType; price: number }[];
  preferences: string;
}

// ─────────── Cases ───────────
const t = (date: string, event: string, actor: string) => ({ date, event, actor });

export const cases: DentalCase[] = [
  {
    id: "IC-2401",
    patientRef: "PAT-A12",
    caseType: "Crown & Bridge",
    restoration: "Zirconia Crown",
    modelRequired: false,
    toothNumbers: [14],
    status: "Completed",
    client: "PrecisionDent Lab",
    designer: "Aarav Mehta",
    qcLead: "Riya Shah",
    createdAt: "2026-04-22",
    updatedAt: "2026-04-29",
    dueDate: "2026-04-30",
    notes: "Shade A2, anatomic contour",
    timeline: [
      t("2026-04-22", "Case submitted by client", "PrecisionDent Lab"),
      t("2026-04-22", "Scan validated", "QC — Riya Shah"),
      t("2026-04-23", "Allocated to designer", "Super Admin"),
      t("2026-04-25", "Design submitted to internal QC", "Aarav Mehta"),
      t("2026-04-26", "Internal QC approved", "Riya Shah"),
      t("2026-04-27", "Submitted for client approval", "Iconic Connect"),
      t("2026-04-29", "Client approved · Delivered", "PrecisionDent Lab"),
    ],
  },
  {
    id: "IC-2402",
    patientRef: "PAT-B07",
    caseType: "Crown & Bridge",
    restoration: "PFM Bridge 3-unit",
    modelRequired: true,
    toothNumbers: [3, 4, 5],
    status: "In Design",
    client: "SmileCraft Labs",
    designer: "Karan Verma",
    qcLead: "Riya Shah",
    createdAt: "2026-05-02",
    updatedAt: "2026-05-08",
    dueDate: "2026-05-12",
    notes: "Metal margin distal",
    timeline: [
      t("2026-05-02", "Case submitted by client", "SmileCraft Labs"),
      t("2026-05-03", "Scan validated", "QC — Riya Shah"),
      t("2026-05-04", "Allocated to designer", "Super Admin"),
      t("2026-05-08", "Design in progress", "Karan Verma"),
    ],
  },
  {
    id: "IC-2403",
    patientRef: "PAT-C19",
    caseType: "Implants",
    restoration: "Screw-retained Implant Crown",
    modelRequired: false,
    toothNumbers: [30],
    status: "Internal QC",
    client: "ImplantPro Lab",
    designer: "Sneha Iyer",
    qcLead: "Vikram Joshi",
    createdAt: "2026-05-01",
    updatedAt: "2026-05-09",
    dueDate: "2026-05-13",
    notes: "Nobel Active 4.3, NB compatible",
    timeline: [
      t("2026-05-01", "Case submitted", "ImplantPro Lab"),
      t("2026-05-02", "Allocated to designer (direct)", "Super Admin"),
      t("2026-05-03", "Scan validated by designer", "Sneha Iyer"),
      t("2026-05-08", "Design submitted to internal QC", "Sneha Iyer"),
    ],
  },
  {
    id: "IC-2404",
    patientRef: "PAT-D02",
    caseType: "Crown & Bridge",
    restoration: "Layered Zirconia x6",
    modelRequired: true,
    toothNumbers: [6, 7, 8, 9, 10, 11],
    status: "Feedback",
    client: "AestheticEdge Lab",
    designer: "Karan Verma",
    qcLead: "Riya Shah",
    createdAt: "2026-04-26",
    updatedAt: "2026-05-08",
    dueDate: "2026-05-10",
    notes: "BL2, Hollywood smile",
    timeline: [
      t("2026-04-26", "Case submitted", "AestheticEdge Lab"),
      t("2026-04-27", "Scan validated", "QC — Riya Shah"),
      t("2026-04-28", "Allocated", "Super Admin"),
      t("2026-05-02", "Design submitted to internal QC", "Karan Verma"),
      t("2026-05-04", "Submitted to client", "Iconic Connect"),
      t("2026-05-08", "Client requested incisal edge revision", "AestheticEdge Lab"),
    ],
    feedback: [
      { from: "Client", date: "2026-05-08", message: "Please soften incisal edges on #8 and #9, add slight halo." },
    ],
  },
  {
    id: "IC-2405",
    patientRef: "PAT-E33",
    caseType: "Crown & Bridge",
    restoration: "E.max Crown",
    modelRequired: false,
    toothNumbers: [9],
    status: "In Validation",
    client: "PrecisionDent Lab",
    createdAt: "2026-05-09",
    updatedAt: "2026-05-09",
    dueDate: "2026-05-15",
    notes: "Anterior, shade B1",
    timeline: [
      t("2026-05-09", "Case submitted", "PrecisionDent Lab"),
      t("2026-05-09", "Scan in QC validation", "QC — Riya Shah"),
    ],
  },
  {
    id: "IC-2406",
    patientRef: "PAT-F14",
    caseType: "Dentures",
    restoration: "Full Upper Denture",
    modelRequired: true,
    toothNumbers: [],
    status: "Completed",
    client: "DentureFit Lab",
    designer: "Sneha Iyer",
    qcLead: "Vikram Joshi",
    createdAt: "2026-04-10",
    updatedAt: "2026-04-22",
    dueDate: "2026-04-24",
    notes: "Standard mould, medium ridge",
    timeline: [
      t("2026-04-10", "Case submitted", "DentureFit Lab"),
      t("2026-04-11", "Validated", "QC — Vikram Joshi"),
      t("2026-04-13", "Allocated", "Super Admin"),
      t("2026-04-18", "Designed", "Sneha Iyer"),
      t("2026-04-20", "Internal QC passed", "Vikram Joshi"),
      t("2026-04-22", "Approved · Delivered", "DentureFit Lab"),
    ],
  },
  {
    id: "IC-2407",
    patientRef: "PAT-G21",
    caseType: "Surgical Guides",
    restoration: "Tooth-borne Guide",
    modelRequired: false,
    toothNumbers: [19],
    status: "Pending Client Approval",
    client: "ImplantPro Lab",
    designer: "Aarav Mehta",
    qcLead: "Vikram Joshi",
    createdAt: "2026-05-05",
    updatedAt: "2026-05-10",
    dueDate: "2026-05-12",
    notes: "Straumann BLT 4.1mm sleeve",
    timeline: [
      t("2026-05-05", "Case submitted", "ImplantPro Lab"),
      t("2026-05-05", "Validated", "QC — Vikram Joshi"),
      t("2026-05-06", "Allocated", "Super Admin"),
      t("2026-05-09", "Design submitted to QC", "Aarav Mehta"),
      t("2026-05-10", "Submitted for client approval", "Iconic Connect"),
    ],
  },
  {
    id: "IC-2408",
    patientRef: "PAT-H08",
    caseType: "Removables",
    restoration: "Cobalt-Chrome RPD",
    modelRequired: true,
    toothNumbers: [22, 23, 24, 25, 26, 27],
    status: "On Hold",
    client: "DentureFit Lab",
    createdAt: "2026-05-03",
    updatedAt: "2026-05-07",
    dueDate: "2026-05-18",
    notes: "Waiting for additional bite scan from client",
    timeline: [
      t("2026-05-03", "Case submitted", "DentureFit Lab"),
      t("2026-05-04", "Validation flagged missing bite", "QC — Riya Shah"),
      t("2026-05-07", "Case placed on hold pending client upload", "Super Admin"),
    ],
  },
  {
    id: "IC-2409",
    patientRef: "PAT-I44",
    caseType: "Splints / Nightguards",
    restoration: "Hard Occlusal Splint",
    modelRequired: false,
    toothNumbers: [],
    status: "Submitted",
    client: "SmileCraft Labs",
    createdAt: "2026-05-10",
    updatedAt: "2026-05-10",
    dueDate: "2026-05-16",
    notes: "Bruxism patient",
    timeline: [t("2026-05-10", "Case submitted", "SmileCraft Labs")],
  },
  {
    id: "IC-2410",
    patientRef: "PAT-J11",
    caseType: "Crown & Bridge",
    restoration: "Zirconia Bridge 4-unit",
    modelRequired: true,
    toothNumbers: [12, 13, 14, 15],
    status: "In Design",
    client: "AestheticEdge Lab",
    designer: "Karan Verma",
    qcLead: "Riya Shah",
    createdAt: "2026-05-04",
    updatedAt: "2026-05-09",
    dueDate: "2026-05-14",
    notes: "Shade A1-A2 gradient",
    timeline: [
      t("2026-05-04", "Case submitted", "AestheticEdge Lab"),
      t("2026-05-05", "Validated", "QC — Riya Shah"),
      t("2026-05-06", "Allocated", "Super Admin"),
      t("2026-05-09", "Design in progress", "Karan Verma"),
    ],
  },
  {
    id: "IC-2411",
    patientRef: "PAT-K05",
    caseType: "Implants",
    restoration: "Custom Abutment + Crown",
    modelRequired: false,
    toothNumbers: [3],
    status: "Cancelled",
    client: "PrecisionDent Lab",
    createdAt: "2026-04-29",
    updatedAt: "2026-05-02",
    dueDate: "2026-05-08",
    notes: "Client cancelled — patient changed plan",
    timeline: [
      t("2026-04-29", "Case submitted", "PrecisionDent Lab"),
      t("2026-05-02", "Cancelled by client", "PrecisionDent Lab"),
    ],
  },
  {
    id: "IC-2412",
    patientRef: "PAT-L77",
    caseType: "Crown & Bridge",
    restoration: "Zirconia Crown",
    modelRequired: false,
    toothNumbers: [30],
    status: "Completed",
    client: "PrecisionDent Lab",
    designer: "Aarav Mehta",
    qcLead: "Riya Shah",
    createdAt: "2026-04-15",
    updatedAt: "2026-04-21",
    dueDate: "2026-04-22",
    notes: "Posterior, full contour",
    timeline: [
      t("2026-04-15", "Case submitted", "PrecisionDent Lab"),
      t("2026-04-15", "Validated", "QC — Riya Shah"),
      t("2026-04-16", "Allocated", "Super Admin"),
      t("2026-04-19", "Design submitted to QC", "Aarav Mehta"),
      t("2026-04-20", "Internal QC passed", "Riya Shah"),
      t("2026-04-21", "Approved · Delivered", "PrecisionDent Lab"),
    ],
  },
];

// ─────────── Offers ───────────
export const offers: Offer[] = [
  {
    id: "OF-001",
    title: "Medit i900 Intraoral Scanner — Launch Offer",
    brand: "Medit",
    category: "Intraoral Scanner",
    description: "Get the new Medit i900 with 1-year extended warranty and free training for your team.",
    discount: "Save $2,400",
    validTill: "2026-06-30",
    sponsored: true,
  },
  {
    id: "OF-002",
    title: "Katana Zirconia UTML Discs",
    brand: "Kuraray Noritake",
    category: "Materials",
    description: "Buy 5 discs, get 1 free on multilayered zirconia.",
    discount: "20% effective off",
    validTill: "2026-05-31",
    sponsored: false,
  },
  {
    id: "OF-003",
    title: "exocad DentalCAD — Annual License",
    brand: "exocad",
    category: "Software",
    description: "Exclusive 15% off annual license for Iconic Connect partner labs.",
    discount: "15% off",
    validTill: "2026-07-15",
    sponsored: true,
  },
  {
    id: "OF-004",
    title: "Roland DWX-43W Wet Mill",
    brand: "Roland DGA",
    category: "Equipment",
    description: "Demo unit available with 0% EMI for 12 months.",
    discount: "0% EMI",
    validTill: "2026-06-15",
    sponsored: false,
  },
  {
    id: "OF-005",
    title: "Implant Library Pack — Free Update",
    brand: "Iconic Dental",
    category: "Software",
    description: "Updated implant libraries (Nobel, Straumann, Osstem) free for active partners.",
    discount: "Complimentary",
    validTill: "2026-12-31",
    sponsored: false,
  },
  {
    id: "OF-006",
    title: "Surgical Guide Resin — Bulk Deal",
    brand: "NextDent",
    category: "Consumables",
    description: "Buy 4 bottles get 1 free on biocompatible guide resin.",
    discount: "20% off",
    validTill: "2026-05-30",
    sponsored: false,
  },
];

// ─────────── Invoices / Billing ───────────
export const invoices: Invoice[] = [
  { id: "INV-2604", client: "PrecisionDent Lab", month: "April 2026", caseCount: 42, amount: 2980, status: "Paid", generatedAt: "2026-05-01", dueDate: "2026-05-10", payLink: "#" },
  { id: "INV-2605", client: "PrecisionDent Lab", month: "May 2026", caseCount: 18, amount: 1240, status: "Pending", generatedAt: "2026-05-09", dueDate: "2026-05-20", payLink: "#" },
  { id: "INV-2603", client: "SmileCraft Labs", month: "March 2026", caseCount: 31, amount: 2120, status: "Paid", generatedAt: "2026-04-01", dueDate: "2026-04-10", payLink: "#" },
  { id: "INV-2602", client: "ImplantPro Lab", month: "March 2026", caseCount: 22, amount: 2640, status: "Overdue", generatedAt: "2026-04-01", dueDate: "2026-04-10", payLink: "#" },
  { id: "INV-2606", client: "AestheticEdge Lab", month: "April 2026", caseCount: 27, amount: 2450, status: "Pending", generatedAt: "2026-05-01", dueDate: "2026-05-15", payLink: "#" },
  { id: "INV-2607", client: "DentureFit Lab", month: "April 2026", caseCount: 14, amount: 1180, status: "Paid", generatedAt: "2026-05-01", dueDate: "2026-05-12", payLink: "#" },
];

// ─────────── Support tickets ───────────
export const tickets: SupportTicket[] = [
  { id: "TK-101", subject: "STL upload fails for >40MB files", type: "Technical", urgency: "High", status: "In Progress", createdAt: "2026-05-08", lastUpdate: "2026-05-09" },
  { id: "TK-100", subject: "Invoice INV-2602 amount mismatch", type: "Billing", urgency: "Medium", status: "Open", createdAt: "2026-05-07", lastUpdate: "2026-05-07" },
  { id: "TK-099", subject: "Case IC-2404 — design link broken", type: "Case Issue", urgency: "Critical", status: "Resolved", createdAt: "2026-05-05", lastUpdate: "2026-05-06" },
  { id: "TK-098", subject: "Request: bulk-export cases to CSV", type: "Feature Request", urgency: "Low", status: "Open", createdAt: "2026-05-04", lastUpdate: "2026-05-04" },
];

// ─────────── Tutorials ───────────
export const tutorials: Tutorial[] = [
  { id: "TUT-1", title: "Getting started with Iconic Connect", description: "Tour of the lab portal in under 5 minutes.", duration: "4:32", category: "Getting Started", thumbnail: "🎬" },
  { id: "TUT-2", title: "How to add a new case", description: "Step-by-step: case type, tooth chart, scans and notes.", duration: "6:18", category: "Cases", thumbnail: "🦷" },
  { id: "TUT-3", title: "Using the USA tooth chart", description: "Understanding the Universal Numbering System.", duration: "3:05", category: "Cases", thumbnail: "🗂️" },
  { id: "TUT-4", title: "Reading your monthly billing summary", description: "Walk-through of invoices and case-level charges.", duration: "5:42", category: "Billing", thumbnail: "💳" },
  { id: "TUT-5", title: "How to raise a support ticket", description: "Pick the right urgency and category.", duration: "2:50", category: "Support", thumbnail: "🛟" },
  { id: "TUT-6", title: "Tips for clean intraoral scans", description: "5 fast wins to reduce redesigns.", duration: "7:11", category: "Tips", thumbnail: "💡" },
];

// ─────────── Clients (used by admin portal) ───────────
export const clients: ClientAccount[] = [
  {
    id: "CL-001",
    company: "PrecisionDent Lab",
    poc: "Daniel Ortega",
    email: "daniel@precisiondent.com",
    phone: "+1 (212) 555-0140",
    location: "New York, USA",
    onboardedAt: "2025-09-12",
    status: "Active",
    monthlyVolume: 45,
    priceList: [
      { caseType: "Crown & Bridge", price: 18 },
      { caseType: "Implants", price: 30 },
      { caseType: "Removables", price: 35 },
      { caseType: "Dentures", price: 40 },
      { caseType: "Surgical Guides", price: 45 },
      { caseType: "Splints / Nightguards", price: 22 },
    ],
    preferences: "Prefers anatomic contour, A2 default, deliver STL + screenshots.",
  },
  {
    id: "CL-002",
    company: "SmileCraft Labs",
    poc: "Olivia Bennett",
    email: "olivia@smilecraft.io",
    phone: "+1 (312) 555-0181",
    location: "Chicago, USA",
    onboardedAt: "2025-11-04",
    status: "Active",
    monthlyVolume: 32,
    priceList: [
      { caseType: "Crown & Bridge", price: 17 },
      { caseType: "Implants", price: 28 },
      { caseType: "Removables", price: 32 },
      { caseType: "Dentures", price: 38 },
      { caseType: "Surgical Guides", price: 42 },
      { caseType: "Splints / Nightguards", price: 20 },
    ],
    preferences: "Cement gap 60µm, occlusal contact 100µm.",
  },
  {
    id: "CL-003",
    company: "ImplantPro Lab",
    poc: "Marcus Wei",
    email: "marcus@implantpro.com",
    phone: "+1 (310) 555-0117",
    location: "Los Angeles, USA",
    onboardedAt: "2025-07-21",
    status: "Active",
    monthlyVolume: 28,
    priceList: [
      { caseType: "Crown & Bridge", price: 19 },
      { caseType: "Implants", price: 32 },
      { caseType: "Removables", price: 36 },
      { caseType: "Dentures", price: 42 },
      { caseType: "Surgical Guides", price: 48 },
      { caseType: "Splints / Nightguards", price: 22 },
    ],
    preferences: "All implants screw-retained where possible.",
  },
  {
    id: "CL-004",
    company: "AestheticEdge Lab",
    poc: "Sienna Park",
    email: "sienna@aestheticedge.com",
    phone: "+1 (305) 555-0172",
    location: "Miami, USA",
    onboardedAt: "2026-01-19",
    status: "Active",
    monthlyVolume: 30,
    priceList: [
      { caseType: "Crown & Bridge", price: 20 },
      { caseType: "Implants", price: 32 },
      { caseType: "Removables", price: 36 },
      { caseType: "Dentures", price: 42 },
      { caseType: "Surgical Guides", price: 48 },
      { caseType: "Splints / Nightguards", price: 22 },
    ],
    preferences: "Detailed anatomy on anteriors, soft incisal halos.",
  },
  {
    id: "CL-005",
    company: "DentureFit Lab",
    poc: "Henry Walsh",
    email: "henry@denturefit.com",
    phone: "+1 (214) 555-0166",
    location: "Dallas, USA",
    onboardedAt: "2025-10-02",
    status: "Active",
    monthlyVolume: 18,
    priceList: [
      { caseType: "Crown & Bridge", price: 17 },
      { caseType: "Implants", price: 28 },
      { caseType: "Removables", price: 30 },
      { caseType: "Dentures", price: 36 },
      { caseType: "Surgical Guides", price: 42 },
      { caseType: "Splints / Nightguards", price: 20 },
    ],
    preferences: "Removable cases — chrome cobalt default.",
  },
  {
    id: "CL-006",
    company: "NorthArc Dental Studio",
    poc: "Priya Raman",
    email: "priya@northarc.in",
    phone: "+91 98200 12345",
    location: "Mumbai, India",
    onboardedAt: "2026-05-02",
    status: "Onboarding",
    monthlyVolume: 0,
    priceList: [
      { caseType: "Crown & Bridge", price: 14 },
      { caseType: "Implants", price: 24 },
      { caseType: "Removables", price: 28 },
      { caseType: "Dentures", price: 32 },
      { caseType: "Surgical Guides", price: 38 },
      { caseType: "Splints / Nightguards", price: 18 },
    ],
    preferences: "Pending preference form upload.",
  },
];

// Activity feed (used on dashboards)
export const activityFeed = [
  { id: "A1", type: "submit", message: "Case IC-2409 submitted", time: "12 min ago" },
  { id: "A2", type: "status", message: "IC-2403 moved to Internal QC", time: "1 hr ago" },
  { id: "A3", type: "feedback", message: "Client feedback received on IC-2404", time: "3 hr ago" },
  { id: "A4", type: "billing", message: "Invoice INV-2605 generated", time: "Yesterday" },
  { id: "A5", type: "complete", message: "IC-2412 marked Completed", time: "Yesterday" },
];

export const caseTypes: CaseType[] = [
  "Crown & Bridge",
  "Implants",
  "Removables",
  "Dentures",
  "Surgical Guides",
  "Splints / Nightguards",
];

// Designers (admin side)
export const designers = [
  { id: "DSG-1", name: "Aarav Mehta", load: 6 },
  { id: "DSG-2", name: "Karan Verma", load: 8 },
  { id: "DSG-3", name: "Sneha Iyer", load: 5 },
  { id: "DSG-4", name: "Meera Nair", load: 4 },
];
