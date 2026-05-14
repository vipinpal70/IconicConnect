export const CURRENT_LAB = {
  clientId: "LAB-001"
};

export type PreferenceForm = {
  id: string;
  title: string;
  category: string;
  body: string;
  createdAt: string;
};

export type LabUser = {
  id: string;
  name: string;
  username: string;
  email: string;
  role: "Owner" | "Manager" | "Coordinator" | "Technician";
  password: string;
};

export const getPreferences = (labId: string): PreferenceForm[] => {
  return [
    { id: "PF-1", title: "General Crown Prefs", category: "Crown & Bridge", body: "Cement gap 40 microns, 0.5mm occlusal clearance.", createdAt: "2024-01-10" }
  ];
};

export const savePreferences = (labId: string, prefs: PreferenceForm[]) => {
  console.log("Saving preferences for", labId, prefs);
};

export const getUsers = (labId: string): LabUser[] => {
  return [
    { id: "U-1", name: "Daniel Ortega", username: "dortega", email: "daniel@precisiondent.com", role: "Owner", password: "Password123" },
    { id: "U-2", name: "Sarah Miller", username: "smiller", email: "sarah@precisiondent.com", role: "Coordinator", password: "Password456" }
  ];
};

export const saveUsers = (labId: string, users: LabUser[]) => {
  console.log("Saving users for", labId, users);
};
