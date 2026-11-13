-- Conferente atribuído pelo supervisor, loja por loja (como a separação).
-- O operador só confere as lojas atribuídas a ele; o supervisor confere qualquer uma.

alter table public.pedidos add column conferente_id uuid references public.perfis (id) on delete set null;
create index pedidos_conferente_idx on public.pedidos (conferente_id);

-- p_atribuicoes: [{ "pedido_id": 1, "conferente_id": "uuid" | null }, ...]
create function public.atribuir_conferentes(p_atribuicoes jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_qtd integer;
begin
  if not public.eh_supervisor() then
    raise exception 'Apenas supervisores podem atribuir a conferência' using errcode = '42501';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_atribuicoes) a(pedido_id bigint, conferente_id uuid)
    where a.conferente_id is not null
      and not exists (select 1 from public.perfis o where o.id = a.conferente_id and o.ativo)
  ) then
    raise exception 'Conferente inválido ou desativado';
  end if;

  update public.pedidos p
     set conferente_id = a.conferente_id
    from jsonb_to_recordset(p_atribuicoes) a(pedido_id bigint, conferente_id uuid)
   where p.id = a.pedido_id;
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

create or replace function public.iniciar_conferencia(p_pedido bigint)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_id         bigint;
  v_remessa    bigint;
  v_status     public.status_remessa;
  v_conferente uuid;
begin
  if not public.usuario_ativo() then
    raise exception 'Usuário sem acesso' using errcode = '42501';
  end if;
  select p.remessa_id, r.status, p.conferente_id into v_remessa, v_status, v_conferente
    from public.pedidos p join public.remessas r on r.id = p.remessa_id
   where p.id = p_pedido;
  if not found then
    raise exception 'Pedido não encontrado';
  end if;
  if v_status = 'pendente' then
    raise exception 'A remessa ainda não foi ativada';
  end if;
  if v_conferente is distinct from auth.uid() and not public.eh_supervisor() then
    raise exception 'Esta loja não foi atribuída a você para conferência' using errcode = '42501';
  end if;

  select id into v_id from public.conferencias where pedido_id = p_pedido and status = 'em_andamento';
  if v_id is not null then
    return v_id;
  end if;

  insert into public.conferencias (remessa_id, pedido_id, iniciada_por)
  values (v_remessa, p_pedido, auth.uid())
  on conflict (pedido_id) where status = 'em_andamento' do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.conferencias where pedido_id = p_pedido and status = 'em_andamento';
  end if;
  return v_id;
end;
$$;

create or replace function public.bipar_conferencia(p_conferencia bigint, p_gtin text, p_qtd integer default 1)
returns table (
  gtin          text,
  produto       text,
  qtd_pedido    integer,
  qtd_separada  integer,
  qtd_conferida integer,
  situacao      text
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_status     public.status_conferencia;
  v_conferente uuid;
  v_gtin       text := regexp_replace(coalesce(p_gtin, ''), '\s', '', 'g');
  v_atual      integer;
begin
  if not public.usuario_ativo() then
    raise exception 'Usuário sem acesso' using errcode = '42501';
  end if;
  if v_gtin !~ '^[0-9A-Za-z-]{1,40}$' then
    raise exception 'Código inválido';
  end if;
  if p_qtd is null or p_qtd = 0 then
    raise exception 'Informe uma quantidade diferente de zero';
  end if;

  select c.status, p.conferente_id into v_status, v_conferente
    from public.conferencias c
    join public.pedidos p on p.id = c.pedido_id
   where c.id = p_conferencia
     for update of c;
  if not found then
    raise exception 'Conferência não encontrada';
  end if;
  if v_status <> 'em_andamento' then
    raise exception 'Esta conferência já foi finalizada';
  end if;
  if v_conferente is distinct from auth.uid() and not public.eh_supervisor() then
    raise exception 'Esta loja não foi atribuída a você para conferência' using errcode = '42501';
  end if;

  select coalesce(sum(cb.qtd), 0) into v_atual
    from public.conferencia_bips cb
   where cb.conferencia_id = p_conferencia and cb.gtin = v_gtin;
  if v_atual + p_qtd < 0 then
    raise exception 'Não dá para tirar mais do que foi conferido (%)', v_atual;
  end if;

  insert into public.conferencia_bips (conferencia_id, gtin, qtd, operador_id)
  values (p_conferencia, v_gtin, p_qtd, auth.uid());

  return query
    select r.* from public.resumo_conferencia(p_conferencia) r where r.gtin = v_gtin;
end;
$$;

create or replace function public.finalizar_conferencia(p_conferencia bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_conferente uuid;
begin
  if not public.usuario_ativo() then
    raise exception 'Usuário sem acesso' using errcode = '42501';
  end if;
  select p.conferente_id into v_conferente
    from public.conferencias c join public.pedidos p on p.id = c.pedido_id
   where c.id = p_conferencia;
  if v_conferente is distinct from auth.uid() and not public.eh_supervisor() then
    raise exception 'Esta loja não foi atribuída a você para conferência' using errcode = '42501';
  end if;
  update public.conferencias
     set status = 'finalizada', finalizada_por = auth.uid(), finalizada_em = now()
   where id = p_conferencia and status = 'em_andamento';
  if not found then
    raise exception 'Conferência não encontrada ou já finalizada';
  end if;
end;
$$;

-- Novas colunas no fim da visão: conferente atribuído e quem separou
create or replace view public.v_conferencia_lojas with (security_invoker = true) as
select
  p.id                              as pedido_id,
  p.remessa_id,
  p.nome                            as pedido_nome,
  l.nome                            as loja_nome,
  l.numero                          as loja_numero,
  coalesce(tp.qtd_pedido, 0)::int   as qtd_pedido,
  coalesce(tp.qtd_separada, 0)::int as qtd_separada,
  c.id                              as conferencia_id,
  c.status,
  c.iniciada_em,
  c.finalizada_em,
  ip.nome                           as iniciada_por_nome,
  fp.nome                           as finalizada_por_nome,
  coalesce(cb.qtd_conferida, 0)::int as qtd_conferida,
  coalesce(cb.bips, 0)::int          as bips,
  dv.divergencias,
  p.conferente_id,
  cf.nome                           as conferente_nome,
  p.operador_id,
  op.nome                           as operador_nome
from public.pedidos p
join public.lojas l on l.id = p.loja_id
left join public.perfis cf on cf.id = p.conferente_id
left join public.perfis op on op.id = p.operador_id
left join lateral (
  select sum(i.qtd_pedido) as qtd_pedido, sum(i.qtd_separada) as qtd_separada
  from public.itens_pedido i where i.pedido_id = p.id
) tp on true
left join lateral (
  select * from public.conferencias c0
  where c0.pedido_id = p.id
  order by c0.iniciada_em desc
  limit 1
) c on true
left join public.perfis ip on ip.id = c.iniciada_por
left join public.perfis fp on fp.id = c.finalizada_por
left join lateral (
  select sum(cb0.qtd) as qtd_conferida, count(*) as bips
  from public.conferencia_bips cb0 where cb0.conferencia_id = c.id
) cb on true
left join lateral (
  select count(*)::int as divergencias
  from (
    select it.gtin, it.qtd_separada from public.itens_pedido it where it.pedido_id = p.id
  ) s
  full join (
    select cb1.gtin, sum(cb1.qtd) as q
    from public.conferencia_bips cb1 where cb1.conferencia_id = c.id
    group by cb1.gtin
  ) x on x.gtin = s.gtin
  where coalesce(s.qtd_separada, 0) <> coalesce(x.q, 0)
) dv on c.id is not null;

revoke execute on function public.atribuir_conferentes(jsonb) from anon, public;
grant execute on function public.atribuir_conferentes(jsonb) to authenticated;
revoke all on public.v_conferencia_lojas from anon;
