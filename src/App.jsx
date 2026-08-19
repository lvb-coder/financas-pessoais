-- Se só existir o "Dl*Dlrappi", corrige o nome direto
update merchants set name = 'Rappi'
where name ilike 'dl*dlrappi%'
  and not exists (
    select 1 from merchants m2 where m2.user_id = merchants.user_id and m2.name = 'Rappi'
  );

-- Se os dois existirem, funde o errado no certo
with pares as (
  select errado.id as id_errado, certo.id as id_certo
  from merchants errado
  join merchants certo on certo.user_id = errado.user_id and certo.name = 'Rappi'
  where errado.name ilike 'dl*dlrappi%'
)
update transactions t set merchant_id = p.id_certo
from pares p where t.merchant_id = p.id_errado;

with pares as (
  select errado.id as id_errado, certo.id as id_certo
  from merchants errado
  join merchants certo on certo.user_id = errado.user_id and certo.name = 'Rappi'
  where errado.name ilike 'dl*dlrappi%'
)
update merchant_patterns mp set merchant_id = p.id_certo
from pares p where mp.merchant_id = p.id_errado;

delete from merchants where name ilike 'dl*dlrappi%';
