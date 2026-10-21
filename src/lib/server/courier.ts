import "server-only";

/**
 * Déclenchement des coursiers quand un bouquet passe "Prêt à être récupéré".
 * Uber Direct : https://developer.uber.com/docs/deliveries
 * Stuart      : https://api-docs.stuart.com
 * Les statuts reviennent ensuite via /api/webhooks/courier.
 */
export interface Pickup {
  orderId: string;
  shopName: string;
  shopAddress: string;
  shopPhone?: string;
  dropoffName: string;
  dropoffAddress: string;
  dropoffPhone: string;
  dropoffNotes?: string;
}

export interface CourierJob {
  ref: string;
  trackingUrl?: string;
}

async function uberToken() {
  const res = await fetch("https://auth.uber.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.UBER_CLIENT_ID!,
      client_secret: process.env.UBER_CLIENT_SECRET!,
      grant_type: "client_credentials",
      scope: "eats.deliveries",
    }),
  });
  if (!res.ok) throw new Error(`Uber auth ${res.status}`);
  return (await res.json()).access_token as string;
}

export async function requestUberDirect(p: Pickup): Promise<CourierJob> {
  const token = await uberToken();
  const res = await fetch(`https://api.uber.com/v1/customers/${process.env.UBER_CUSTOMER_ID}/deliveries`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      external_id: p.orderId,
      pickup_name: p.shopName,
      pickup_address: p.shopAddress,
      pickup_phone_number: p.shopPhone ?? process.env.MONCLEUR_SUPPORT_PHONE,
      dropoff_name: p.dropoffName,
      dropoff_address: p.dropoffAddress,
      dropoff_phone_number: p.dropoffPhone,
      dropoff_notes: p.dropoffNotes,
      manifest_items: [{ name: "Bouquet de fleurs fragile", quantity: 1, size: "medium" }],
    }),
  });
  if (!res.ok) throw new Error(`Uber Direct ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return { ref: j.id, trackingUrl: j.tracking_url };
}

export async function requestStuart(p: Pickup): Promise<CourierJob> {
  const base = process.env.STUART_ENV === "production" ? "https://api.stuart.com" : "https://api.sandbox.stuart.com";
  const auth = await fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.STUART_CLIENT_ID!,
      client_secret: process.env.STUART_CLIENT_SECRET!,
      grant_type: "client_credentials",
      scope: "api",
    }),
  });
  const { access_token } = await auth.json();
  const res = await fetch(`${base}/v2/jobs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      job: {
        client_reference: p.orderId,
        pickups: [{ address: p.shopAddress, contact: { company: p.shopName, phone: p.shopPhone } }],
        dropoffs: [{ address: p.dropoffAddress, package_type: "small", comment: p.dropoffNotes, contact: { firstname: p.dropoffName, phone: p.dropoffPhone } }],
      },
    }),
  });
  if (!res.ok) throw new Error(`Stuart ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return { ref: String(j.id), trackingUrl: j.deliveries?.[0]?.tracking_url };
}

export function requestCourier(mode: "uber_direct" | "stuart", p: Pickup) {
  return mode === "uber_direct" ? requestUberDirect(p) : requestStuart(p);
}
