-- =====================================================================
-- MONCLEUR — Schéma PostgreSQL (Supabase)
-- À exécuter dans l'éditeur SQL Supabase, ou via `supabase db push`.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
create type user_role        as enum ('customer', 'florist', 'admin');
create type plan_id          as enum ('classique', 'signature', 'prestige');
create type event_type       as enum ('monthly', 'birthday', 'valentine', 'mothers_day', 'fathers_day', 'custom');
create type order_status     as enum ('scheduled', 'assigned', 'preparing', 'ready', 'in_delivery', 'delivered', 'cancelled');
create type delivery_mode    as enum ('own', 'uber_direct', 'stuart');
create type sub_status       as enum ('incomplete', 'active', 'paused', 'past_due', 'cancelled');
create type saas_plan        as enum ('free', 'pro');
create type payout_status    as enum ('pending', 'paid', 'failed');
create type selection_mode   as enum ('fixed', 'surprise');
-- Offres B2C : mensuel sans engagement, ou Carnet Occasions Clés (engagement 12 mois)
create type plan_type        as enum ('MONTHLY_RECURRING', 'SPECIAL_EVENTS_CARNET');
-- included : couvert par l'abonnement ; addon : occasion en plus (+30 %) ; merged : fusionnée avec le mensuel
-- carnet_added : date de Carnet ajoutée en cours d'année, prélevée à part au prix abonné
create type billing_kind     as enum ('included', 'addon', 'merged', 'carnet_added');
-- Supplément prélevé à J-3 (included = rien à prélever)
create type payment_status   as enum ('included', 'pending', 'paid', 'failed');

-- ---------------------------------------------------------------------
-- users : profil applicatif lié à auth.users
-- ---------------------------------------------------------------------
create table public.users (
  id                  uuid primary key references auth.users(id) on delete cascade,
  email               text not null unique,
  first_name          text,
  last_name           text,
  phone               text,
  role                user_role not null default 'customer',
  stripe_customer_id  text unique,
  -- Parrainage : −10 € pour le filleul, 10 € de crédit (solde Stripe) pour le parrain
  referral_code       text unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  referred_by         uuid references public.users(id),
  created_at          timestamptz not null default now()
);

-- Création automatique du profil à l'inscription
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, first_name, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'first_name',
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'customer')
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users where id = auth.uid() and role = 'admin');
$$;

-- ---------------------------------------------------------------------
-- flower_catalog_recipes : fiches techniques standardisées
-- ---------------------------------------------------------------------
create table public.flower_catalog_recipes (
  plan_id               plan_id primary key,
  name                  text not null,
  price_cents           int  not null check (price_cents > 0),
  florist_payout_cents  int  not null check (florist_payout_cents > 0),
  flower_budget_cents   int  not null,
  stems                 jsonb not null default '[]',   -- [{label, qty}]
  palette               text[] not null default '{}',
  packaging             text not null default '',
  size                  text not null default '',
  notes                 text not null default '',
  stripe_price_id       text,                          -- price récurrent mensuel B2C
  updated_at            timestamptz not null default now()
);

insert into public.flower_catalog_recipes (plan_id, name, price_cents, florist_payout_cents, flower_budget_cents, stems, palette, packaging, size, notes) values
 ('classique', 'Le Classique', 2900, 1000, 700,
  '[{"label":"Roses de saison","qty":5},{"label":"Eucalyptus cinerea","qty":3},{"label":"Gypsophile","qty":2}]',
  '{#f2a7b8,#ffffff,#9fb8a3}', 'Papier kraft, raphia naturel', 'Ø 25 cm · hauteur 35 cm',
  'Bouquet rond, tiges coupées en biais, sachet nourricier inclus.'),
 ('signature', 'Le Signature', 4900, 2000, 1400,
  '[{"label":"Roses jardin","qty":7},{"label":"Renoncules","qty":5},{"label":"Lisianthus","qty":3},{"label":"Feuillage saisonnier","qty":5}]',
  '{#e23f6b,#f4b73f,#fbe3e8,#7aa37f}', 'Papier de soie poudré, ruban satin Moncleur', 'Ø 35 cm · hauteur 45 cm',
  'Composition déstructurée, mouvement asymétrique. Carte message manuscrite.'),
 ('prestige', 'Le Prestige', 7900, 3500, 2400,
  '[{"label":"Pivoines ou roses David Austin","qty":9},{"label":"Delphiniums","qty":4},{"label":"Hortensia","qty":2},{"label":"Branchages de saison","qty":4},{"label":"Feuillage noble","qty":6}]',
  '{#b82a53,#e9ddf3,#ffffff,#2b1030,#5c8a64}', 'Boîte rigide aubergine + bulle d''eau', 'Ø 50 cm · hauteur 60 cm',
  'Grand format, livré en bulle d''eau. Photo du bouquet envoyée au client avant départ.');

-- ---------------------------------------------------------------------
-- florists : ateliers partenaires (Moncleur Pro)
-- ---------------------------------------------------------------------
create table public.florists (
  id                       uuid primary key default gen_random_uuid(),
  owner_id                 uuid not null unique references public.users(id) on delete cascade,
  shop_name                text not null,
  address                  text not null,
  postal_code              text not null,
  city                     text not null,
  lat                      double precision not null,
  lng                      double precision not null,
  radius_km                numeric(4,1) not null default 6 check (radius_km between 1 and 20),
  -- Bouquets par jour au maximum : au-delà, la commande va à l'atelier suivant
  daily_capacity           int not null default 10 check (daily_capacity between 1 and 200),
  delivery_mode            delivery_mode not null default 'own',
  active                   boolean not null default true,
  -- Freemium
  completed_orders         int not null default 0,
  saas_plan                saas_plan not null default 'free',
  stripe_customer_id       text unique,            -- facturation SaaS
  stripe_subscription_id   text unique,            -- abonnement Pro 29 €
  -- Payouts
  stripe_account_id        text unique,            -- compte Connect Express
  payouts_enabled          boolean not null default false,
  created_at               timestamptz not null default now()
);
create index florists_geo_idx on public.florists (lat, lng) where active;

-- Paywall : gratuit jusqu'à 10 commandes livrées
create or replace function public.florist_is_locked(f public.florists) returns boolean
language sql immutable as $$
  select f.saas_plan = 'free' and f.completed_orders >= 10;
$$;

-- ---------------------------------------------------------------------
-- bouquet_models : plusieurs modèles par gamme
--   mode fixe     → le client choisit un modèle précis par date
--   mode surprise → rotation automatique parmi les modèles actifs de la gamme
-- ---------------------------------------------------------------------
create table public.bouquet_models (
  id          text primary key,
  plan_id     plan_id not null references public.flower_catalog_recipes(plan_id),
  name        text not null,
  tagline     text not null default '',
  stems       jsonb not null default '[]',
  palette     text[] not null default '{}',
  packaging   text not null default '',
  notes       text not null default '',
  active      boolean not null default true,
  sort        int not null default 0,
  updated_at  timestamptz not null default now()
);
create index bouquet_models_plan_idx on public.bouquet_models (plan_id) where active;

insert into public.bouquet_models (id, plan_id, name, tagline, stems, palette, packaging, notes, sort) values
 ('m_rose_poudre','classique','Rose Poudre','Tendre et rond, tout en roses',
  '[{"label":"Roses de saison rose poudré","qty":5},{"label":"Eucalyptus cinerea","qty":3},{"label":"Gypsophile","qty":2}]',
  '{#f2a7b8,#fbe3e8,#9fb8a3}','Papier kraft, raphia naturel','Bouquet rond, roses à demi-ouvertes. Sachet nourricier inclus.',1),
 ('m_prairie','classique','Prairie','Un champ en été, jaune et bleu',
  '[{"label":"Matricaires","qty":5},{"label":"Craspédias","qty":3},{"label":"Bleuets ou scabieuses","qty":3},{"label":"Graminées","qty":3}]',
  '{#f4b73f,#ffffff,#6b8fd6,#9fb8a3}','Papier kraft, raphia naturel','Esprit cueilli, tiges de hauteurs inégales. Aucun feuillage dense.',2),
 ('m_blanc_coton','classique','Blanc Coton','Blanc et vert, d''une grande douceur',
  '[{"label":"Roses blanches","qty":4},{"label":"Lisianthus blanc","qty":2},{"label":"Coton ou gypsophile","qty":2},{"label":"Pittosporum","qty":3}]',
  '{#ffffff,#f3efe6,#7aa37f}','Papier kraft, raphia naturel','Monochrome blanc, feuillage argenté. Idéal pour un remerciement.',3),
 ('m_jardin_ete','signature','Jardin d''Été','Pivoine, jaune soleil et rose vif',
  '[{"label":"Roses jardin","qty":7},{"label":"Renoncules","qty":5},{"label":"Lisianthus","qty":3},{"label":"Feuillage saisonnier","qty":5}]',
  '{#e23f6b,#f4b73f,#fbe3e8,#7aa37f}','Papier de soie poudré, ruban satin Moncleur','Composition déstructurée, mouvement asymétrique. Carte manuscrite.',1),
 ('m_corail','signature','Corail','Pêche, abricot et corail',
  '[{"label":"Roses pêche","qty":6},{"label":"Œillets corail","qty":5},{"label":"Alstroemerias abricot","qty":4},{"label":"Ruscus","qty":5}]',
  '{#f28c6a,#f9c19b,#fde2d4,#8aa57a}','Papier de soie pêche, ruban satin Moncleur','Dégradé du plus soutenu au plus pâle, du centre vers l''extérieur.',2),
 ('m_nuit_violette','signature','Nuit Violette','Lilas, prune et violet profond',
  '[{"label":"Roses mauves","qty":6},{"label":"Statices","qty":4},{"label":"Lisianthus violet","qty":4},{"label":"Eucalyptus populus","qty":5}]',
  '{#8b6bb0,#e9ddf3,#4b2a5c,#9fb8a3}','Papier de soie lilas, ruban satin Moncleur','Contrastes de violets, quelques touches claires pour la lumière.',3),
 ('m_grand_siecle','prestige','Grand Siècle','Généreux, profond, spectaculaire',
  '[{"label":"Pivoines ou roses David Austin","qty":9},{"label":"Delphiniums","qty":4},{"label":"Hortensia","qty":2},{"label":"Branchages de saison","qty":4},{"label":"Feuillage noble","qty":6}]',
  '{#b82a53,#e9ddf3,#ffffff,#2b1030,#5c8a64}','Boîte rigide aubergine + bulle d''eau','Grand format, livré en bulle d''eau. Photo envoyée au client avant départ.',1),
 ('m_pivoine_reine','prestige','Pivoine Reine','Toutes les nuances de rose',
  '[{"label":"Pivoines (ou roses Ohara hors saison)","qty":10},{"label":"Roses spray","qty":6},{"label":"Astilbes","qty":4},{"label":"Feuillage noble","qty":6}]',
  '{#f2a7b8,#e23f6b,#fbe3e8,#ffffff,#7aa37f}','Boîte rigide aubergine + bulle d''eau','Bouquet bombé très serré, aucune tige visible sous les têtes.',2),
 ('m_cocon_hiver','prestige','Cocon d''Hiver','Blanc, bordeaux et branchages',
  '[{"label":"Roses blanches grosses têtes","qty":8},{"label":"Amaryllis ou renoncules bordeaux","qty":4},{"label":"Branches de baies","qty":3},{"label":"Pin ou cèdre","qty":4},{"label":"Eucalyptus","qty":5}]',
  '{#ffffff,#7a1f35,#b82a53,#3f5f45}','Boîte rigide aubergine + bulle d''eau','Esprit forêt en hiver, branchages qui dépassent de 15 cm.',3);

-- ---------------------------------------------------------------------
-- recipients : le carnet de proches
-- ---------------------------------------------------------------------
create table public.recipients (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  first_name     text not null,
  last_name      text not null,
  relation       text,
  address        text not null,
  postal_code    text not null,
  city           text not null,
  lat            double precision,
  lng            double precision,
  phone          text not null,
  access_notes   text,
  created_at     timestamptz not null default now()
);
create index recipients_user_idx on public.recipients (user_id);

-- ---------------------------------------------------------------------
-- subscriptions : un abonnement Stripe B2C par formule souscrite
--   MONTHLY_RECURRING     : 29/49/79 € par mois, 1 bouquet par mois, sans engagement
--   SPECIAL_EVENTS_CARNET : 29/49/79 € par mois, dates clés uniquement, engagement 12 mois,
--                           12 bouquets max par an et 1 max par mois
-- ---------------------------------------------------------------------
create table public.subscriptions (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references public.users(id) on delete cascade,
  plan_type                  plan_type not null default 'MONTHLY_RECURRING',
  plan_id                    plan_id not null references public.flower_catalog_recipes(plan_id),
  commitment_period_months   integer not null default 0 check (commitment_period_months in (0, 12)),
  recipient_id               uuid,                       -- destinataire du bouquet mensuel
  started_at                 date not null default current_date,
  commitment_ends_at         date generated always as ((started_at + make_interval(months => commitment_period_months))::date) stored,
  stripe_subscription_id     text unique,
  status                     sub_status not null default 'incomplete',
  current_period_end         timestamptz,
  cancel_at_period_end       boolean not null default false,
  -- Carnet résilié pendant l'engagement : livraisons et prélèvements jusqu'à commitment_ends_at
  cancel_at_commitment_end   boolean not null default false,
  -- Montant prélevé chaque mois : prix de la gamme (Mensuel) ou mensualité calculée (Carnet)
  price_cents                int not null default 0,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint subscription_commitment check (
    (plan_type = 'MONTHLY_RECURRING' and commitment_period_months = 0) or
    (plan_type = 'SPECIAL_EVENTS_CARNET' and commitment_period_months = 12)
  )
);
create index subscriptions_user_idx on public.subscriptions (user_id);

-- ---------------------------------------------------------------------
-- schedules : dates programmées (mensuel ou événement) par proche
-- ---------------------------------------------------------------------
create table public.schedules (
  id               uuid primary key default gen_random_uuid(),
  subscription_id  uuid not null references public.subscriptions(id) on delete cascade,
  recipient_id     uuid not null references public.recipients(id) on delete cascade,
  plan_id          plan_id not null references public.flower_catalog_recipes(plan_id),
  type             event_type not null,
  day_of_month     smallint check (day_of_month between 1 and 28),
  event_date       text check (event_date ~ '^\d{2}-\d{2}$'),   -- MM-DD
  label            text not null,
  message          text not null default '' check (char_length(message) <= 200),
  active           boolean not null default true,
  stripe_item_id   text,                                          -- subscription item (mensuel)
  selection_mode   selection_mode not null default 'surprise',
  model_id         text references public.bouquet_models(id) on delete set null,
  -- Surclassement permanent de l'occasion (ex. chaque anniversaire en Prestige)
  upgrade_to       plan_id,
  -- Extra tige noble à chaque envoi (bouquets Classique) : renoncules | david_austin | pivoines
  extra_stem       text check (extra_stem in ('renoncules', 'david_austin', 'pivoines')),
  created_at       timestamptz not null default now(),
  constraint schedule_when check (
    (type = 'monthly' and day_of_month is not null) or
    (type in ('birthday','custom') and event_date is not null) or
    (type in ('valentine','mothers_day','fathers_day'))
  ),
  -- Date d'ajout : une date de Carnet ajoutée en cours d'année est prélevée à part
  added_at         date not null default current_date,
  constraint schedule_no_monthly_upgrade check (type <> 'monthly' or upgrade_to is null),
  constraint schedule_model check (selection_mode = 'surprise' or model_id is not null)
);
create index schedules_active_idx on public.schedules (active) where active;
-- Un seul bouquet mensuel par abonnement mensuel
create unique index schedules_one_monthly on public.schedules (subscription_id) where type = 'monthly';

-- Règles de formule : la gamme suit l'abonnement ; le Carnet n'a pas d'envoi mensuel
create or replace function public.check_schedule_plan() returns trigger
language plpgsql as $$
declare s public.subscriptions;
begin
  select * into s from public.subscriptions where id = new.subscription_id;
  -- Mensuel : toutes les dates suivent la gamme de l'abonnement. Carnet : chaque date a sa taille.
  if s.plan_type = 'MONTHLY_RECURRING' and new.plan_id <> s.plan_id then
    raise exception 'La gamme d''une date suit celle de son abonnement (%)', s.plan_id;
  end if;
  if s.plan_type = 'SPECIAL_EVENTS_CARNET' and new.type = 'monthly' then
    raise exception 'Le Carnet Occasions Clés ne contient pas d''envoi mensuel';
  end if;
  if new.upgrade_to is not null and array_position(enum_range(null::plan_id), new.upgrade_to) <= array_position(enum_range(null::plan_id), new.plan_id) then
    raise exception 'Le surclassement doit viser une gamme supérieure';
  end if;
  return new;
end $$;
create trigger schedules_check_plan before insert or update on public.schedules
  for each row execute function public.check_schedule_plan();

-- ---------------------------------------------------------------------
-- occurrence_overrides : réglages d'une livraison précise
--   (surclassement ponctuel, extra tige, garder deux livraisons au lieu de fusionner)
-- ---------------------------------------------------------------------
create table public.occurrence_overrides (
  schedule_id      uuid not null references public.schedules(id) on delete cascade,
  occurrence_date  date not null,
  upgrade_to       plan_id,                -- null = taille de l'abonnement
  clear_upgrade    boolean not null default false,  -- annule le surclassement permanent pour cette date
  extra_stem       text check (extra_stem in ('renoncules', 'david_austin', 'pivoines')),
  clear_extra      boolean not null default false,
  keep_separate    boolean not null default false,
  updated_at       timestamptz not null default now(),
  primary key (schedule_id, occurrence_date)
);

-- ---------------------------------------------------------------------
-- orders : chaque bouquet à produire
-- ---------------------------------------------------------------------
create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  schedule_id      uuid not null references public.schedules(id) on delete cascade,
  recipient_id     uuid not null references public.recipients(id),
  user_id          uuid not null references public.users(id),
  florist_id       uuid references public.florists(id),
  subscription_id  uuid references public.subscriptions(id),
  plan_id          plan_id not null,                             -- gamme livrée (après surclassement)
  upgrade_from     plan_id,                                      -- gamme de l'abonnement si surclassé
  extra_stem       text,
  billing          billing_kind not null default 'included',
  model_id         text references public.bouquet_models(id),   -- résolu à la création (fixe ou rotation)
  selection_mode   selection_mode not null default 'surprise',
  delivery_date    date not null,
  status           order_status not null default 'scheduled',
  message          text not null default '',
  courier          delivery_mode not null default 'own',
  courier_ref      text,                    -- id de course Uber Direct / Stuart
  tracking_url     text,
  distance_km      numeric(5,2),
  priority         boolean not null default false,
  price_cents      int not null default 0,  -- supplément prélevé à J-3 (occasion +30 %, surclassement, extra)
  lines            jsonb not null default '[]',              -- détail du supplément [{label, amountCents}]
  payout_cents     int not null,                             -- gamme livrée + budget extra tige
  payment_status   payment_status not null default 'included',
  stripe_invoice_id text,
  cancel_reason    text,
  revenue_cents    int not null default 0,                   -- chiffre d'affaires de la livraison
  public_code      text unique,                              -- code de la carte → page /merci
  photo_url        text,                                     -- photo prise par l'atelier avant départ
  thanks           jsonb,                                    -- {text, photoUrl, at} envoyé par le destinataire
  attempt          smallint not null default 1,
  original_date    date,                                     -- date initiale si nouvelle tentative
  issue            text,
  status_at        jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  unique (schedule_id, delivery_date)       -- idempotence du cron
);
create index orders_florist_day_idx on public.orders (florist_id, delivery_date);
create index orders_user_idx on public.orders (user_id, delivery_date desc);
create index orders_rotation_idx on public.orders (recipient_id, model_id, delivery_date desc);
create index orders_status_idx on public.orders (status) where status in ('scheduled','assigned');
create index orders_payment_idx on public.orders (delivery_date) where payment_status = 'pending';

-- Carnet : 1 bouquet max par mois civil et 12 par année d'abonnement (filet de sécurité)
create or replace function public.check_carnet_quota() returns trigger
language plpgsql as $$
declare
  s public.subscriptions;
  win_start date;
  n int;
  m date := date_trunc('month', coalesce(new.original_date, new.delivery_date));
begin
  if new.subscription_id is null or new.status = 'cancelled' then return new; end if;
  select * into s from public.subscriptions where id = new.subscription_id;
  -- Mensuel et Carnet : 1 bouquet max par mois (une occasion remplace le bouquet du mois).
  -- Le mois de référence est celui de la date d'origine (un report au lendemain ne compte pas double).
  if exists (
    select 1 from public.orders o
     where o.subscription_id = new.subscription_id and o.id <> new.id and o.status <> 'cancelled'
       and date_trunc('month', coalesce(o.original_date, o.delivery_date)) = m
  ) then
    raise exception 'Un seul bouquet par mois et par abonnement';
  end if;
  if s.plan_type <> 'SPECIAL_EVENTS_CARNET' then return new; end if;
  win_start := (s.started_at + make_interval(years => extract(year from age(coalesce(new.original_date, new.delivery_date), s.started_at))::int))::date;
  select count(*) into n from public.orders o
   where o.subscription_id = new.subscription_id and o.id <> new.id and o.status <> 'cancelled'
     and coalesce(o.original_date, o.delivery_date) >= win_start and coalesce(o.original_date, o.delivery_date) < (win_start + interval '1 year');
  if n >= 12 then
    raise exception 'Carnet : 12 bouquets par an atteints';
  end if;
  return new;
end $$;
create trigger orders_carnet_quota before insert or update of status, delivery_date, original_date on public.orders
  for each row execute function public.check_carnet_quota();

-- Horodatage automatique de chaque changement de statut
create or replace function public.stamp_order_status() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.status_at := coalesce(new.status_at, '{}') || jsonb_build_object(new.status::text, now());
  end if;
  return new;
end $$;
create trigger orders_stamp before insert or update of status on public.orders
  for each row execute function public.stamp_order_status();

-- Compteur freemium : +1 à chaque livraison
create or replace function public.count_delivered() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' and new.florist_id is not null then
    update public.florists set completed_orders = completed_orders + 1 where id = new.florist_id;
  end if;
  return new;
end $$;
create trigger orders_count_delivered after update of status on public.orders
  for each row execute function public.count_delivered();

-- ---------------------------------------------------------------------
-- payouts : reversements Stripe Connect
-- ---------------------------------------------------------------------
create table public.payouts (
  id                   uuid primary key default gen_random_uuid(),
  florist_id           uuid not null references public.florists(id),
  order_id             uuid not null unique references public.orders(id),
  amount_cents         int not null,                    -- net viré (après retenues)
  withheld_cents       int not null default 0,          -- retenue imputée (prime de secours)
  stripe_transfer_id   text unique,
  status               payout_status not null default 'pending',
  created_at           timestamptz not null default now()
);
create index payouts_florist_idx on public.payouts (florist_id, created_at desc);

-- ---------------------------------------------------------------------
-- checkout_drafts : données du tunnel en attente de paiement
-- (les metadata Stripe sont limitées à 500 caractères)
-- ---------------------------------------------------------------------
create table public.reminders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  name        text not null,
  event_date  text not null check (event_date ~ '^\d{2}-\d{2}$'),  -- MM-DD
  type        text not null default 'birthday' check (type in ('birthday', 'custom')),
  label       text not null,
  last_notified_at date,
  created_at  timestamptz not null default now(),
  unique (user_id, name, event_date)
);
alter table public.reminders enable row level security;
create policy "reminders own" on public.reminders for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Liste d'attente des zones non couvertes (écriture via l'API, service role)
create table public.waitlist (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  postal_code  text not null,
  created_at   timestamptz not null default now(),
  unique (email, postal_code)
);
alter table public.waitlist enable row level security;
create policy "waitlist admin" on public.waitlist for select using (public.is_admin());

-- Crédits de parrainage accordés (idempotence)
create table public.referral_rewards (
  referrer_id  uuid not null references public.users(id),
  referee_id   uuid not null references public.users(id),
  amount_cents int not null default 1000,
  created_at   timestamptz not null default now(),
  primary key (referee_id)
);
alter table public.referral_rewards enable row level security;
create policy "referral own" on public.referral_rewards for select using (referrer_id = auth.uid() or public.is_admin());

create table public.checkout_drafts (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  payload     jsonb not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

-- =====================================================================
-- Garantie de livraison (miroir de lib/guarantee.ts, exécuté par /api/cron/guarantee)
--   J-7      proposition à l'atelier le mieux placé, 48 h pour accepter
--   +24 h    rappel ; +48 h sans réponse : 1 point, atelier suivant
--   J-2 18 h date limite : ouverte aux 3 ateliers les plus proches (premier qui accepte)
--   Jour J   9 h 30 rappel ; 11 h 00 pas « en préparation » : alerte sonore + SMS ;
--            11 h 30 toujours rien : CRITICAL_REASSIGN, 2 points, atelier de secours avec prime +20 %
--            retenue sur les prochains virements de l'atelier défaillant (florist_debits)
--   Jour J   15 h sans atelier : report au lendemain ; 3e essai : annulation remboursée
--   3 points sur 30 jours : plus de propositions jusqu'à revue de l'équipe
-- =====================================================================
alter table public.florists
  add column closed_weekdays     smallint[] not null default '{}',   -- 0 = dimanche … 6 = samedi
  add column closed_on_holidays  boolean    not null default false,
  add column auto_accept         boolean    not null default false,
  add column phone               text,                               -- alertes SMS
  add column strikes_cleared_at  timestamptz;                        -- levée de suspension par l'équipe

alter table public.orders
  add column accepted_at         timestamptz,                         -- l'atelier a confirmé
  add column offer               jsonb,                               -- {floristIds, at, remindAt, expiresAt, open, round, bonusCents}
  add column offered_to          uuid[]     not null default '{}',    -- copie indexée de offer.floristIds (RLS)
  add column declined_by         uuid[]     not null default '{}',    -- refus, silence, manquement : plus sollicités
  add column handoffs            jsonb      not null default '[]',    -- historique des relais
  add column alert               text,                                -- escalade vers l'équipe
  add column bonus_cents         int        not null default 0,       -- prime de reprise urgente
  add column rescue              boolean    not null default false,
  add column day_reminded_at     timestamptz,
  add column customer_warned_at  timestamptz,
  add column refund_due          boolean    not null default false,
  add column day_alerted_at      timestamptz,                         -- alerte de 11 h envoyée
  add column critical            boolean    not null default false;   -- CRITICAL_REASSIGN (11 h 30)
create index orders_offered_idx on public.orders using gin (offered_to) where accepted_at is null;
create index orders_unconfirmed_idx on public.orders (delivery_date) where accepted_at is null and status in ('scheduled', 'assigned');

-- Une commande ne se prépare qu'après acceptation (filet de sécurité, l'API le vérifie aussi)
create or replace function public.check_order_accepted() returns trigger
language plpgsql as $$
begin
  if new.status in ('preparing', 'ready', 'in_delivery') and new.accepted_at is null then
    raise exception 'Commande % non confirmée par un atelier', new.id using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger orders_require_acceptance before update of status on public.orders
  for each row execute function public.check_order_accepted();

create table public.florist_closures (
  id           uuid primary key default gen_random_uuid(),
  florist_id   uuid not null references public.florists(id) on delete cascade,
  starts_on    date not null,
  ends_on      date not null,
  reason       text,
  declared_at  timestamptz not null default now(),
  check (ends_on >= starts_on and ends_on - starts_on <= 92)
);
create index florist_closures_idx on public.florist_closures (florist_id, ends_on);

create table public.florist_strikes (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,                 -- idempotence : un manquement par commande / par jour
  florist_id  uuid not null references public.florists(id) on delete cascade,
  order_id    uuid references public.orders(id) on delete set null,
  points      smallint not null check (points between 1 and 3),
  reason      text not null,
  created_at  timestamptz not null default now()
);
create index florist_strikes_idx on public.florist_strikes (florist_id, created_at desc);

-- Retenues sur les prochains virements : prime de secours (+20 %) après une réattribution critique
create table public.florist_debits (
  id               uuid primary key default gen_random_uuid(),
  key              text not null unique,               -- une retenue par commande
  florist_id       uuid not null references public.florists(id) on delete cascade,
  order_id         uuid references public.orders(id) on delete set null,
  amount_cents     int not null check (amount_cents > 0),
  remaining_cents  int not null check (remaining_cents >= 0),
  reason           text not null,
  created_at       timestamptz not null default now()
);
create index florist_debits_open_idx on public.florist_debits (florist_id, created_at) where remaining_cents > 0;

create table public.guarantee_events (
  id           bigint generated always as identity primary key,
  order_id     uuid not null references public.orders(id) on delete cascade,
  kind         text not null,
  audience     text not null check (audience in ('florist', 'ops', 'customer')),
  florist_ids  uuid[] not null default '{}',
  text         text not null,
  notified_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index guarantee_events_idx on public.guarantee_events (created_at desc);

-- ---------------------------------------------------------------------
-- Matching géographique : fleuriste actif le plus proche
-- (Haversine en SQL pur ; passer à PostGIS au-delà de ~5 000 ateliers)
-- ---------------------------------------------------------------------
create or replace function public.nearest_florist(p_lat double precision, p_lng double precision, p_day date default current_date)
returns table (florist_id uuid, distance_km double precision, delivery_mode delivery_mode)
language sql stable as $$
  with d as (
    select f.id, f.delivery_mode, f.radius_km, f.daily_capacity,
      2 * 6371 * asin(sqrt(
        power(sin(radians(p_lat - f.lat) / 2), 2) +
        cos(radians(f.lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - f.lng) / 2), 2)
      )) as km,
      (select count(*) from public.orders o where o.florist_id = f.id and o.delivery_date = p_day and o.status <> 'cancelled') as load
    from public.florists f
    where f.active and not public.florist_is_locked(f)
      and not (extract(dow from p_day)::smallint = any(f.closed_weekdays))
      and not exists (select 1 from public.florist_closures c where c.florist_id = f.id and p_day between c.starts_on and c.ends_on)
      and coalesce((select sum(s.points) from public.florist_strikes s
                     where s.florist_id = f.id and s.created_at > greatest(now() - interval '30 days', coalesce(f.strikes_cleared_at, '-infinity'))), 0) < 3
  ),
  peak as (
    -- Saint-Valentin, fête des mères (dernier dimanche de mai), fête des pères (3e dimanche de juin)
    select (to_char(p_day, 'MM-DD') = '02-14'
         or (extract(month from p_day) = 5 and extract(dow from p_day) = 0 and extract(month from p_day + 7) = 6)
         or (extract(month from p_day) = 6 and extract(dow from p_day) = 0 and extract(day from p_day) between 15 and 21)) as is_peak
  )
  select id, km, d.delivery_mode from d, peak
  where km <= radius_km and load < daily_capacity            -- capacité du jour
  order by case when peak.is_peak and d.delivery_mode = 'own' then 0 else 1 end,  -- pic : ateliers qui livrent eux-mêmes
           round(km::numeric * 2) / 2, load, km               -- à 500 m près, on lisse la charge
  limit 1;
$$;

-- ---------------------------------------------------------------------
-- Choix du modèle (miroir de lib/models.ts > pickModel)
--   fixe     : le modèle choisi s'il est encore actif
--   surprise : le modèle actif de la gamme reçu il y a le plus longtemps par
--              ce destinataire (jamais reçu = prioritaire)
-- ---------------------------------------------------------------------
create or replace function public.pick_model(p_plan plan_id, p_mode selection_mode, p_model text, p_recipient uuid)
returns text language sql stable as $$
  select coalesce(
    (select m.id from public.bouquet_models m
      where p_mode = 'fixed' and m.id = p_model and m.plan_id = p_plan and m.active),
    (select m.id from public.bouquet_models m
       left join lateral (
         select max(o.delivery_date) as last_seen from public.orders o
          where o.recipient_id = p_recipient and o.model_id = m.id and o.status <> 'cancelled'
       ) h on true
      where m.plan_id = p_plan and m.active
      order by h.last_seen nulls first, m.sort
      limit 1)
  );
$$;

-- Si le client change de mode ou de modèle, les commandes non commencées suivent
create or replace function public.resync_order_models() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.selection_mode is distinct from old.selection_mode
     or new.model_id is distinct from old.model_id then
    update public.orders o
       set selection_mode = new.selection_mode,
           model_id = public.pick_model(o.plan_id, new.selection_mode, new.model_id, o.recipient_id)
     where o.schedule_id = new.id and o.status in ('scheduled', 'assigned');
  end if;
  return new;
end $$;
create trigger schedules_resync_models after update on public.schedules
  for each row execute function public.resync_order_models();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.users                   enable row level security;
alter table public.recipients              enable row level security;
alter table public.subscriptions           enable row level security;
alter table public.schedules               enable row level security;
alter table public.florists                enable row level security;
alter table public.orders                  enable row level security;
alter table public.payouts                 enable row level security;
alter table public.flower_catalog_recipes  enable row level security;
alter table public.checkout_drafts         enable row level security; -- service role uniquement
alter table public.occurrence_overrides    enable row level security;
alter table public.bouquet_models          enable row level security;

-- users
create policy "self read"   on public.users for select using (id = auth.uid() or public.is_admin());
create policy "self update" on public.users for update using (id = auth.uid());
-- Un utilisateur ne peut pas s'auto-promouvoir
create or replace function public.guard_user_role() returns trigger
language plpgsql as $$
begin
  if auth.role() = 'authenticated' and not public.is_admin() then
    new.role := old.role;
    new.stripe_customer_id := old.stripe_customer_id;
  end if;
  return new;
end $$;
create trigger users_guard before update on public.users
  for each row execute function public.guard_user_role();

-- catalogue : lecture publique, écriture admin
create policy "catalog read"  on public.flower_catalog_recipes for select using (true);
create policy "catalog admin" on public.flower_catalog_recipes for all using (public.is_admin()) with check (public.is_admin());
create policy "models read"   on public.bouquet_models for select using (true);
create policy "models admin"  on public.bouquet_models for all using (public.is_admin()) with check (public.is_admin());

-- recipients : le client gère son carnet ; le fleuriste voit les destinataires de ses commandes
create policy "recipients own" on public.recipients for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "recipients florist" on public.recipients for select using (
  exists (select 1 from public.orders o join public.florists f on f.id = o.florist_id
          where o.recipient_id = recipients.id and f.owner_id = auth.uid()
            and not public.florist_is_locked(f))
);
create policy "recipients admin" on public.recipients for select using (public.is_admin());

-- subscriptions : lecture client (écriture via webhook / service role)
create policy "subs own" on public.subscriptions for select using (user_id = auth.uid() or public.is_admin());

-- schedules
create policy "schedules own" on public.schedules for all using (
  exists (select 1 from public.subscriptions s where s.id = schedules.subscription_id and s.user_id = auth.uid())
) with check (
  exists (select 1 from public.subscriptions s where s.id = schedules.subscription_id and s.user_id = auth.uid())
);
create policy "schedules admin" on public.schedules for select using (public.is_admin());

-- occurrence_overrides : l'abonné règle ses propres livraisons
create policy "overrides own" on public.occurrence_overrides for all using (
  exists (select 1 from public.schedules sc join public.subscriptions s on s.id = sc.subscription_id
           where sc.id = occurrence_overrides.schedule_id and s.user_id = auth.uid())
) with check (
  exists (select 1 from public.schedules sc join public.subscriptions s on s.id = sc.subscription_id
           where sc.id = occurrence_overrides.schedule_id and s.user_id = auth.uid())
);
create policy "overrides admin" on public.occurrence_overrides for select using (public.is_admin());

-- florists
create policy "florist self" on public.florists for select using (owner_id = auth.uid() or public.is_admin());
create policy "florist update" on public.florists for update using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
create policy "florist admin" on public.florists for all using (public.is_admin());
-- Empêche le fleuriste de modifier lui-même son plan ou son compteur
create or replace function public.guard_florist_columns() returns trigger
language plpgsql as $$
begin
  if auth.role() = 'authenticated' and not public.is_admin() then
    new.saas_plan := old.saas_plan;
    new.completed_orders := old.completed_orders;
    new.stripe_account_id := old.stripe_account_id;
    new.stripe_subscription_id := old.stripe_subscription_id;
    new.payouts_enabled := old.payouts_enabled;
    new.strikes_cleared_at := old.strikes_cleared_at;
  end if;
  return new;
end $$;
create trigger florists_guard before update on public.florists
  for each row execute function public.guard_florist_columns();

-- orders
create policy "orders customer" on public.orders for select using (user_id = auth.uid());
create policy "orders florist read" on public.orders for select using (
  exists (select 1 from public.florists f where f.id = orders.florist_id and f.owner_id = auth.uid())
);
create policy "orders admin" on public.orders for all using (public.is_admin());
-- Les changements de statut fleuriste passent par /api/orders/[id]/status (service role)

-- payouts
create policy "payouts florist" on public.payouts for select using (
  exists (select 1 from public.florists f where f.id = payouts.florist_id and f.owner_id = auth.uid()) or public.is_admin()
);

-- Garantie de livraison : règles d'accès
alter table public.florist_closures enable row level security;
alter table public.florist_strikes  enable row level security;
alter table public.guarantee_events enable row level security;
alter table public.florist_debits   enable row level security;
create policy "debits read" on public.florist_debits for select using (
  exists (select 1 from public.florists f where f.id = florist_debits.florist_id and f.owner_id = auth.uid()) or public.is_admin()
);

create policy "closures own" on public.florist_closures for all using (
  exists (select 1 from public.florists f where f.id = florist_closures.florist_id and f.owner_id = auth.uid()) or public.is_admin()
) with check (
  exists (select 1 from public.florists f where f.id = florist_closures.florist_id and f.owner_id = auth.uid()) or public.is_admin()
);
-- Les manquements s'écrivent par le cron (service role) ; l'atelier les lit
create policy "strikes read" on public.florist_strikes for select using (
  exists (select 1 from public.florists f where f.id = florist_strikes.florist_id and f.owner_id = auth.uid()) or public.is_admin()
);
create policy "events read" on public.guarantee_events for select using (
  public.is_admin()
  or (audience = 'florist' and exists (select 1 from public.florists f where f.owner_id = auth.uid() and f.id = any(guarantee_events.florist_ids)))
  or (audience = 'customer' and exists (select 1 from public.orders o where o.id = guarantee_events.order_id and o.user_id = auth.uid()))
);

-- L'atelier voit les propositions qui lui sont faites (avant acceptation), et le destinataire associé
create policy "orders florist offers" on public.orders for select using (
  accepted_at is null and exists (select 1 from public.florists f where f.owner_id = auth.uid() and f.id = any(orders.offered_to))
);
create policy "recipients florist offers" on public.recipients for select using (
  exists (select 1 from public.orders o join public.florists f on f.id = any(o.offered_to)
          where o.recipient_id = recipients.id and o.accepted_at is null and f.owner_id = auth.uid())
);


-- ---------------------------------------------------------------------
-- Vue métriques admin
-- ---------------------------------------------------------------------
create or replace view public.admin_metrics with (security_invoker = true) as
select
  (select coalesce(sum(r.price_cents), 0)
     from public.subscriptions s join public.flower_catalog_recipes r on r.plan_id = s.plan_id
    where s.status = 'active' and s.plan_type = 'MONTHLY_RECURRING')     as mrr_monthly_cents,
  (select coalesce(sum(r.price_cents), 0)
     from public.subscriptions s join public.flower_catalog_recipes r on r.plan_id = s.plan_id
    where s.status = 'active' and s.plan_type = 'SPECIAL_EVENTS_CARNET') as mrr_carnet_cents,
  (select coalesce(sum(r.price_cents * greatest(0, (extract(year from age(s.commitment_ends_at, current_date)) * 12 + extract(month from age(s.commitment_ends_at, current_date)))::int)), 0)
     from public.subscriptions s join public.flower_catalog_recipes r on r.plan_id = s.plan_id
    where s.status = 'active' and s.plan_type = 'SPECIAL_EVENTS_CARNET') as carnet_committed_cents,
  (select coalesce(sum(price_cents), 0) from public.orders
    where payment_status = 'paid' and delivery_date >= current_date - 30)  as extras_30d_cents,
  (select count(*) * 2900 from public.florists where saas_plan = 'pro') as mrr_b2b_cents,
  (select count(*) from public.orders where status = 'delivered')   as bouquets_delivered,
  (select count(distinct user_id) from public.subscriptions where status = 'active') as active_customers;

create or replace view public.revenue_by_florist with (security_invoker = true) as
select f.id, f.shop_name, f.saas_plan, f.completed_orders,
       coalesce(sum(p.amount_cents), 0) as revenue_cents
from public.florists f left join public.payouts p on p.florist_id = f.id
group by f.id;

-- Livraisons par atelier et par mois (Moncleur Pro offert sous 5 livraisons)
create or replace view public.florist_monthly_deliveries with (security_invoker = true) as
select florist_id, date_trunc('month', delivery_date)::date as month, count(*) as delivered
from public.orders where status = 'delivered' and florist_id is not null
group by 1, 2;

-- Temps réel : le client suit sa commande, le fleuriste reçoit les nouvelles
alter publication supabase_realtime add table public.orders;
