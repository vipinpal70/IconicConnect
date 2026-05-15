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

export const caseTypes = ["Crown & Bridge", "Implants", "Removables", "Orthodontics", "Surgical Guides"];

export const cases = [
  { 
    id: "CAS-7281", 
    restoration: "Zirconia Crown", 
    status: "In Design" as CaseStatus, 
    patientRef: "PR-8821", 
    caseType: "Crown & Bridge", 
    toothNumbers: [14], 
    updatedAt: "2024-05-14", 
    createdAt: "2024-05-12",
    dueDate: "2024-05-20",
    designer: "Alex Chen",
    qcLead: "Sarah J.",
    notes: "High translucency zirconia requested.",
    modelRequired: false,
    timeline: [
      { event: "Case submitted", date: "2024-05-12 08:00", actor: "PrecisionDent" },
      { event: "Validated by QC", date: "2024-05-12 11:30", actor: "Sarah J." },
      { event: "Allocated to designer", date: "2024-05-13 09:00", actor: "System" },
    ]
  },
  { 
    id: "CAS-7279", 
    restoration: "Bridge (3-unit)", 
    status: "Internal QC" as CaseStatus, 
    patientRef: "PR-8819", 
    caseType: "Crown & Bridge", 
    toothNumbers: [3, 4, 5], 
    updatedAt: "2024-05-14", 
    createdAt: "2024-05-11",
    dueDate: "2024-05-18",
    designer: "Michael R.",
    qcLead: "Sarah J.",
    notes: "Bridge spans 3,4,5. PFM material.",
    modelRequired: true,
    timeline: [
      { event: "Case submitted", date: "2024-05-11 14:00", actor: "PrecisionDent" },
      { event: "Validated by QC", date: "2024-05-11 16:30", actor: "Sarah J." },
      { event: "Design completed", date: "2024-05-14 09:30", actor: "Michael R." },
    ]
  },
  { 
    id: "CAS-7275", 
    restoration: "Night Guard", 
    status: "Completed" as CaseStatus, 
    patientRef: "PR-8812", 
    caseType: "Removables", 
    toothNumbers: [], 
    updatedAt: "2024-05-13", 
    createdAt: "2024-05-10",
    dueDate: "2024-05-15",
    designer: "Emma L.",
    qcLead: "Sarah J.",
    notes: "Soft-hard dual layer.",
    modelRequired: false,
    timeline: [
      { event: "Case submitted", date: "2024-05-10 11:00", actor: "PrecisionDent" },
      { event: "Design approved", date: "2024-05-13 14:00", actor: "PrecisionDent" },
      { event: "Case marked completed", date: "2024-05-13 16:00", actor: "Sarah J." },
    ]
  },
];

export const activityFeed = [
  { id: "1", type: "submit", message: "New case CAS-7281 submitted", time: "2 hours ago" },
  { id: "2", type: "status", message: "Case CAS-7279 moved to Internal QC", time: "4 hours ago" },
  { id: "3", type: "feedback", message: "New feedback received for CAS-7265", time: "1 day ago" },
  { id: "4", type: "billing", message: "Invoice INV-2024-05 paid successfully", time: "2 days ago" },
  { id: "5", type: "complete", message: "Case CAS-7260 marked as Completed", time: "4 days ago" },
];

export const invoices = [
  { id: "INV-2024-05", month: "May 2024", caseCount: 18, amount: 1240, status: "Paid" },
  { id: "INV-2024-04", month: "April 2024", caseCount: 42, amount: 2980, status: "Paid" },
  { id: "INV-2024-03", month: "March 2024", caseCount: 35, amount: 2640, status: "Paid" },
  { id: "INV-2024-02", month: "February 2024", caseCount: 31, amount: 2310, status: "Paid" },
  { id: "INV-2024-01", month: "January 2024", caseCount: 28, amount: 2080, status: "Paid" },
];
