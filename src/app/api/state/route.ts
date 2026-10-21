/**
 * GET /api/state — État applicatif de l'utilisateur connecté, au format du store.
 * La RLS Supabase filtre automatiquement : un client voit ses abonnements et son carnet,
 * un fleuriste ses commandes, un admin tout.
 */
import { requireUser } from "@/lib/supabase/server";
import { route } from "@/lib/server/http";
import { toGuaranteeEvent, toReminder, toFlorist, toModel, toOrder, toOverrides, toPayout, toRecipe, toRecipient, toSchedule, toSubscription } from "@/lib/server/mappers";
import { STATE_VERSION, type AppState } from "@/lib/seed";

export const GET = route(async () => {
  const { sb, user, profile } = await requireUser();

  const [catalog, models, recipients, subscriptions, schedules, overrides, orders, florists, payouts, reminders, me, events] = await Promise.all([
    sb.from("flower_catalog_recipes").select("*"),
    sb.from("bouquet_models").select("*").order("sort"),
    sb.from("recipients").select("*"),
    sb.from("subscriptions").select("*").order("created_at"),
    sb.from("schedules").select("*"),
    sb.from("occurrence_overrides").select("*"),
    sb.from("orders").select("*").order("delivery_date", { ascending: false }).limit(500),
    sb.from("florists").select("*, closures:florist_closures(*), strikes:florist_strikes(*), debits:florist_debits(*)"),
    sb.from("payouts").select("*").order("created_at", { ascending: false }).limit(500),
    sb.from("reminders").select("*").eq("user_id", user.id),
    sb.from("users").select("referral_code").eq("id", user.id).single(),
    // Journal de la garantie : l'admin voit tout, un atelier ce qui le concerne (RLS)
    sb.from("guarantee_events").select("*").order("created_at", { ascending: false }).limit(80),
  ]);

  const own = (florists.data ?? []).find((f) => f.owner_id === user.id);
  const firstSub = (subscriptions.data ?? []).find((s) => s.user_id === user.id);

  const state: AppState = {
    version: STATE_VERSION,
    customer: {
      firstName: (user.user_metadata?.first_name as string) ?? profile.email.split("@")[0],
      email: profile.email,
      since: (firstSub?.created_at ?? new Date().toISOString()).slice(0, 10),
      referralCode: me.data?.referral_code ?? undefined,
    },
    reminders: (reminders.data ?? []).map(toReminder),
    waitlist: [],
    catalog: (catalog.data ?? []).map(toRecipe),
    models: (models.data ?? []).map(toModel),
    recipients: (recipients.data ?? []).map((r) => toRecipient(r, user.id)),
    subscriptions: (subscriptions.data ?? []).map((s) => toSubscription(s, user.id)),
    schedules: (schedules.data ?? []).map(toSchedule),
    overrides: toOverrides(overrides.data ?? []),
    orders: (orders.data ?? []).map(toOrder),
    florists: (florists.data ?? []).map(toFlorist),
    payouts: (payouts.data ?? []).map(toPayout),
    guaranteeLog: (events.data ?? []).map(toGuaranteeEvent),
    currentFloristId: own?.id ?? "",
  };
  return state;
});
