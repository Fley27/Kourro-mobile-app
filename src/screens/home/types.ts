export type RangeKey = "today" | "7d" | "28d" | "6m" | "1y" | "lifetime";

export const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Aujourd'hui" },
  { key: "7d", label: "7 jours" },
  { key: "28d", label: "28 jours" },
  { key: "6m", label: "6 mois" },
  { key: "1y", label: "1 an" },
  { key: "lifetime", label: "Vitalité" },
];

export type TrendPoint = { d: string; v: number };

export type BestItem = {
  name: string;
  sku: string;
  qty: number;
  amount: number;
  icon: string;
  rank: number;
};

export type ProfitStats = {
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
};

export type DayKPIs = {
  totalSales: number;
  transactionCount: number;
  avgBasket: number;
  cashAmount: number;
  creditAmount: number;
};

export type EmployeeKPI = {
  employeeId: string;
  name: string;
  role: string;
  isOnline?: boolean;
  today: DayKPIs;
  lastDay: (DayKPIs & { date: string }) | null;
};

export type ProfitSegment = {
  label: string;
  cashSales: number;
  collectedCredit: number;
  outstandingCredit: number;
};

export type TeamKPI = {
  cashSales: number;
  creditSales: number;
  mobileAmount: number;
  totalSales: number;
  transactionCount: number;
  totalCreditIssued: number;
  creditCollected: number;
  creditOutstanding: number;
  grossProfit: number;
  profitLabels: string[];
  profitSegments: ProfitSegment[];
};
