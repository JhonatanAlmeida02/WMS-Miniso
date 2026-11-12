-- =============================================================================
-- Prodigy WMS: separação de remessas por loja (substitui o app "Mini WMS" do
-- Power Apps). Tudo que altera saldo passa por funções no banco, numa
-- transação só; as telas apenas leem e chamam essas funções.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type public.papel_usuario as enum ('supervisor', 'operador');
create type public.status_remessa as enum ('pendente', 'ativa', 'concluida');
create type public.tipo_bip as enum ('entrada', 'ajuste');

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

-- Era wms_tbCadastroUsuarios. A senha agora fica no Supabase Auth (com hash),
-- nunca nesta tabela.
create table public.perfis (
  id               uuid primary key references auth.users (id) on delete cascade,
  login            text not null,
  nome             text not null,
  papel            public.papel_usuario not null default 'operador',
  cargo            text,
  ativo            boolean not null default true,
  ultima_atividade timestamptz,
  criado_em        timestamptz not null default now(),
  constraint perfis_login_formato check (login ~ '^[a-z0-9._-]{3,40}$')
);
create unique index perfis_login_unico on public.perfis (login);

-- Era wms_tbLojas
create table public.lojas (
  id        bigint generated always as identity primary key,
  numero    integer,
  nome      text not null check (btrim(nome) <> ''),
  criado_em timestamptz not null default now()
);
create unique index lojas_nome_unico on public.lojas (lower(btrim(nome)));
create unique index lojas_numero_unico on public.lojas (numero) where numero is not null;

-- Era wms_tbRemessa
create table public.remessas (
  id           bigint generated always as identity primary key,
  codigo       text not null check (btrim(codigo) <> ''),
  status       public.status_remessa not null default 'pendente',
  data_chegada date,
  total_caixas integer check (total_caixas is null or total_caixas >= 0),
  observacao   text,
  arquivo_nome text,
  criado_por   uuid references public.perfis (id) on delete set null,
  criado_em    timestamptz not null default now(),
  ativada_em   timestamptz,
  concluida_em timestamptz
);
create unique index remessas_codigo_unico on public.remessas (lower(btrim(codigo)));
create index remessas_status_idx on public.remessas (status);

-- Era wms_tbPedidos. O total pedido/separado NÃO fica gravado aqui (no Power
-- Apps ele ficava e divergia dos itens); é sempre somado dos itens.
create table public.pedidos (
  id          bigint generated always as identity primary key,
  remessa_id  bigint not null references public.remessas (id) on delete cascade,
  loja_id     bigint not null references public.lojas (id),
  nome        text not null check (btrim(nome) <> ''),
  operador_id uuid references public.perfis (id) on delete set null,
  criado_em   timestamptz not null default now(),
  constraint pedidos_nome_unico_na_remessa unique (remessa_id, nome)
);
create index pedidos_operador_idx on public.pedidos (operador_id);
create index pedidos_loja_idx on public.pedidos (loja_id);

-- Era wms_tbItensPedido. GTIN é texto (GTIN-13 não cabe em int).
create table public.itens_pedido (
  id            bigint generated always as identity primary key,
  pedido_id     bigint not null references public.pedidos (id) on delete cascade,
  gtin          text not null check (gtin ~ '^[0-9A-Za-z-]{1,40}$'),
  produto       text not null,
  qtd_pedido    integer not null check (qtd_pedido > 0),
  qtd_separada  integer not null default 0,
  atualizado_em timestamptz not null default now(),
  constraint itens_gtin_unico_no_pedido unique (pedido_id, gtin),
  constraint itens_qtd_separada_valida check (qtd_separada between 0 and qtd_pedido)
);
create index itens_gtin_idx on public.itens_pedido (gtin);

-- Era wms_tbColetor: o log de cada bipagem
create table public.bips (
  id          bigint generated always as identity primary key,
  item_id     bigint not null references public.itens_pedido (id) on delete cascade,
  pedido_id   bigint not null references public.pedidos (id) on delete cascade,
  remessa_id  bigint not null references public.remessas (id) on delete cascade,
  loja_id     bigint not null references public.lojas (id),
  operador_id uuid references public.perfis (id) on delete set null,
  gtin        text not null,
  qtd         integer not null check (qtd <> 0),
  tipo        public.tipo_bip not null,
  criado_em   timestamptz not null default now()
);
create index bips_remessa_idx on public.bips (remessa_id, criado_em desc);
create index bips_item_idx on public.bips (item_id);

-- ---------------------------------------------------------------------------
-- Quem está logado
-- ---------------------------------------------------------------------------
create function public.usuario_ativo() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.perfis where id = auth.uid() and ativo);
$$;

create function public.eh_supervisor() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.perfis
    where id = auth.uid() and ativo and papel = 'supervisor'
  );
$$;

-- Batimento de "online" (era o timer do cmpHeader que gravava UltimaAtividade)
create function public.registrar_atividade() returns void
language sql security definer set search_path = ''
as $$
  update public.perfis set ultima_atividade = now() where id = auth.uid() and ativo;
$$;

-- ---------------------------------------------------------------------------
-- Visões com totais (respeitam o RLS de quem consulta)
-- ---------------------------------------------------------------------------
create view public.v_pedidos with (security_invoker = true) as
select
  p.id,
  p.remessa_id,
  r.codigo                                 as remessa_codigo,
  r.status                                 as remessa_status,
  p.nome,
  p.loja_id,
  l.nome                                   as loja_nome,
  l.numero                                 as loja_numero,
  p.operador_id,
  o.nome                                   as operador_nome,
  coalesce(t.itens, 0)::int                as itens,
  coalesce(t.qtd_pedido, 0)::int           as qtd_pedido,
  coalesce(t.qtd_separada, 0)::int         as qtd_separada,
  coalesce(t.itens_completos, 0)::int      as itens_completos
from public.pedidos p
join public.remessas r on r.id = p.remessa_id
join public.lojas l on l.id = p.loja_id
left join public.perfis o on o.id = p.operador_id
left join lateral (
  select
    count(*)                                        as itens,
    sum(i.qtd_pedido)                               as qtd_pedido,
    sum(i.qtd_separada)                             as qtd_separada,
    count(*) filter (where i.qtd_separada = i.qtd_pedido) as itens_completos
  from public.itens_pedido i where i.pedido_id = p.id
) t on true;

create view public.v_remessas with (security_invoker = true) as
select
  r.*,
  c.nome                                   as criado_por_nome,
  coalesce(t.pedidos, 0)::int              as pedidos,
  coalesce(t.pedidos_sem_operador, 0)::int as pedidos_sem_operador,
  coalesce(t.lojas, 0)::int                as lojas,
  coalesce(t.itens, 0)::int                as itens,
  coalesce(t.qtd_pedido, 0)::int           as qtd_pedido,
  coalesce(t.qtd_separada, 0)::int         as qtd_separada
from public.remessas r
left join public.perfis c on c.id = r.criado_por
left join lateral (
  select
    count(distinct p.id)                                     as pedidos,
    count(distinct p.id) filter (where p.operador_id is null) as pedidos_sem_operador,
    count(distinct p.loja_id)                                as lojas,
    count(i.id)                                              as itens,
    sum(i.qtd_pedido)                                        as qtd_pedido,
    sum(i.qtd_separada)                                      as qtd_separada
  from public.pedidos p
  left join public.itens_pedido i on i.pedido_id = p.id
  where p.remessa_id = r.id
) t on true;

create view public.v_itens with (security_invoker = true) as
select
  i.*,
  p.remessa_id,
  p.nome       as pedido_nome,
  p.operador_id,
  o.nome       as operador_nome,
  l.id         as loja_id,
  l.nome       as loja_nome,
  l.numero     as loja_numero
from public.itens_pedido i
join public.pedidos p on p.id = i.pedido_id
join public.lojas l on l.id = p.loja_id
left join public.perfis o on o.id = p.operador_id;

-- Conferência (era a scrConferenciaAdm, que fazia uma consulta por pedido):
-- um resumo por GTIN da remessa inteira, numa consulta só.
create function public.conferencia_remessa(p_remessa bigint)
returns table (
  gtin              text,
  produto           text,
  qtd_pedido        integer,
  qtd_separada      integer,
  lojas             integer,
  lojas_divergentes integer
)
language sql stable security invoker set search_path = ''
as $$
  select i.gtin,
         max(i.produto),
         sum(i.qtd_pedido)::int,
         sum(i.qtd_separada)::int,
         count(*)::int,
         count(*) filter (where i.qtd_separada <> i.qtd_pedido)::int
  from public.itens_pedido i
  join public.pedidos p on p.id = i.pedido_id
  where p.remessa_id = p_remessa
  group by i.gtin
  order by sum(i.qtd_pedido) - sum(i.qtd_separada) desc, max(i.produto), i.gtin;
$$;

create view public.v_bips with (security_invoker = true) as
select
  b.*,
  r.codigo     as remessa_codigo,
  p.nome       as pedido_nome,
  l.nome       as loja_nome,
  l.numero     as loja_numero,
  o.nome       as operador_nome,
  i.produto
from public.bips b
join public.remessas r on r.id = b.remessa_id
join public.pedidos p on p.id = b.pedido_id
join public.lojas l on l.id = b.loja_id
join public.itens_pedido i on i.id = b.item_id
left join public.perfis o on o.id = b.operador_id;

-- ---------------------------------------------------------------------------
-- Importar remessa (eram os fluxos wms_PreviewImportExcel + wms_ImportNovaRemessa)
-- p_linhas: [{ "pedido", "loja", "gtin", "produto", "qtd" }, ...]
-- Tudo numa transação: ou entra a remessa inteira, ou nada.
-- ---------------------------------------------------------------------------
create function public.importar_remessa(
  p_codigo       text,
  p_linhas       jsonb,
  p_data_chegada date default null,
  p_total_caixas integer default null,
  p_observacao   text default null,
  p_arquivo_nome text default null
) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_remessa bigint;
  v_linha   bigint;
  v_pedido  text;
begin
  if not public.eh_supervisor() then
    raise exception 'Apenas supervisores podem importar remessas' using errcode = '42501';
  end if;
  if coalesce(btrim(p_codigo), '') = '' then
    raise exception 'Informe o código da remessa';
  end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) = 0 then
    raise exception 'A planilha não tem linhas para importar';
  end if;
  if jsonb_array_length(p_linhas) > 50000 then
    raise exception 'Planilha grande demais (máximo 50.000 linhas)';
  end if;
  if exists (select 1 from public.remessas where lower(btrim(codigo)) = lower(btrim(p_codigo))) then
    raise exception 'Já existe uma remessa com o código %', btrim(p_codigo) using errcode = '23505';
  end if;

  -- Linha inválida? Avisa qual (linha 1 = primeira linha de dados)
  select n into v_linha
  from jsonb_array_elements(p_linhas) with ordinality as t(l, n)
  where coalesce(btrim(l ->> 'pedido'), '') = ''
     or coalesce(btrim(l ->> 'loja'), '') = ''
     or coalesce(btrim(l ->> 'produto'), '') = ''
     or coalesce(regexp_replace(l ->> 'gtin', '\s', '', 'g'), '') !~ '^[0-9A-Za-z-]{1,40}$'
     or case when coalesce(l ->> 'qtd', '') ~ '^\s*[0-9]{1,9}\s*$'
             then btrim(l ->> 'qtd')::int <= 0
             else true end
  order by n
  limit 1;
  if v_linha is not null then
    raise exception 'Linha % da planilha está incompleta ou com quantidade inválida', v_linha;
  end if;

  -- O mesmo pedido não pode aparecer em duas lojas
  select btrim(l ->> 'pedido') into v_pedido
  from jsonb_array_elements(p_linhas) l
  group by btrim(l ->> 'pedido')
  having count(distinct lower(btrim(l ->> 'loja'))) > 1
  limit 1;
  if v_pedido is not null then
    raise exception 'O pedido % aparece com lojas diferentes na planilha', v_pedido;
  end if;

  insert into public.remessas (codigo, data_chegada, total_caixas, observacao, arquivo_nome, criado_por)
  values (btrim(p_codigo), p_data_chegada, p_total_caixas, nullif(btrim(p_observacao), ''),
          p_arquivo_nome, auth.uid())
  returning id into v_remessa;

  -- Lojas que ainda não existem são criadas (no Power Apps a importação falhava)
  insert into public.lojas (nome)
  select distinct on (lower(btrim(l ->> 'loja'))) btrim(l ->> 'loja')
  from jsonb_array_elements(p_linhas) l
  where not exists (
    select 1 from public.lojas x where lower(btrim(x.nome)) = lower(btrim(l ->> 'loja'))
  )
  on conflict do nothing;

  insert into public.pedidos (remessa_id, loja_id, nome)
  select distinct v_remessa, lj.id, btrim(l ->> 'pedido')
  from jsonb_array_elements(p_linhas) l
  join public.lojas lj on lower(btrim(lj.nome)) = lower(btrim(l ->> 'loja'));

  -- Pedido amarrado à remessa nova (no Power Apps casava só pelo nome e podia
  -- cair num pedido de remessa antiga). GTIN repetido no pedido é somado.
  insert into public.itens_pedido (pedido_id, gtin, produto, qtd_pedido)
  select p.id,
         regexp_replace(l ->> 'gtin', '\s', '', 'g'),
         max(btrim(l ->> 'produto')),
         sum(btrim(l ->> 'qtd')::int)
  from jsonb_array_elements(p_linhas) l
  join public.pedidos p on p.remessa_id = v_remessa and p.nome = btrim(l ->> 'pedido')
  group by p.id, regexp_replace(l ->> 'gtin', '\s', '', 'g');

  return v_remessa;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ciclo da remessa
-- ---------------------------------------------------------------------------
create function public.alterar_status_remessa(p_remessa bigint, p_status public.status_remessa)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.eh_supervisor() then
    raise exception 'Apenas supervisores podem alterar a remessa' using errcode = '42501';
  end if;
  update public.remessas
     set status       = p_status,
         ativada_em   = case when p_status = 'ativa' then coalesce(ativada_em, now()) else ativada_em end,
         concluida_em = case when p_status = 'concluida' then now() else null end
   where id = p_remessa;
  if not found then
    raise exception 'Remessa não encontrada';
  end if;
end;
$$;

create function public.excluir_remessa(p_remessa bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.eh_supervisor() then
    raise exception 'Apenas supervisores podem excluir remessas' using errcode = '42501';
  end if;
  if exists (select 1 from public.bips where remessa_id = p_remessa) then
    raise exception 'Esta remessa já tem bipagens e não pode ser excluída. Conclua a remessa em vez de excluir.';
  end if;
  delete from public.remessas where id = p_remessa;
  if not found then
    raise exception 'Remessa não encontrada';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Distribuição (era o ForAll + Patch da scrDistribuicaoAdm)
-- p_atribuicoes: [{ "pedido_id": 1, "operador_id": "uuid" | null }, ...]
-- ---------------------------------------------------------------------------
create function public.distribuir_pedidos(p_atribuicoes jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_qtd integer;
begin
  if not public.eh_supervisor() then
    raise exception 'Apenas supervisores podem distribuir pedidos' using errcode = '42501';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_atribuicoes) a(pedido_id bigint, operador_id uuid)
    where a.operador_id is not null
      and not exists (select 1 from public.perfis o where o.id = a.operador_id and o.ativo)
  ) then
    raise exception 'Operador inválido ou desativado';
  end if;

  update public.pedidos p
     set operador_id = a.operador_id
    from jsonb_to_recordset(p_atribuicoes) a(pedido_id bigint, operador_id uuid)
   where p.id = a.pedido_id;
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

-- ---------------------------------------------------------------------------
-- Separação (era o OnChange do campo de bip + o botão "Confirmar Bip")
-- ---------------------------------------------------------------------------

-- Itens do GTIN bipado nos pedidos do operador, em remessas ativas.
-- "alvo" = o primeiro ainda pendente, pela ordem da loja (como no Power Apps).
create function public.itens_do_gtin(p_gtin text)
returns table (
  item_id        bigint,
  pedido_id      bigint,
  pedido_nome    text,
  remessa_id     bigint,
  remessa_codigo text,
  loja_id        bigint,
  loja_nome      text,
  loja_numero    integer,
  gtin           text,
  produto        text,
  qtd_pedido     integer,
  qtd_separada   integer,
  alvo           boolean
)
language sql stable security invoker set search_path = ''
as $$
  with itens as (
    select i.id, p.id as pedido_id, p.nome as pedido_nome, r.id as remessa_id,
           r.codigo as remessa_codigo, l.id as loja_id, l.nome as loja_nome,
           l.numero as loja_numero, i.gtin, i.produto, i.qtd_pedido, i.qtd_separada
    from public.itens_pedido i
    join public.pedidos p on p.id = i.pedido_id
    join public.remessas r on r.id = p.remessa_id
    join public.lojas l on l.id = p.loja_id
    where i.gtin = regexp_replace(coalesce(p_gtin, ''), '\s', '', 'g')
      and r.status = 'ativa'
      and p.operador_id = auth.uid()
  ),
  primeiro as (
    select id from itens
    where qtd_separada < qtd_pedido
    order by loja_numero nulls last, loja_nome, pedido_nome
    limit 1
  )
  select it.id, it.pedido_id, it.pedido_nome, it.remessa_id, it.remessa_codigo,
         it.loja_id, it.loja_nome, it.loja_numero, it.gtin, it.produto,
         it.qtd_pedido, it.qtd_separada,
         it.id = (select id from primeiro)
  from itens it
  order by it.loja_numero nulls last, it.loja_nome, it.pedido_nome;
$$;

-- Grava a bipagem: trava o item, confere o saldo NO BANCO (não o da tela),
-- atualiza e registra o log, tudo junto. Dois aparelhos ao mesmo tempo não
-- conseguem passar do pedido.
create function public.registrar_bip(
  p_item_id bigint,
  p_qtd     integer,
  p_tipo    public.tipo_bip default 'entrada'
)
returns table (item_id bigint, qtd_pedido integer, qtd_separada integer)
language plpgsql security definer set search_path = ''
as $$
declare
  v record;
  v_novo integer;
begin
  if not public.usuario_ativo() then
    raise exception 'Usuário sem acesso' using errcode = '42501';
  end if;
  if p_qtd is null or p_qtd = 0 then
    raise exception 'Informe uma quantidade diferente de zero';
  end if;
  if p_tipo = 'entrada' and p_qtd < 0 then
    raise exception 'Para tirar quantidade, use Ajuste';
  end if;

  select i.id, i.gtin, i.qtd_pedido, i.qtd_separada,
         p.id as pedido_id, p.operador_id, p.loja_id, r.id as remessa_id, r.status
    into v
    from public.itens_pedido i
    join public.pedidos p on p.id = i.pedido_id
    join public.remessas r on r.id = p.remessa_id
   where i.id = p_item_id
     for update of i;

  if not found then
    raise exception 'Item não encontrado';
  end if;
  if v.status <> 'ativa' then
    raise exception 'A remessa deste item não está ativa';
  end if;
  if v.operador_id is distinct from auth.uid() and not public.eh_supervisor() then
    raise exception 'Este pedido não está atribuído a você' using errcode = '42501';
  end if;

  v_novo := v.qtd_separada + p_qtd;
  if v_novo > v.qtd_pedido then
    raise exception 'Passaria do pedido: pedido %, já separado %', v.qtd_pedido, v.qtd_separada;
  end if;
  if v_novo < 0 then
    raise exception 'O ajuste tira mais do que já foi separado (%)', v.qtd_separada;
  end if;

  update public.itens_pedido
     set qtd_separada = v_novo, atualizado_em = now()
   where id = v.id;

  insert into public.bips (item_id, pedido_id, remessa_id, loja_id, operador_id, gtin, qtd, tipo)
  values (v.id, v.pedido_id, v.remessa_id, v.loja_id, auth.uid(), v.gtin, p_qtd, p_tipo);

  return query select v.id, v.qtd_pedido, v_novo;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: todo usuário ativo lê; só supervisor altera; saldo só pelas funções
-- ---------------------------------------------------------------------------
alter table public.perfis       enable row level security;
alter table public.lojas        enable row level security;
alter table public.remessas     enable row level security;
alter table public.pedidos      enable row level security;
alter table public.itens_pedido enable row level security;
alter table public.bips         enable row level security;

create policy "ativos leem perfis"   on public.perfis       for select to authenticated using (public.usuario_ativo() or id = auth.uid());
create policy "ativos leem lojas"    on public.lojas        for select to authenticated using (public.usuario_ativo());
create policy "ativos leem remessas" on public.remessas     for select to authenticated using (public.usuario_ativo());
create policy "ativos leem pedidos"  on public.pedidos      for select to authenticated using (public.usuario_ativo());
create policy "ativos leem itens"    on public.itens_pedido for select to authenticated using (public.usuario_ativo());
create policy "ativos leem bips"     on public.bips         for select to authenticated using (public.usuario_ativo());

create policy "supervisor cria lojas"    on public.lojas    for insert to authenticated with check (public.eh_supervisor());
create policy "supervisor edita lojas"   on public.lojas    for update to authenticated using (public.eh_supervisor()) with check (public.eh_supervisor());
create policy "supervisor exclui lojas"  on public.lojas    for delete to authenticated using (public.eh_supervisor());
create policy "supervisor edita remessa" on public.remessas for update to authenticated using (public.eh_supervisor()) with check (public.eh_supervisor());

-- Ninguém de fora do login acessa nada
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;

-- Colunas que o supervisor pode mudar direto na remessa (status vai pela função)
revoke update on public.remessas from authenticated;
grant update (data_chegada, total_caixas, observacao) on public.remessas to authenticated;

-- ---------------------------------------------------------------------------
-- Tempo real para o painel (substitui o timer de Refresh)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.bips, public.itens_pedido, public.pedidos, public.remessas;
