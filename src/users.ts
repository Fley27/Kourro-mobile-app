export type Role = "owner" | "admin" | "manager" | "cashier" | "associate" | "cook";
export type Gender = "male" | "female" | "other";
export type User = { id: string; name: string; role: Role; secret: string; phone?: string; gender?: Gender; store?: string };
export type BusinessType = "retail" | "bar" | "resto";

export const USERS: User[] = [
  { id: "owner-1", name: "Jacques Owner", role: "owner", secret: "1", phone: "+509 1000 0001", gender: "male", store: "Petyonvil" },
  { id: "admin-1", name: "Marie Admin", role: "admin", secret: "2", phone: "+509 1000 0002", gender: "female", store: "Petyonvil" },
  { id: "manager-1", name: "Pierre Manager", role: "manager", secret: "3", phone: "+509 1000 0003", gender: "male", store: "Dèlma" },
  { id: "cashier-1", name: "Sophie Cashier", role: "cashier", secret: "4", phone: "+509 1000 0004", gender: "female", store: "Petyonvil" },
  { id: "associate-1", name: "Nadia Associate", role: "associate", secret: "5", phone: "+509 1000 0005", gender: "female", store: "Petyonvil" },
  { id: "cook-1", name: "Chef Cook", role: "cook", secret: "6", phone: "+509 1000 0006", gender: "male", store: "Petyonvil" },
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
