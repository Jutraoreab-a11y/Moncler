/**
 * GET /api/public — données publiques pour les visiteurs non connectés :
 * catalogue, modèles, et ateliers (position et rayon seulement) pour le test de zone.
 */
import { supabaseAdmin } from "@/lib/supabase/server";
import { route } from "@/lib/server/http";
import { toModel, toRecipe } from "@/lib/server/mappers";

export const revalidate = 300;

export const GET = route(async () => {
  const db = supabaseAdmin();
  const [catalog, models, florists] = await Promise.all([
    db.from("flower_catalog_recipes").select("*"),
    db.from("bouquet_models").select("*").eq("active", true).order("sort"),
    db.from("florists").select("id, shop_name, lat, lng, radius_km, active, saas_plan, completed_orders, daily_capacity, delivery_mode").eq("active", true),
  ]);
  return {
    catalog: (catalog.data ?? []).map(toRecipe),
    models: (models.data ?? []).map(toModel),
    florists: (florists.data ?? []).map((f) => ({
      id: f.id,
      shopName: f.shop_name,
      ownerName: "",
      address: "",
      city: "",
      lat: f.lat,
      lng: f.lng,
      radiusKm: Number(f.radius_km),
      deliveryMode: f.delivery_mode,
      completedOrders: f.completed_orders,
      saasPlan: f.saas_plan,
      stripeConnected: false,
      active: f.active,
      dailyCapacity: f.daily_capacity,
    })),
  };
});
