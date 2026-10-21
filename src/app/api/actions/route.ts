/**
 * POST /api/actions — Réplique côté serveur les actions du store (UI optimiste).
 * Chaque action est vérifiée : la RLS limite ce que l'utilisateur peut écrire,
 * et les actions sensibles passent par le service role après contrôle du rôle.
 */
import type { Action } from "@/lib/store";
import { requireUser, supabaseAdmin } from "@/lib/supabase/server";
import { fail, route } from "@/lib/server/http";
import { dispatchDue, transitionOrder } from "@/lib/server/orders";
import { toSchedule } from "@/lib/server/mappers";
import { canRetract, carnetIssues, monthlyOccasionIssues } from "@/lib/pricing";
import { notifyCustomer } from "@/lib/server/notify";
import { rescheduleAbsent } from "@/lib/server/orders";
import { stripe } from "@/lib/server/stripe";
import { assignByOps, respondToOffer, runGuarantee } from "@/lib/server/guarantee";

export const POST = route(async (req: Request) => {
  const a = (await req.json()) as Action;
  const { sb, user, profile } = await requireUser();
  const admin = profile.role === "admin";
  const asAdmin = () => {
    if (!admin) throw fail(403, "Réservé à l'administration");
    return supabaseAdmin();
  };

  switch (a.type) {
    case "status":
      return transitionOrder(supabaseAdmin(), a.orderId, a.status, { floristOwnerId: user.id, admin });

    case "toggleSchedule": {
      const { data } = await sb.from("schedules").select("active").eq("id", a.id).single();
      if (!data) throw fail(404, "Date introuvable");
      await sb.from("schedules").update({ active: !data.active }).eq("id", a.id);
      return { ok: true };
    }

    case "editSchedule": {
      const patch: Record<string, unknown> = {};
      if (a.patch.message !== undefined) patch.message = a.patch.message.slice(0, 200);
      // La gamme suit l'abonnement : on change la taille d'une occasion via upgradeTo
      if ("upgradeTo" in a.patch) patch.upgrade_to = a.patch.upgradeTo ?? null;
      if ("extraStemId" in a.patch) patch.extra_stem = a.patch.extraStemId ?? null;
      // Mode de choix du bouquet ; le trigger resync_order_models met à jour les commandes non commencées
      if (a.patch.mode) {
        patch.selection_mode = a.patch.mode;
        patch.model_id = a.patch.mode === "fixed" ? a.patch.modelId : null;
        if (a.patch.mode === "fixed") {
          const { data: m } = await sb.from("bouquet_models").select("plan_id, active").eq("id", a.patch.modelId ?? "").single();
          const { data: cur } = await sb.from("schedules").select("plan_id").eq("id", a.id).single();
          if (!m?.active || m.plan_id !== cur?.plan_id) throw fail(400, "Modèle indisponible pour cette gamme");
        }
      }
      const { error: upErr } = await sb.from("schedules").update(patch).eq("id", a.id);
      if (upErr) throw fail(400, upErr.message);
      if ("upgradeTo" in a.patch || "extraStemId" in a.patch) await dispatchDue(supabaseAdmin(), { userId: user.id });
      if (patch.message !== undefined) {
        await supabaseAdmin().from("orders").update({ message: patch.message }).eq("schedule_id", a.id).eq("user_id", user.id).in("status", ["scheduled", "assigned"]);
      }
      return { ok: true };
    }

    case "subscription": {
      // Ciblage de l'abonnement par id (un client peut avoir un Mensuel et un Carnet)
      const { data: sub } = await sb.from("subscriptions").select("*").eq("id", a.id).eq("user_id", user.id).single();
      if (!sub?.stripe_subscription_id) throw fail(404, "Abonnement introuvable");
      const carnet = sub.plan_type === "SPECIAL_EVENTS_CARNET";
      const admin = supabaseAdmin();
      const inCommitment = carnet && new Date(sub.commitment_ends_at) > new Date();

      if (a.status === "paused") {
        if (carnet) throw fail(409, "Le Carnet Occasions Clés ne peut pas être mis en pause pendant l'engagement");
        await stripe().subscriptions.update(sub.stripe_subscription_id, { pause_collection: { behavior: "void" } });
        await admin.from("subscriptions").update({ status: "paused" }).eq("id", sub.id);
        await admin.from("orders").update({ status: "cancelled", cancel_reason: "Abonnement en pause" }).eq("subscription_id", sub.id).in("status", ["scheduled", "assigned"]);
      }
      if (a.status === "cancelled") {
        const { data: delivered } = await admin.from("orders").select("id").eq("subscription_id", sub.id).eq("status", "delivered").limit(1);
        const retract = canRetract({ id: sub.id, startedAt: sub.started_at }, delivered?.length ? [{ subscriptionId: sub.id, status: "delivered" }] : []);
        if (retract) {
          // Rétractation (14 jours, aucun bouquet livré) : arrêt immédiat et remboursement intégral
          const stripeSub = await stripe().subscriptions.retrieve(sub.stripe_subscription_id, { expand: ["latest_invoice.payments"] });
          await stripe().subscriptions.cancel(sub.stripe_subscription_id);
          const inv = stripeSub.latest_invoice as unknown as { payments?: { data: { payment: { payment_intent?: string } }[] } } | null;
          const pi = inv?.payments?.data?.[0]?.payment?.payment_intent;
          if (pi) await stripe().refunds.create({ payment_intent: pi }, { idempotencyKey: `retract_${sub.id}` });
          await admin.from("subscriptions").update({ status: "cancelled" }).eq("id", sub.id);
          await admin.from("orders").update({ status: "cancelled", cancel_reason: "Rétractation" }).eq("subscription_id", sub.id).in("status", ["scheduled", "assigned"]);
          await notifyCustomer(profile.email, "Rétractation confirmée", `Votre abonnement est arrêté et vous êtes remboursé intégralement sous 5 à 10 jours.`);
        } else if (inCommitment) {
          // Engagement 12 mois : résiliation effective à la fin de l'engagement
          const cancelAt = Math.floor(new Date(sub.commitment_ends_at).getTime() / 1000);
          await stripe().subscriptions.update(sub.stripe_subscription_id, { cancel_at: cancelAt, metadata: { plan_type: sub.plan_type, cancel_requested_at: new Date().toISOString() } });
          await admin.from("subscriptions").update({ cancel_at_commitment_end: true }).eq("id", sub.id);
          await notifyCustomer(profile.email, "Résiliation enregistrée", `Votre Carnet Occasions Clés prendra fin le ${sub.commitment_ends_at}, au terme de l'engagement de 12 mois. Vos dates restent livrées jusque-là.`);
        } else {
          await stripe().subscriptions.cancel(sub.stripe_subscription_id);
          await admin.from("subscriptions").update({ status: "cancelled" }).eq("id", sub.id);
          await admin.from("orders").update({ status: "cancelled", cancel_reason: "Abonnement résilié" }).eq("subscription_id", sub.id).in("status", ["scheduled", "assigned"]);
          await notifyCustomer(profile.email, "Résiliation confirmée", `Votre abonnement est résilié à compter d'aujourd'hui. Aucun prélèvement ne sera effectué.`);
        }
      }
      if (a.status === "active") {
        if (sub.cancel_at_commitment_end) {
          await stripe().subscriptions.update(sub.stripe_subscription_id, { cancel_at: null });
          await admin.from("subscriptions").update({ cancel_at_commitment_end: false }).eq("id", sub.id);
        } else {
          await stripe().subscriptions.update(sub.stripe_subscription_id, { pause_collection: null });
          await admin.from("subscriptions").update({ status: "active" }).eq("id", sub.id);
        }
        await dispatchDue(admin, { userId: user.id });
      }
      return { ok: true };
    }

    case "override": {
      // Réglage d'une livraison précise : surclassement ponctuel, extra tige, garder deux livraisons
      const [scheduleId, date] = a.key.split("@");
      const { data: sch } = await sb.from("schedules").select("id").eq("id", scheduleId).single();
      if (!sch) throw fail(404, "Date introuvable");
      const { data: cur } = await sb.from("occurrence_overrides").select("*").eq("schedule_id", scheduleId).eq("occurrence_date", date).maybeSingle();
      const row = { schedule_id: scheduleId, occurrence_date: date, upgrade_to: cur?.upgrade_to ?? null, clear_upgrade: cur?.clear_upgrade ?? false, extra_stem: cur?.extra_stem ?? null, clear_extra: cur?.clear_extra ?? false, keep_separate: cur?.keep_separate ?? false, updated_at: new Date().toISOString() };
      if ("upgradeTo" in a.patch) Object.assign(row, { upgrade_to: a.patch.upgradeTo ?? null, clear_upgrade: a.patch.upgradeTo === null });
      if ("extraStemId" in a.patch) Object.assign(row, { extra_stem: a.patch.extraStemId ?? null, clear_extra: a.patch.extraStemId === null });
      if (a.patch.keepSeparate !== undefined) row.keep_separate = a.patch.keepSeparate;
      const { error } = await sb.from("occurrence_overrides").upsert(row, { onConflict: "schedule_id,occurrence_date" });
      if (error) throw fail(400, error.message);
      await dispatchDue(supabaseAdmin(), { userId: user.id }); // recalcul des prix des commandes à J-7
      return { ok: true };
    }

    case "addOccasion": {
      const s0 = a.schedule;
      const { data: sub } = await sb.from("subscriptions").select("id, plan_id, plan_type").eq("id", s0.subscriptionId).eq("user_id", user.id).single();
      if (!sub) throw fail(404, "Abonnement introuvable");
      if (s0.type === "monthly") throw fail(400, "Une occasion ne peut pas être mensuelle");
      const { data: existing } = await sb.from("schedules").select("*").eq("subscription_id", sub.id);
      const all = [...(existing ?? []).map(toSchedule), { ...s0, active: true }];
      const issues = sub.plan_type === "SPECIAL_EVENTS_CARNET" ? carnetIssues(all) : monthlyOccasionIssues(all);
      if (issues.length) throw fail(400, issues[0]);
      // Mensuel : l'occasion remplace le bouquet du mois de ce destinataire
      if (sub.plan_type === "MONTHLY_RECURRING" && existing?.length && !existing.some((x) => x.recipient_id === s0.recipientId)) throw fail(400, "Avec le Mensuel, les occasions sont pour le destinataire de l'abonnement. Pour une autre personne, créez un Carnet.");
      const { error } = await sb.from("schedules").insert({
        subscription_id: sub.id,
        recipient_id: s0.recipientId,
        // Carnet : chaque date a sa propre taille
        plan_id: sub.plan_type === "SPECIAL_EVENTS_CARNET" ? s0.planId : sub.plan_id,
        added_at: new Date().toISOString().slice(0, 10),
        type: s0.type,
        event_date: s0.type === "birthday" || s0.type === "custom" ? s0.date : null,
        label: s0.label,
        message: s0.message.slice(0, 200),
        selection_mode: s0.mode,
        model_id: s0.mode === "fixed" ? s0.modelId : null,
        upgrade_to: s0.upgradeTo ?? null,
        extra_stem: s0.extraStemId ?? null,
      });
      if (error) throw fail(400, error.message);
      await dispatchDue(supabaseAdmin(), { userId: user.id });
      return { ok: true };
    }

    case "floristPatch": {
      const p = a.patch;
      await sb
        .from("florists")
        .update({
          ...(p.shopName !== undefined && { shop_name: p.shopName }),
          ...(p.radiusKm !== undefined && { radius_km: p.radiusKm }),
          ...(p.deliveryMode !== undefined && { delivery_mode: p.deliveryMode }),
          ...(p.active !== undefined && { active: p.active }),
          ...(p.dailyCapacity !== undefined && { daily_capacity: p.dailyCapacity }),
          ...(p.closedWeekdays !== undefined && { closed_weekdays: p.closedWeekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) }),
          ...(p.closedOnHolidays !== undefined && { closed_on_holidays: p.closedOnHolidays }),
          ...(p.autoAccept !== undefined && { auto_accept: p.autoAccept }),
          ...(p.phone !== undefined && { phone: p.phone.slice(0, 20) || null }),
        })
        .eq("id", a.id)
        .eq("owner_id", user.id);
      // Nouveau jour de fermeture, pause, capacité : les commandes concernées repartent tout de suite
      if (p.closedWeekdays !== undefined || p.closedOnHolidays !== undefined || p.active !== undefined) await runGuarantee(supabaseAdmin());
      return { ok: true };
    }

    // ---- Garantie de livraison ----
    case "acceptOffer":
    case "declineOffer":
      return respondToOffer(supabaseAdmin(), { orderId: a.orderId, ownerId: user.id, accept: a.type === "acceptOffer", reason: a.type === "declineOffer" ? a.reason : undefined });

    case "addClosure": {
      const c = a.closure;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c.from) || !/^\d{4}-\d{2}-\d{2}$/.test(c.to) || c.to < c.from) throw fail(400, "Dates de fermeture invalides");
      // RLS : seul le propriétaire de l'atelier (ou l'équipe) peut déclarer une fermeture
      const { error } = await sb.from("florist_closures").insert({ florist_id: a.floristId, starts_on: c.from, ends_on: c.to, reason: c.reason?.slice(0, 80) ?? null });
      if (error) throw fail(400, error.message);
      // Les commandes acceptées sur ces dates partent chez un voisin dès maintenant
      await runGuarantee(supabaseAdmin());
      return { ok: true };
    }
    case "removeClosure":
      await sb.from("florist_closures").delete().eq("id", a.closureId).eq("florist_id", a.floristId);
      return { ok: true };

    case "clearStrikes":
      await asAdmin().from("florists").update({ strikes_cleared_at: new Date().toISOString() }).eq("id", a.floristId);
      return { ok: true };

    case "recipe": {
      const p = a.patch;
      await asAdmin()
        .from("flower_catalog_recipes")
        .update({
          ...(p.name !== undefined && { name: p.name }),
          ...(p.priceCents !== undefined && { price_cents: p.priceCents }),
          ...(p.floristPayoutCents !== undefined && { florist_payout_cents: p.floristPayoutCents }),
          ...(p.flowerBudgetCents !== undefined && { flower_budget_cents: p.flowerBudgetCents }),
          ...(p.stems !== undefined && { stems: p.stems }),
          ...(p.palette !== undefined && { palette: p.palette }),
          ...(p.packaging !== undefined && { packaging: p.packaging }),
          ...(p.notes !== undefined && { notes: p.notes }),
          updated_at: new Date().toISOString(),
        })
        .eq("plan_id", a.planId);
      return { ok: true };
    }

    case "model": {
      const p = a.patch;
      await asAdmin()
        .from("bouquet_models")
        .update({
          ...(p.name !== undefined && { name: p.name }),
          ...(p.tagline !== undefined && { tagline: p.tagline }),
          ...(p.stems !== undefined && { stems: p.stems }),
          ...(p.palette !== undefined && { palette: p.palette }),
          ...(p.packaging !== undefined && { packaging: p.packaging }),
          ...(p.notes !== undefined && { notes: p.notes }),
          ...(p.active !== undefined && { active: p.active }),
          updated_at: new Date().toISOString(),
        })
        .eq("id", a.id);
      return { ok: true };
    }

    case "addModel": {
      const m = a.model;
      await asAdmin().from("bouquet_models").insert({ id: m.id, plan_id: m.planId, name: m.name, tagline: m.tagline, stems: m.stems, palette: m.palette, packaging: m.packaging, notes: m.notes, active: m.active, sort: 99 });
      return { ok: true };
    }

    case "reassign":
      return assignByOps(asAdmin(), a.orderId, a.floristId);

    case "dispatchAll": {
      const db = asAdmin();
      const dispatch = await dispatchDue(db);
      return { dispatch, guarantee: await runGuarantee(db) };
    }

    // Actions propres à la démo (ou gérées par Stripe Checkout / l'onboarding)
    case "addReminders": {
      const rows = a.reminders.slice(0, 500).map((r) => ({ user_id: user.id, name: r.name.slice(0, 80), event_date: r.date, type: r.type, label: r.label.slice(0, 120) }));
      await sb.from("reminders").upsert(rows, { onConflict: "user_id,name,event_date", ignoreDuplicates: true });
      return { ok: true };
    }
    case "removeReminder":
      await sb.from("reminders").delete().eq("id", a.id).eq("user_id", user.id);
      return { ok: true };

    case "absent": {
      // Le fleuriste (ou le coursier) signale l'absence : nouvelle tentative le lendemain
      const db = supabaseAdmin();
      const { data: o } = await db.from("orders").select("id, delivery_date, original_date, attempt, status, florist:florists(owner_id)").eq("id", a.orderId).single();
      const owner = (o?.florist as unknown as { owner_id: string } | null)?.owner_id;
      if (!o || (owner !== user.id && !admin)) throw fail(403, "Commande non attribuée");
      if (o.status !== "in_delivery") throw fail(409, "La commande n'est pas en livraison");
      await rescheduleAbsent(db, o);
      return { ok: true };
    }

    case "photo":
    case "thanks":
    case "waitlist":
      return { ok: true, ignored: a.type }; // routes dédiées
    case "activatePro":
    case "addPlan":
    case "addFlorist":
    case "inject":
    case "florist":
    case "hydrate":
    case "reset":
    // Démo : horloge et simulateur (en production, le cron /api/cron/guarantee fait foi)
    case "tick":
    case "timeTravel":
    case "simulateCutoff":
      return { ok: true, ignored: a.type };
  }
});
