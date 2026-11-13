-- =============================================================================
-- Conferência física (bipar de novo, loja por loja, e confrontar com a
-- separação) e estatísticas da separação.
-- =============================================================================

create type public.status_conferencia as enum ('em_andamento', 'finalizada');

-- Uma conferência por loja (pedido). Pode haver recontagem: a mais recente vale.
create table public.conferencias (
  id             bigint generated always as identity primary key,
  remessa_id     bigint not null references public.remessas (id) on delete cascade,
  pedido_id      bigint not null references public.pedidos (id) on delete cascade,
  status         public.status_conferencia not null default 'em_andamento',
  iniciada_por   uuid references public.perfis (id) on delete set null,
  iniciada_em    timestamptz not null default now(),
  finalizada_por uuid references public.perfis (id) on delete set null,
  finalizada_em  timestamptz
);
-- No máximo uma conferência aberta por loja
create unique index conferencias_uma_aberta on public.conferencias (pedido_id) where status = 'em_andamento';
create index conferencias_remessa_idx on public.conferencias (remessa_id, pedido_id, iniciada_em desc);

-- Cada bip da conferência (GTIN que não é do pedido também entra: é divergência)
create table public.conferencia_bips (
  id             bigint generated always as identity primary key,
  conferencia_id bigint not null references public.conferencias (id) on delete cascade,
  gtin           text not null check (gtin ~ '^[0-9A-Za-z-]{1,40}$'),
  qtd            integer not null check (qtd <> 0),
  operador_id    uuid references public.perfis (id) on delete set null,
  criado_em      timestamptz not null default now()
);
create index conferencia_bips_conf_idx on public.conferencia_bips (conferencia_id, gtin);
create index conferencia_bips_operador_idx on public.conferencia_bips (operador_id, criado_em desc);

alter table public.conferencias     enable row level security;
alter table public.conferencia_bips enable row level security;
create policy "ativos leem conferencias"     on public.conferencias     for select to authenticated using ((select public.usuario_ativo()));
create policy "ativos leem conferencia_bips" on public.conferencia_bips for select to authenticated using ((select public.usuario_ativo()));
revoke all on public.conferencias, public.conferencia_bips from anon;

-- ---------------------------------------------------------------------------
-- Confronto: pedido x separado x conferido, por GTIN
-- situacao: ok | falta (conferiu menos que o separado) | sobra (mais) |
--           fora_do_pedido (GTIN que não é desta loja)
-- ---------------------------------------------------------------------------
create function public.resumo_conferencia(p_conferencia bigint)
returns table (
  gtin          text,
  produto       text,
  qtd_pedido    integer,
  qtd_separada  integer,
  qtd_conferida integer,
  situacao      text
)
language sql stable security invoker set search_path = ''
as $$
  with conf as (
    select pedido_id from public.conferencias where id = p_conferencia
  ),
  c as (
    select cb.gtin, sum(cb.qtd)::int as q
    from public.conferencia_bips cb
    where cb.conferencia_id = p_conferencia
    group by cb.gtin
  ),
  i as (
    select it.gtin, it.produto, it.qtd_pedido, it.qtd_separada
    from public.itens_pedido it
    where it.pedido_id = (select pedido_id from conf)
  )
  select coalesce(i.gtin, c.gtin),
         coalesce(i.produto, (select max(x.produto) from public.itens_pedido x where x.gtin = c.gtin), 'Produto fora do pedido'),
         coalesce(i.qtd_pedido, 0),
         coalesce(i.qtd_separada, 0),
         coalesce(c.q, 0),
         case
           when i.gtin is null then 'fora_do_pedido'
           when coalesce(c.q, 0) = i.qtd_separada then 'ok'
           when coalesce(c.q, 0) < i.qtd_separada then 'falta'
           else 'sobra'
         end
  from i
  full join c on c.gtin = i.gtin
  where i.gtin is not null or c.q <> 0
  order by
    case
      when i.gtin is null then 0
      when coalesce(c.q, 0) = i.qtd_separada then 2
      else 1
    end,
    coalesce(i.produto, c.gtin);
$$;

-- Abre a conferência da loja (ou retoma a que já está aberta)
create function public.iniciar_conferencia(p_pedido bigint)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_id      bigint;
  v_remessa bigint;
  v_status  public.status_remessa;
begin
  if not public.usuario_ativo() then
    raise exception 'Usuário sem acesso' using errcode = '42501';
  end if;
  select p.remessa_id, r.status into v_remessa, v_status
    from public.pedidos p join public.remessas r on r.id = p.remessa_id
   where p.id = p_pedido;
  if not found then
    raise exception 'Pedido não encontrado';
  end if;
  if v_status = 'pendente' then
    raise exception 'A remessa ainda não foi ativada';
  end if;

  select id into v_id from public.conferencias where pedido_id = p_pedido and status = 'em_andamento';
  if v_id is not null then
    return v_id;
  end if;

  insert into public.conferencias (remessa_id, pedido_id, iniciada_por)
  values (v_remessa, p_pedido, auth.uid())
  on conflict (pedido_id) where status = 'em_andamento' do nothing
  returning id into v_id;

  if v_id is null then -- outra pessoa abriu no mesmo instante
    select id into v_id from public.conferencias where pedido_id = p_pedido and status = 'em_andamento';
  end if;
  return v_id;
end;
$$;

-- Registra um bip da conferência e devolve como ficou esse produto
create function public.bipar_conferencia(p_conferencia bigint, p_gtin text, p_qtd integer default 1)
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
  v_status public.status_conferencia;
  v_gtin   text := regexp_replace(coalesce(p_gtin, ''), '\s', '', 'g');
  v_atual  integer;
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

  select c.status into v_status from public.conferencias c where c.id = p_conferencia for update;
  if not found then
    raise exception 'Conferência não encontrada';
  end if;
  if v_status <> 'em_andamento' then
    raise exception 'Esta conferência já foi finalizada';
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

create function public.finalizar_conferencia(p_conferencia bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.usuario_ativo() then
    raise exception 'Usuário sem acesso' using errcode = '42501';
  end if;
  update public.conferencias
     set status = 'finalizada', finalizada_por = auth.uid(), finalizada_em = now()
   where id = p_conferencia and status = 'em_andamento';
  if not found then
    raise exception 'Conferência não encontrada ou já finalizada';
  end if;
end;
$$;

-- Situação da conferência de cada loja da remessa (a conferência mais recente)
create view public.v_conferencia_lojas with (security_invoker = true) as
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
  dv.divergencias
from public.pedidos p
join public.lojas l on l.id = p.loja_id
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

-- ---------------------------------------------------------------------------
-- Estatísticas da separação
-- Tempo ativo: soma dos intervalos entre bips do mesmo operador de até
-- 5 minutos; intervalos maiores contam como pausa (almoço, troca de caixa...).
-- ---------------------------------------------------------------------------
create function public.estatisticas_separacao(
  p_remessa bigint default null,
  p_inicio  timestamptz default null,
  p_fim     timestamptz default null
)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with b as (
    select bp.*,
           lag(bp.criado_em) over (partition by bp.operador_id order by bp.criado_em, bp.id) as anterior
    from public.bips bp
    where (p_remessa is null or bp.remessa_id = p_remessa)
      and (p_inicio is null or bp.criado_em >= p_inicio)
      and (p_fim is null or bp.criado_em < p_fim)
  ),
  g as (
    select b.*,
           case when b.anterior is not null and b.criado_em - b.anterior <= interval '5 minutes'
                then extract(epoch from b.criado_em - b.anterior) else 0 end as ativo_seg,
           case when b.anterior is not null and b.criado_em - b.anterior <= interval '5 minutes'
                then 1 else 0 end as intervalo
    from b
  ),
  ops as (
    select g.operador_id,
           coalesce(o.nome, '(removido)')                                   as nome,
           count(*)::int                                                    as bips,
           coalesce(sum(g.qtd) filter (where g.tipo = 'entrada'), 0)::int   as unidades,
           count(*) filter (where g.tipo = 'ajuste')::int                   as ajustes,
           min(g.criado_em)                                                 as primeiro,
           max(g.criado_em)                                                 as ultimo,
           round(sum(g.ativo_seg))::int                                     as ativo_seg,
           sum(g.intervalo)::int                                            as intervalos,
           count(distinct g.pedido_id)::int                                 as lojas,
           count(distinct g.item_id)::int                                   as itens
    from g
    left join public.perfis o on o.id = g.operador_id
    group by g.operador_id, o.nome
  ),
  horas as (
    select to_char(date_trunc('hour', g.criado_em at time zone 'America/Sao_Paulo'), 'YYYY-MM-DD"T"HH24:00') as hora,
           coalesce(sum(g.qtd) filter (where g.tipo = 'entrada'), 0)::int as unidades,
           count(*)::int                                                  as bips,
           count(distinct g.operador_id)::int                             as operadores
    from g
    group by 1
  ),
  lojas as (
    select g.pedido_id,
           l.nome,
           l.numero,
           min(g.criado_em) as primeiro,
           max(g.criado_em) as ultimo,
           coalesce(sum(g.qtd) filter (where g.tipo = 'entrada'), 0)::int as unidades,
           (select coalesce(sum(i.qtd_pedido), 0) from public.itens_pedido i where i.pedido_id = g.pedido_id)::int   as qtd_pedido,
           (select coalesce(sum(i.qtd_separada), 0) from public.itens_pedido i where i.pedido_id = g.pedido_id)::int as qtd_separada
    from g
    join public.lojas l on l.id = g.loja_id
    group by g.pedido_id, l.nome, l.numero
  ),
  conf as (
    select c.*
    from public.conferencias c
    where (p_remessa is null or c.remessa_id = p_remessa)
      and (p_inicio is null or c.iniciada_em >= p_inicio)
      and (p_fim is null or c.iniciada_em < p_fim)
  )
  select jsonb_build_object(
    'resumo', (
      select jsonb_build_object(
        'bips',       count(*),
        'unidades',   coalesce(sum(g.qtd) filter (where g.tipo = 'entrada'), 0),
        'ajustes',    count(*) filter (where g.tipo = 'ajuste'),
        'operadores', count(distinct g.operador_id),
        'itens',      count(distinct g.item_id),
        'lojas',      count(distinct g.pedido_id),
        'primeiro',   min(g.criado_em),
        'ultimo',     max(g.criado_em),
        'ativo_seg',  round(coalesce(sum(g.ativo_seg), 0)),
        'intervalos', coalesce(sum(g.intervalo), 0)
      ) from g
    ),
    'operadores', coalesce((select jsonb_agg(to_jsonb(ops) order by ops.unidades desc) from ops), '[]'::jsonb),
    'horas',      coalesce((select jsonb_agg(to_jsonb(horas) order by horas.hora) from horas), '[]'::jsonb),
    'lojas',      coalesce((select jsonb_agg(to_jsonb(lojas) order by lojas.numero nulls last, lojas.nome) from lojas), '[]'::jsonb),
    'conferencia', (
      select jsonb_build_object(
        'conferencias', count(*),
        'finalizadas',  count(*) filter (where conf.status = 'finalizada'),
        'tempo_medio_seg', round(avg(extract(epoch from conf.finalizada_em - conf.iniciada_em)) filter (where conf.status = 'finalizada'))
      ) from conf
    )
  );
$$;

-- Permissões das funções novas: só quem está logado
revoke execute on function public.resumo_conferencia(bigint)                          from anon, public;
revoke execute on function public.iniciar_conferencia(bigint)                         from anon, public;
revoke execute on function public.bipar_conferencia(bigint, text, integer)            from anon, public;
revoke execute on function public.finalizar_conferencia(bigint)                       from anon, public;
revoke execute on function public.estatisticas_separacao(bigint, timestamptz, timestamptz) from anon, public;
grant execute on function public.resumo_conferencia(bigint)                          to authenticated;
grant execute on function public.iniciar_conferencia(bigint)                         to authenticated;
grant execute on function public.bipar_conferencia(bigint, text, integer)            to authenticated;
grant execute on function public.finalizar_conferencia(bigint)                       to authenticated;
grant execute on function public.estatisticas_separacao(bigint, timestamptz, timestamptz) to authenticated;
revoke all on public.v_conferencia_lojas from anon;

-- Tempo real: só a mudança de status da conferência (abrir/finalizar)
alter publication supabase_realtime add table public.conferencias;
