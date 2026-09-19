export type Role = "owner" | "admin" | "manager" | "cashier";
export type Gender = "male" | "female" | "other";
export type User = { id: string; name: string; role: Role; secret: string; phone?: string; gender?: Gender; store?: string };

export const USERS: User[] = [
  { id: "owner-1", name: "Jacques Owner", role: "owner", secret: "1", phone: "+509 1000 0001", gender: "male", store: "Petyonvil" },
  { id: "admin-1", name: "Marie Admin", role: "admin", secret: "2", phone: "+509 1000 0002", gender: "female", store: "Petyonvil" },
  { id: "manager-1", name: "Pierre Manager", role: "manager", secret: "3", phone: "+509 1000 0003", gender: "male", store: "Dèlma" },
  { id: "cashier-1", name: "Sophie Cashier", role: "cashier", secret: "4", phone: "+509 1000 0004", gender: "female", store: "Petyonvil" },
];

export const getUserById = (id: string) => USERS.find(u => u.id === id);
export const getUserBySecret = (secret: string) => USERS.find(u => u.secret === secret);
