-- Carrefour is no longer ingested (ingest/config.yaml): its Stores file never
-- listed a Be'er Sheva branch. Remove the chain so the basket comparison
-- doesn't offer it. Its stores and prices go with it (on delete cascade);
-- shopping trips that named one of its stores keep the trip (store_id set null).
delete from public.chains where id = 'carrefour';
