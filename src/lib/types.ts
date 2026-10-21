export type PlanId = "classique" | "signature" | "prestige";

export type OrderStatus =
  | "scheduled" // créée, en attente d'attribution
  | "assigned" // attribuée à un fleuriste
  | "preparing" // en cours de préparation
  | "ready" // prête à être récupérée
  | "in_delivery" // coursier en route
  | "delivered"
  | "cancelled";

export type DeliveryMode = "own" | "uber_direct" | "stuart";

export type EventType = "monthly" | "birthday" | "valentine" | "mothers_day" | "fathers_day" | "custom";

/**
 * Les deux familles d'offres B2C.
 *  - MONTHLY_RECURRING     : 1 bouquet par mois, sans engagement. Occasions en plus à 30 % du prix.
 *  - SPECIAL_EVENTS_CARNET : uniquement des dates clés, engagement 12 mois, 12 bouquets/an max, 1 par mois max.
 */
export type PlanType = "MONTHLY_RECURRING" | "SPECIAL_EVENTS_CARNET";

export interface Subscription {
  id: string;
  customerId: string;
  planType: PlanType;
  planId: PlanId;
  /** 0 (mensuel sans engagement) ou 12 (carnet) */
  commitmentMonths: 0 | 12;
  /** Destinataire du bouquet mensuel (mensuel uniquement) */
  recipientId?: string;
  startedAt: string; // YYYY-MM-DD
  status: "active" | "paused" | "cancelled";
  /** Carnet : arrêt demandé, effectif à la fin de l'engagement */
  cancelAtCommitmentEnd?: boolean;
  /** Montant prélevé chaque mois (Mensuel : prix de la gamme ; Carnet : mensualité calculée) */
  priceCents?: number;
}

/**
 * included : couvert par l'abonnement (bouquet du mois, crédit carnet)
 * addon    : occasion en plus pour un abonné mensuel, facturée 30 % du prix
 * merged   : occasion à moins de 5 jours du bouquet du mois, fusionnée avec lui
 */
export type BillingKind = "included" | "addon" | "merged" | "carnet_added";

/** Réglages d'une livraison précise (clé : scheduleId@YYYY-MM-DD). */
export interface OccurrenceOverride {
  /** Surclassement ponctuel vers une gamme supérieure */
  upgradeTo?: PlanId | null;
  /** Extra tige noble (bouquets Classique) */
  extraStemId?: string | null;
  /** Occasion proche du mensuel : garder deux livraisons au lieu de fusionner */
  keepSeparate?: boolean;
}

/** included : rien à prélever en plus ; pending : prélèvement prévu à J-3 */
export type PaymentStatus = "included" | "pending" | "paid" | "failed";

export interface Recipe {
  planId: PlanId;
  name: string;
  priceCents: number; // prix client / mois
  floristPayoutCents: number; // reversé au fleuriste
  flowerBudgetCents: number; // budget matière
  stems: { label: string; qty: number }[];
  palette: string[]; // couleurs autorisées
  packaging: string;
  size: string;
  notes: string;
}

/** Mode de choix du bouquet pour une date programmée. */
export type SelectionMode = "fixed" | "surprise";

/** Un modèle de bouquet précis au sein d'une gamme (ex. « Corail » dans Le Signature). */
export interface BouquetModel {
  id: string;
  planId: PlanId;
  name: string;
  tagline: string;
  stems: { label: string; qty: number }[];
  palette: string[];
  packaging: string;
  notes: string;
  active: boolean;
}

export interface Recipient {
  id: string;
  /** "me" = l'abonné connecté en démo */
  customerId: string;
  firstName: string;
  lastName: string;
  relation: string;
  address: string;
  postalCode: string;
  city: string;
  lat: number;
  lng: number;
  phone: string;
  accessNotes: string;
}

export interface Schedule {
  id: string;
  subscriptionId: string;
  recipientId: string;
  planId: PlanId;
  type: EventType;
  /** jour du mois (mensuel) */
  dayOfMonth?: number;
  /** MM-DD pour un événement annuel */
  date?: string;
  label: string;
  message: string;
  active: boolean;
  /** fixed = un modèle précis ; surprise = rotation automatique dans la gamme */
  mode: SelectionMode;
  modelId?: string;
  /** Surclassement de chaque envoi de cette occasion (ex. anniversaire toujours en Prestige) */
  upgradeTo?: PlanId;
  /** Extra tige noble ajoutée à chaque envoi de cette date */
  extraStemId?: string;
  /** Date d'ajout (Carnet : une date ajoutée en cours d'année est prélevée à part) */
  addedAt?: string;
}

export interface Order {
  id: string;
  scheduleId: string;
  recipientId: string;
  planId: PlanId;
  subscriptionId?: string;
  /** included = couvert par l'abonnement (mensuel ou crédit carnet) ; addon = facturé +30 % */
  billing?: BillingKind;
  /** Montant prélevé à J-3 en plus de l'abonnement : occasion +30 %, surclassement, extra tige */
  priceCents?: number;
  /** Détail du supplément */
  lines?: { kind: "occasion" | "addon" | "carnet_date" | "upgrade" | "extra_stem"; label: string; amountCents: number; lookupKey: string }[];
  /** Chiffre d'affaires de la livraison (part d'abonnement + suppléments) */
  revenueCents?: number;
  /** Photo du bouquet prise par le fleuriste avant le départ */
  photoUrl?: string;
  /** Code court imprimé sur la carte (page destinataire /merci) */
  publicCode?: string;
  /** Remerciement envoyé par le destinataire */
  thanks?: { text: string; photoUrl?: string; at: string };
  /** Date prévue à l'origine, si la livraison a été reportée (nouvelle tentative) */
  originalDate?: string;
  /** Tentative de livraison (2 = nouvelle tentative après absence) */
  attempt?: number;
  /** Incident de livraison */
  issue?: string;
  /** Gamme de l'abonnement avant surclassement */
  upgradeFrom?: PlanId;
  extraStemId?: string;
  /** Rémunération du fleuriste (gamme livrée + budget extra tige) */
  payoutCents?: number;
  paymentStatus?: PaymentStatus;
  cancelReason?: string;
  /** Modèle résolu à la création de la commande (fixe ou tiré par la rotation) */
  modelId?: string;
  mode?: SelectionMode;
  deliveryDate: string; // YYYY-MM-DD
  status: OrderStatus;
  floristId: string | null;
  message: string;
  courier: DeliveryMode;
  distanceKm?: number;
  priority?: boolean;
  statusAt: Partial<Record<OrderStatus, string>>;

  // ---- Garantie de livraison (lib/guarantee.ts) ----
  /** L'atelier a confirmé qu'il prend la commande */
  acceptedAt?: string;
  /** Proposition en cours (à un atelier, ou ouverte à plusieurs en urgence) */
  offer?: Offer;
  /** Ateliers qui ont refusé, laissé expirer ou manqué la commande : plus proposée à eux */
  declinedBy?: string[];
  /** Historique des passages de relais */
  handoffs?: Handoff[];
  /** Escalade vers l'équipe Moncleur (aucun atelier disponible, reprise non prête…) */
  alert?: string;
  /** Prime versée à l'atelier qui reprend une commande en urgence */
  bonusCents?: number;
  /** Reprise urgente le jour J (délai de préparation propre) */
  rescue?: boolean;
  dayRemindedAt?: string;
  customerWarnedAt?: string;
  /** Jour J 11 h : alerte sonore + SMS envoyée à l'atelier */
  dayAlertedAt?: string;
  /** CRITICAL_REASSIGN : retirée à 11 h 30 à un atelier inactif et transférée en urgence */
  critical?: boolean;
  /** Livraison annulée faute d'atelier : remboursement à effectuer (Stripe) */
  refundDue?: boolean;
}

export interface Offer {
  floristIds: string[];
  at: string;
  remindAt: string;
  expiresAt: string;
  remindedAt?: string;
  /** true : ouverte à plusieurs ateliers, le premier qui accepte la prend */
  open: boolean;
  round: number;
  bonusCents?: number;
}

export interface Handoff {
  from: string | null;
  to: string | null;
  at: string;
  reason: string;
}

export interface Strike {
  id: string;
  at: string;
  orderId: string;
  /** 1 = sans réponse / fermeture tardive, 2 = bouquets du jour pas prêts à 11 h */
  points: number;
  reason: string;
}

/** Retenue sur les prochains virements d'un atelier (prime de secours après un manquement du jour J). */
export interface Debit {
  id: string;
  orderId: string;
  amountCents: number;
  /** Reste à retenir */
  remainingCents: number;
  reason: string;
  at: string;
}

export interface Closure {
  id: string;
  /** YYYY-MM-DD, inclus */
  from: string;
  to: string;
  reason?: string;
  declaredAt: string;
}

export interface Florist {
  id: string;
  shopName: string;
  ownerName: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
  radiusKm: number;
  deliveryMode: DeliveryMode;
  completedOrders: number;
  saasPlan: "free" | "pro";
  /** Nombre maximum de bouquets par jour */
  dailyCapacity?: number;
  stripeConnected: boolean;
  active: boolean;
  /** Jours de fermeture chaque semaine (0 = dimanche … 6 = samedi) */
  closedWeekdays?: number[];
  /** Mobile pour les alertes SMS (propositions, rappel du matin, urgences) */
  phone?: string;
  /** Fermé les jours fériés (1er mai compris : beaucoup d'ateliers ouvrent pour le muguet) */
  closedOnHolidays?: boolean;
  /** Congés et fermetures exceptionnelles */
  closures?: Closure[];
  /** Accepte automatiquement les propositions (ateliers de confiance) */
  autoAccept?: boolean;
  /** Manquements (fiabilité sur 30 jours) */
  strikes?: Strike[];
  /** Retenues à imputer sur les prochains virements */
  debits?: Debit[];
  /** Suspension levée par l'équipe : les manquements antérieurs ne comptent plus */
  strikesClearedAt?: string;
}

export interface Payout {
  id: string;
  floristId: string;
  orderId: string;
  amountCents: number;
  createdAt: string;
  status: "pending" | "paid";
  /** Retenue imputée (prime de secours) */
  withheldCents?: number;
}

export interface Customer {
  firstName: string;
  email: string;
  since: string;
  /** Code de parrainage personnel (−10 € pour le filleul, 10 € de crédit pour le parrain) */
  referralCode?: string;
  referralCreditCents?: number;
}

/** Rappel gratuit (sans abonnement) : une date à ne pas oublier. */
export interface Reminder {
  id: string;
  name: string;
  /** MM-DD */
  date: string;
  type: "birthday" | "custom";
  label: string;
}
