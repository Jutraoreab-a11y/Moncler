-- Stockage des photos (bouquet avant départ, photo de remerciement du destinataire).
-- À exécuter après schema.sql (schéma storage fourni par Supabase).
insert into storage.buckets (id, name, public) values ('bouquets', 'bouquets', true)
on conflict (id) do nothing;

-- Lecture publique (URL non devinables), écriture uniquement via l'API (service role)
create policy "bouquets public read" on storage.objects for select using (bucket_id = 'bouquets');
