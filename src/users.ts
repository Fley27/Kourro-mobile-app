import { stableId } from "./db/ids";

export type Role = "owner" | "admin" | "manager" | "cashier" | "associate" | "cook";
export type Gender = "male" | "female" | "other";
export type User = { id: string; name: string; role: Role; secret: string; phone?: string; gender?: Gender; store?: string };
export type BusinessType = "retail" | "bar" | "resto";

/** Stable uuids for the seeded roster (legacy ids: owner-1 ... cook-1). */
export const USER_IDS = {
  owner: stableId("owner-1"),
  admin: stableId("admin-1"),
  manager: stableId("manager-1"),
  cashier: stableId("cashier-1"),
  associate: stableId("associate-1"),
  cook: stableId("cook-1"),
} as const;

export const USERS: User[] = [
  { id: USER_IDS.owner, name: "Jacques Owner", role: "owner", secret: "1", phone: "+509 1000 0001", gender: "male", store: "Petyonvil" },
  { id: USER_IDS.admin, name: "Marie Admin", role: "admin", secret: "2", phone: "+509 1000 0002", gender: "female", store: "Petyonvil" },
  { id: USER_IDS.manager, name: "Pierre Manager", role: "manager", secret: "3", phone: "+509 1000 0003", gender: "male", store: "Dèlma" },
  { id: USER_IDS.cashier, name: "Sophie Cashier", role: "cashier", secret: "4", phone: "+509 1000 0004", gender: "female", store: "Petyonvil" },
  { id: USER_IDS.associate, name: "Nadia Associate", role: "associate", secret: "5", phone: "+509 1000 0005", gender: "female", store: "Petyonvil" },
  { id: USER_IDS.cook, name: "Chef Cook", role: "cook", secret: "6", phone: "+509 1000 0006", gender: "male", store: "Petyonvil" },
];

// Rank for hierarchy comparisons (Team management, approvals).
export const ROLE_RANK: Record<Role, number> = {
  owner: 4,
  admin: 3,
  manager: 2,
  cashier: 1,
  associate: 1,
  cook: 1,
};

// Display label — associate is titled "Server" in bar/resto businesses.
export function roleLabel(role: Role, businessType: BusinessType = "retail"): string {
  if (role === "associate") return businessType === "retail" ? "Associate" : "Server";
  if (role === "cook") return "Cook";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

// Roles tied to bar/resto businesses (creation gated by business type).
export function roleNeedsHospitality(role: Role): boolean {
  return role === "cook";
}

export const getUserById = (id: string) => USERS.find(u => u.id === id);
export const getUserBySecret = (secret: string) => USERS.find(u => u.secret === secret);
