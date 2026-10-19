// Subscription snapshot shapes shared by the local store, offline credential
// records and the auth flow. The authoritative rule lives in
// @retail/shared-types (isSubscriptionWritable), mirrored in SQL by migration
// 029; the snapshot is only what this device last saw ONLINE.
export type SubscriptionSnapshot = {
  organizationId: string;
  plan_code: string | null;
  status: string | null;
  trial_ends_at: string | null;
  renews_at: string | null;
  /** When this snapshot was fetched from Supabase (ISO). */
  fetched_at: string;
};
