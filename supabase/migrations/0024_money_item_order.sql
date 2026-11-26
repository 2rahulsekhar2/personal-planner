-- An item's place in its list on the Money side, set by moving it there by hand.
-- Null until it has been moved: such items keep the order they always had, after the placed ones.
-- Until this has been run the lists cannot be rearranged.
alter table public.money_items add column if not exists sort_order integer;
