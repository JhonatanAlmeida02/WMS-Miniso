-- =============================================================================
-- Módulo das lojas (MINISO): painel da loja, expedição pelo CD e conferência
-- de recebimento na loja. Especificação: docs/README_MINISO_CLAUDE_CODE.md
--
-- ADITIVA. Para quem já usa o WMS (perfis sem loja vinculada) nada muda:
--   * os papéis continuam só "supervisor" e "operador";
--   * o administrador da loja é um "operador" com perfis.loja_id preenchido;
--   * usuario_ativo() passa a valer só para a equipe interna (loja_id nulo),
--     então todas as políticas e funções atuais recusam o usuário de loja;
--   * o usuário de loja lê apenas a própria loja, por políticas novas, e só
--     depois que a PRODIGY habilita o módulo naquela loja (lojas.modulo_loja).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Vínculo do usuário com a loja e habilitação por loja
-- ---------------------------------------------------------------------------
alter table public.lojas add column modulo_loja boolean not null default false;

alter table public.perfis add column loja_id bigint references public.lojas (id) on delete restrict;
alter table public.perfis add constraint perfis_loja_so_operador check (loja_id is null or papel = 'operador');
create index perfis_loja_idx on public.perfis (loja_id) where loja_id is not null;

-- Equipe interna = ativo e SEM loja. Para os perfis atuais (todos sem loja)
-- o resultado é o mesmo de antes.
create or replace function public.usuario_ativo() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.perfis where id = auth.uid() and ativo and loja_id is null);
$$;

-- Loja do usuário logado, se ele for de loja, estiver ativo e o módulo estiver
-- habilitado nessa loja. Nulo para todo o resto. Vem do banco, nunca do navegador.
create function public.loja_do_usuario() returns bigint
language sql stable security definer set search_path = ''
as $$
  select p.loja_id
    from public.perfis p
    join public.lojas l on l.id = p.loja_id
   where p.id = auth.uid() and p.ativo and l.modulo_loja;
$$;

-- Tirar a loja de um usuário o transformaria em equipe interna (leitura de
-- tudo). Para encerrar o acesso de alguém da loja: desativar o usuário.
create function public.perfis_loja_nao_vira_interno() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.loja_id is not null and new.loja_id is null then
    raise exception 'Usuário de loja não pode virar usuário interno. Desative-o e crie outro usuário.';
  end if;
  return new;
end;
$$;
create trigger perfis_loja_nao_vira_interno
  before update of loja_id on public.perfis
  for each row execute function public.perfis_loja_nao_vira_interno();

-- Usuário de loja não entra na separação nem na conferência do CD
create function public.pedidos_sem_usuario_de_loja() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.operador_id is not null and new.operador_id is distinct from old.operador_id
     and exists (select 1 from public.perfis where id = new.operador_id and loja_id is not null) then
    raise exception 'Usuário de loja não pode ser operador da separação' using errcode = '42501';
  end if;
  if new.conferente_id is not null and new.conferente_id is distinct from old.conferente_id
     and exists (select 1 from public.perfis where id = new.conferente_id and loja_id is not null) then
    raise exception 'Usuário de loja não pode conferir no CD' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger pedidos_sem_usuario_de_loja
  before update of operador_id, conferente_id on public.pedidos
  for each row execute function public.pedidos_sem_usuario_de_loja();

-- Os usuários de loja ficam fora da lista de perfis da equipe interna: as
-- telas atuais (Painel, Distribuição, Conferência, Usuários) seguem mostrando
-- só a equipe do CD, sem mudar uma linha delas. Cada um continua lendo o
-- próprio perfil (login).
drop policy "ativos leem perfis" on public.perfis;
create policy "ativos leem perfis" on public.perfis for select to authenticated
  using (((select public.usuario_ativo()) and loja_id is null) or id = (select auth.uid()));

-- Nome de quem aparece num registro das telas novas (expediu, finalizou...).
-- Equipe interna vê todos; a loja vê a equipe interna e os colegas da loja.
create function public.nome_usuario(p_id uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select u.nome
    from public.perfis u
   where u.id = p_id
     and (public.usuario_ativo()
          or (public.loja_do_usuario() is not null
              and (u.loja_id is null or u.loja_id = public.loja_do_usuario())));
$$;

-- Usuários das lojas, para a área "Lojas MINISO" (só supervisor)
create function public.usuarios_das_lojas()
returns table (id uuid, login text, nome text, cargo text, ativo boolean, loja_id bigint, ultima_atividade timestamptz, criado_em timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.eh_supervisor() then
    raise exception 'Apenas supervisores' using errcode = '42501';
  end if;
  return query
    select p.id, p.login, p.nome, p.cargo, p.ativo, p.loja_id, p.ultima_atividade, p.criado_em
      from public.perfis p
     where p.loja_id is not null
     order by p.ativo desc, p.nome;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Leitura da própria loja (políticas novas, somadas às atuais)
-- O "is not null" vem primeiro: para a equipe interna a subconsulta nem roda.
-- ---------------------------------------------------------------------------
create policy "loja lê a própria loja" on public.lojas for select to authenticated
  using (id = (select public.loja_do_usuario()));

create policy "loja lê seus pedidos" on public.pedidos for select to authenticated
  using (loja_id = (select public.loja_do_usuario()));

create policy "loja lê itens dos seus pedidos" on public.itens_pedido for select to authenticated
  using ((select public.loja_do_usuario()) is not null
         and exists (select 1 from public.pedidos p
                      where p.id = itens_pedido.pedido_id and p.loja_id = (select public.loja_do_usuario())));

create policy "loja lê remessas com pedido seu" on public.remessas for select to authenticated
  using ((select public.loja_do_usuario()) is not null
         and exists (select 1 from public.pedidos p
                      where p.remessa_id = remessas.id and p.loja_id = (select public.loja_do_usuario())));

create policy "loja lê conferências do CD dos seus pedidos" on public.conferencias for select to authenticated
  using ((select public.loja_do_usuario()) is not null
         and exists (select 1 from public.pedidos p
                      where p.id = conferencias.pedido_id and p.loja_id = (select public.loja_do_usuario())));

create policy "loja lê bips da conferência do CD" on public.conferencia_bips for select to authenticated
  using ((select public.loja_do_usuario()) is not null
         and exists (select 1 from public.conferencias c join public.pedidos p on p.id = c.pedido_id
                      where c.id = conferencia_bips.conferencia_id and p.loja_id = (select public.loja_do_usuario())));

-- ---------------------------------------------------------------------------
-- 3. Expedição: o manifesto do que saiu do CD (imutável depois de gravado)
-- ---------------------------------------------------------------------------
-- Permite FK composta: a expedição só aponta para pedido da mesma loja/remessa
create unique index pedidos_id_loja_remessa on public.pedidos (id, loja_id, remessa_id);

create table public.expedicoes (
  id          bigint generated always as identity primary key,
  pedido_id   bigint not null,
  loja_id     bigint not null,
  remessa_id  bigint not null,
  numero      integer not null check (numero > 0),          -- 1ª, 2ª... entrega do pedido
  volumes     integer not null check (volumes between 1 and 9999),
  observacao  text,
  operacao_id uuid not null unique,
  expedida_por uuid references public.perfis (id) on delete set null,
  expedida_em timestamptz not null default now(),
  constraint expedicoes_pedido_fk foreign key (pedido_id, loja_id, remessa_id)
    references public.pedidos (id, loja_id, remessa_id) on delete restrict,
  constraint expedicoes_numero_unico unique (pedido_id, numero),
  constraint expedicoes_id_loja unique (id, loja_id)
);
create index expedicoes_loja_idx on public.expedicoes (loja_id, expedida_em desc);
create index expedicoes_remessa_idx on public.expedicoes (remessa_id);

create table public.expedicao_itens (
  id           bigint generated always as identity primary key,
  expedicao_id bigint not null references public.expedicoes (id) on delete restrict,
  item_id      bigint not null references public.itens_pedido (id) on delete restrict,
  gtin         text not null,       -- congelado no momento da expedição
  produto      text not null,
  qtd          integer not null check (qtd > 0),
  constraint expedicao_itens_item_unico unique (expedicao_id, item_id),
  constraint expedicao_itens_gtin_unico unique (expedicao_id, gtin)
);
create index expedicao_itens_item_idx on public.expedicao_itens (item_id);

-- Depois de expedido, o ajuste da separação não pode tirar abaixo do que saiu
create function public.itens_nao_abaixo_do_expedido() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_expedido integer;
begin
  if new.qtd_separada < old.qtd_separada then
    select coalesce(sum(qtd), 0) into v_expedido from public.expedicao_itens where item_id = new.id;
    if new.qtd_separada < v_expedido then
      raise exception 'Este produto já foi expedido (% un.) e não pode ficar abaixo disso', v_expedido;
    end if;
  end if;
  return new;
end;
$$;
create trigger itens_nao_abaixo_do_expedido
  before update of qtd_separada on public.itens_pedido
  for each row execute function public.itens_nao_abaixo_do_expedido();

-- ---------------------------------------------------------------------------
-- 4. Recebimento na loja
-- ---------------------------------------------------------------------------
create type public.status_recebimento as enum (
  'aguardando', 'em_conferencia', 'recebido_conferido', 'recebido_com_divergencia'
);

-- Um recebimento lógico por entrega. Recontagem = nova revisão (o histórico fica).
create table public.recebimentos_loja (
  id             bigint generated always as identity primary key,
  expedicao_id   bigint not null unique,
  loja_id        bigint not null,
  status         public.status_recebimento not null default 'aguardando',
  revisao        integer not null default 1 check (revisao > 0),
  iniciado_por   uuid references public.perfis (id) on delete set null,
  iniciado_em    timestamptz,
  finalizado_por uuid references public.perfis (id) on delete set null,
  finalizado_em  timestamptz,
  atualizado_em  timestamptz not null default now(),
  constraint recebimentos_expedicao_fk foreign key (expedicao_id, loja_id)
    references public.expedicoes (id, loja_id) on delete restrict
);
create index recebimentos_loja_idx on public.recebimentos_loja (loja_id, status);

-- Cada leitura. Estorno é um evento novo (qtd negativa) apontando para a leitura.
create table public.recebimento_bips (
  id             bigint generated always as identity primary key,
  recebimento_id bigint not null references public.recebimentos_loja (id) on delete restrict,
  revisao        integer not null,
  gtin           text not null check (gtin ~ '^[0-9A-Za-z-]{1,40}$'),
  qtd            integer not null check (qtd <> 0),
  avariado       boolean not null default false,
  estorno_de     bigint references public.recebimento_bips (id) on delete restrict,
  operacao_id    uuid not null unique,                 -- idempotência (retry não duplica)
  operador_id    uuid references public.perfis (id) on delete set null,
  criado_em      timestamptz not null default now(),
  constraint recebimento_bips_sinal check ((estorno_de is null and qtd > 0) or (estorno_de is not null and qtd < 0))
);
create unique index recebimento_bips_um_estorno on public.recebimento_bips (estorno_de) where estorno_de is not null;
create index recebimento_bips_rec_idx on public.recebimento_bips (recebimento_id, revisao, gtin);

create type public.tipo_divergencia as enum ('falta', 'sobra', 'avaria', 'inesperado');
create type public.status_divergencia as enum ('aberta', 'em_analise', 'resolvida');

create table public.divergencias (
  id             bigint generated always as identity primary key,
  recebimento_id bigint not null references public.recebimentos_loja (id) on delete restrict,
  revisao        integer not null,
  loja_id        bigint not null references public.lojas (id),
  gtin           text not null,
  produto        text not null,
  tipo           public.tipo_divergencia not null,
  qtd_expedida   integer not null,
  qtd_recebida   integer not null,    -- físico = íntegro + avariado
  qtd_avariada   integer not null,
  qtd            integer not null check (qtd > 0),
  status         public.status_divergencia not null default 'aberta',
  resolucao      text,
  resolvida_por  uuid references public.perfis (id) on delete set null,
  resolvida_em   timestamptz,
  criada_em      timestamptz not null default now(),
  constraint divergencias_unica unique (recebimento_id, revisao, gtin, tipo)
);
create index divergencias_loja_idx on public.divergencias (loja_id, status);

create table public.auditoria (
  id          bigint generated always as identity primary key,
  ator        uuid references public.perfis (id) on delete set null,
  acao        text not null,
  entidade    text not null,
  entidade_id bigint,
  dados       jsonb,
  motivo      text,
  criado_em   timestamptz not null default now()
);
create index auditoria_entidade_idx on public.auditoria (entidade, entidade_id, criado_em desc);

-- RLS: equipe interna lê tudo; loja lê só o que é dela; ninguém grava direto
alter table public.expedicoes        enable row level security;
alter table public.expedicao_itens   enable row level security;
alter table public.recebimentos_loja enable row level security;
alter table public.recebimento_bips  enable row level security;
alter table public.divergencias      enable row level security;
alter table public.auditoria         enable row level security;

create policy "equipe ou loja lê expedições" on public.expedicoes for select to authenticated
  using ((select public.usuario_ativo()) or loja_id = (select public.loja_do_usuario()));
create policy "equipe ou loja lê itens expedidos" on public.expedicao_itens for select to authenticated
  using ((select public.usuario_ativo())
         or ((select public.loja_do_usuario()) is not null
             and exists (select 1 from public.expedicoes e
                          where e.id = expedicao_itens.expedicao_id and e.loja_id = (select public.loja_do_usuario()))));
create policy "equipe ou loja lê recebimentos" on public.recebimentos_loja for select to authenticated
  using ((select public.usuario_ativo()) or loja_id = (select public.loja_do_usuario()));
create policy "equipe ou loja lê leituras do recebimento" on public.recebimento_bips for select to authenticated
  using ((select public.usuario_ativo())
         or ((select public.loja_do_usuario()) is not null
             and exists (select 1 from public.recebimentos_loja r
                          where r.id = recebimento_bips.recebimento_id and r.loja_id = (select public.loja_do_usuario()))));
create policy "equipe ou loja lê divergências" on public.divergencias for select to authenticated
  using ((select public.usuario_ativo()) or loja_id = (select public.loja_do_usuario()));
create policy "supervisor lê auditoria" on public.auditoria for select to authenticated
  using ((select public.eh_supervisor()));

revoke all on public.expedicoes, public.expedicao_itens, public.recebimentos_loja,
              public.recebimento_bips, public.divergencias, public.auditoria from anon;
revoke insert, update, delete, truncate on public.expedicoes, public.expedicao_itens, public.recebimentos_loja,
              public.recebimento_bips, public.divergencias, public.auditoria from authenticated;

-- ---------------------------------------------------------------------------
-- 5. Confronto do recebimento: pedido x expedido x recebido (íntegro/avariado)
-- situacao: ok | falta | sobra | avaria | inesperado
-- Diferença física = recebido (íntegro + avariado) - expedido. Avaria é
-- ocorrência a mais, mesmo com diferença física zero.
-- ---------------------------------------------------------------------------
create function public.resumo_recebimento(p_recebimento bigint)
returns table (
  gtin         text,
  produto      text,
  qtd_pedido   integer,
  qtd_expedida integer,
  qtd_integra  integer,
  qtd_avariada integer,
  qtd_recebida integer,
  situacao     text
)
language sql stable security invoker set search_path = ''
as $$
  with r as (
    select rl.id, rl.expedicao_id, rl.revisao from public.recebimentos_loja rl where rl.id = p_recebimento
  ),
  m as (
    select ei.gtin, ei.produto, ei.qtd, ip.qtd_pedido
      from public.expedicao_itens ei
      join public.itens_pedido ip on ip.id = ei.item_id
     where ei.expedicao_id = (select expedicao_id from r)
  ),
  b as (
    select rb.gtin,
           coalesce(sum(rb.qtd) filter (where not rb.avariado), 0)::int as integra,
           coalesce(sum(rb.qtd) filter (where rb.avariado), 0)::int     as avariada
      from public.recebimento_bips rb
     where rb.recebimento_id = p_recebimento and rb.revisao = (select revisao from r)
     group by rb.gtin
  ),
  j as (
    select coalesce(m.gtin, b.gtin) as gtin,
           coalesce(m.produto,
                    (select max(ip.produto) from public.itens_pedido ip
                       join public.expedicoes e on e.pedido_id = ip.pedido_id
                      where e.id = (select expedicao_id from r) and ip.gtin = b.gtin),
                    'Produto não esperado nesta entrega') as produto,
           coalesce(m.qtd_pedido, 0) as qtd_pedido,
           coalesce(m.qtd, 0)        as qtd_expedida,
           coalesce(b.integra, 0)    as qtd_integra,
           coalesce(b.avariada, 0)   as qtd_avariada,
           m.gtin is null            as inesperado
      from m full join b on b.gtin = m.gtin
  )
  select j.gtin, j.produto, j.qtd_pedido, j.qtd_expedida, j.qtd_integra, j.qtd_avariada,
         j.qtd_integra + j.qtd_avariada,
         case
           when j.inesperado then 'inesperado'
           when j.qtd_integra + j.qtd_avariada < j.qtd_expedida then 'falta'
           when j.qtd_integra + j.qtd_avariada > j.qtd_expedida then 'sobra'
           when j.qtd_avariada > 0 then 'avaria'
           else 'ok'
         end
    from j
   where not j.inesperado or j.qtd_integra + j.qtd_avariada <> 0
   order by
     case
       when j.inesperado then 0
       when j.qtd_integra + j.qtd_avariada = j.qtd_expedida and j.qtd_avariada = 0 then 2
       else 1
     end,
     j.produto;
$$;

-- ---------------------------------------------------------------------------
-- 6. Funções (todas checam sessão, conta ativa, papel, loja e estado no banco)
-- ---------------------------------------------------------------------------

-- Supervisor registra a saída do CD: expede o saldo separado e ainda não
-- expedido do pedido. Pode haver várias entregas por pedido.
create function public.expedir_pedido(
  p_pedido     bigint,
  p_volumes    integer,
  p_operacao   uuid,
  p_observacao text default null
) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_ped    record;
  v_id     bigint;
  v_numero integer;
  v_itens  integer;
begin
  if not public.eh_supervisor() then
    raise exception 'Apenas supervisores podem registrar a expedição' using errcode = '42501';
  end if;
  if p_operacao is null then
    raise exception 'Operação sem identificador';
  end if;
  if p_volumes is null or p_volumes < 1 or p_volumes > 9999 then
    raise exception 'Informe quantos volumes saíram (1 a 9999)';
  end if;

  -- Trava o pedido (numeração das entregas) e depois os itens (mesma trava do bip)
  select p.id, p.loja_id, p.remessa_id, r.status into v_ped
    from public.pedidos p join public.remessas r on r.id = p.remessa_id
   where p.id = p_pedido
     for update of p;
  if not found then
    raise exception 'Pedido não encontrado';
  end if;

  -- Retry da mesma operação devolve a expedição já gravada
  select id into v_id from public.expedicoes where operacao_id = p_operacao;
  if v_id is not null then
    if not exists (select 1 from public.expedicoes where id = v_id and pedido_id = p_pedido) then
      raise exception 'Identificador de operação já usado em outra expedição';
    end if;
    return v_id;
  end if;

  if v_ped.status = 'pendente' then
    raise exception 'A remessa ainda não foi ativada';
  end if;

  perform 1 from public.itens_pedido where pedido_id = p_pedido order by id for update;

  select coalesce(max(numero), 0) + 1 into v_numero from public.expedicoes where pedido_id = p_pedido;

  insert into public.expedicoes (pedido_id, loja_id, remessa_id, numero, volumes, observacao, operacao_id, expedida_por)
  values (p_pedido, v_ped.loja_id, v_ped.remessa_id, v_numero, p_volumes, nullif(btrim(p_observacao), ''), p_operacao, auth.uid())
  returning id into v_id;

  insert into public.expedicao_itens (expedicao_id, item_id, gtin, produto, qtd)
  select v_id, i.id, i.gtin, i.produto, i.qtd_separada - coalesce(x.expedido, 0)
    from public.itens_pedido i
    left join lateral (
      select sum(ei.qtd) as expedido from public.expedicao_itens ei where ei.item_id = i.id
    ) x on true
   where i.pedido_id = p_pedido
     and i.qtd_separada - coalesce(x.expedido, 0) > 0;
  get diagnostics v_itens = row_count;
  if v_itens = 0 then
    raise exception 'Não há nada separado e ainda não expedido neste pedido';
  end if;

  insert into public.recebimentos_loja (expedicao_id, loja_id) values (v_id, v_ped.loja_id);

  insert into public.auditoria (ator, acao, entidade, entidade_id, dados)
  values (auth.uid(), 'expedir', 'expedicoes', v_id,
          jsonb_build_object('pedido_id', p_pedido, 'numero', v_numero, 'volumes', p_volumes,
                             'unidades', (select sum(qtd) from public.expedicao_itens where expedicao_id = v_id)));
  return v_id;
end;
$$;

-- Loja abre (ou retoma) a conferência de uma entrega
create function public.iniciar_recebimento_loja(p_recebimento bigint)
returns public.status_recebimento
language plpgsql security definer set search_path = ''
as $$
declare
  v_loja bigint := public.loja_do_usuario();
  v      record;
begin
  if v_loja is null then
    raise exception 'Usuário sem acesso ao recebimento da loja' using errcode = '42501';
  end if;
  select id, loja_id, status into v from public.recebimentos_loja where id = p_recebimento for update;
  if not found or v.loja_id <> v_loja then
    raise exception 'Entrega não encontrada';
  end if;
  if v.status = 'aguardando' then
    update public.recebimentos_loja
       set status = 'em_conferencia', iniciado_por = auth.uid(), iniciado_em = now(), atualizado_em = now()
     where id = p_recebimento;
    return 'em_conferencia';
  end if;
  return v.status;
end;
$$;

-- Uma leitura física. p_operacao é gerado uma vez no aparelho e reaproveitado
-- nos retries; duas leituras reais do mesmo GTIN têm operações diferentes.
create function public.bipar_recebimento(
  p_recebimento bigint,
  p_gtin        text,
  p_qtd         integer,
  p_avariado    boolean,
  p_operacao    uuid
)
returns table (
  bip_id       bigint,
  gtin         text,
  produto      text,
  qtd_pedido   integer,
  qtd_expedida integer,
  qtd_integra  integer,
  qtd_avariada integer,
  qtd_recebida integer,
  situacao     text
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_loja bigint := public.loja_do_usuario();
  v_gtin text := regexp_replace(coalesce(p_gtin, ''), '\s', '', 'g');
  v      record;
  v_bip  record;
  v_id   bigint;
begin
  if v_loja is null then
    raise exception 'Usuário sem acesso ao recebimento da loja' using errcode = '42501';
  end if;
  if p_operacao is null then
    raise exception 'Leitura sem identificador de operação';
  end if;
  if v_gtin !~ '^[0-9A-Za-z-]{1,40}$' then
    raise exception 'Código inválido';
  end if;
  if p_qtd is null or p_qtd < 1 or p_qtd > 9999 then
    raise exception 'Quantidade inválida';
  end if;

  -- Mesma trava da finalização: nada grava depois de fechado
  select id, loja_id, status, revisao into v from public.recebimentos_loja where id = p_recebimento for update;
  if not found or v.loja_id <> v_loja then
    raise exception 'Entrega não encontrada';
  end if;

  select * into v_bip from public.recebimento_bips rb where rb.operacao_id = p_operacao;
  if found then
    if v_bip.recebimento_id <> p_recebimento or v_bip.gtin <> v_gtin or v_bip.qtd <> p_qtd
       or v_bip.avariado <> coalesce(p_avariado, false) or v_bip.estorno_de is not null then
      raise exception 'Identificador de operação repetido com dados diferentes';
    end if;
    return query select v_bip.id, x.* from public.resumo_recebimento(p_recebimento) x where x.gtin = v_gtin;
    return;
  end if;

  if v.status <> 'em_conferencia' then
    raise exception 'Esta entrega não está em conferência';
  end if;

  insert into public.recebimento_bips (recebimento_id, revisao, gtin, qtd, avariado, operacao_id, operador_id)
  values (p_recebimento, v.revisao, v_gtin, p_qtd, coalesce(p_avariado, false), p_operacao, auth.uid())
  returning id into v_id;
  update public.recebimentos_loja set atualizado_em = now() where id = p_recebimento;

  return query select v_id, x.* from public.resumo_recebimento(p_recebimento) x where x.gtin = v_gtin;
end;
$$;

-- Desfaz uma leitura (evento novo; a leitura original continua no histórico)
create function public.estornar_bip_recebimento(p_bip bigint, p_operacao uuid)
returns table (
  bip_id       bigint,
  gtin         text,
  produto      text,
  qtd_pedido   integer,
  qtd_expedida integer,
  qtd_integra  integer,
  qtd_avariada integer,
  qtd_recebida integer,
  situacao     text
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_loja bigint := public.loja_do_usuario();
  v_orig record;
  v      record;
  v_bip  record;
  v_id   bigint;
begin
  if v_loja is null then
    raise exception 'Usuário sem acesso ao recebimento da loja' using errcode = '42501';
  end if;
  if p_operacao is null then
    raise exception 'Estorno sem identificador de operação';
  end if;

  select rb.* into v_orig from public.recebimento_bips rb where rb.id = p_bip;
  if not found then
    raise exception 'Leitura não encontrada';
  end if;
  select id, loja_id, status, revisao into v from public.recebimentos_loja where id = v_orig.recebimento_id for update;
  if v.loja_id <> v_loja then
    raise exception 'Leitura não encontrada';
  end if;

  select * into v_bip from public.recebimento_bips rb where rb.operacao_id = p_operacao;
  if found then
    if v_bip.estorno_de is distinct from p_bip then
      raise exception 'Identificador de operação repetido com dados diferentes';
    end if;
    return query select v_bip.id, x.* from public.resumo_recebimento(v.id) x where x.gtin = v_orig.gtin;
    return;
  end if;

  if v.status <> 'em_conferencia' then
    raise exception 'Esta entrega não está em conferência';
  end if;
  if v_orig.estorno_de is not null then
    raise exception 'Não dá para estornar um estorno';
  end if;
  if v_orig.revisao <> v.revisao then
    raise exception 'Esta leitura é de uma contagem anterior';
  end if;
  if exists (select 1 from public.recebimento_bips rb where rb.estorno_de = p_bip) then
    raise exception 'Esta leitura já foi desfeita';
  end if;

  insert into public.recebimento_bips (recebimento_id, revisao, gtin, qtd, avariado, estorno_de, operacao_id, operador_id)
  values (v.id, v.revisao, v_orig.gtin, -v_orig.qtd, v_orig.avariado, p_bip, p_operacao, auth.uid())
  returning id into v_id;
  update public.recebimentos_loja set atualizado_em = now() where id = v.id;

  return query select v_id, x.* from public.resumo_recebimento(v.id) x where x.gtin = v_orig.gtin;
end;
$$;

-- Fecha a conferência e gera as divergências na mesma transação
create function public.finalizar_recebimento_loja(p_recebimento bigint)
returns public.status_recebimento
language plpgsql security definer set search_path = ''
as $$
declare
  v_loja   bigint := public.loja_do_usuario();
  v        record;
  v_status public.status_recebimento;
  v_qtd    integer;
begin
  if v_loja is null then
    raise exception 'Usuário sem acesso ao recebimento da loja' using errcode = '42501';
  end if;
  select id, loja_id, status, revisao into v from public.recebimentos_loja where id = p_recebimento for update;
  if not found or v.loja_id <> v_loja then
    raise exception 'Entrega não encontrada';
  end if;
  if v.status in ('recebido_conferido', 'recebido_com_divergencia') then
    return v.status;   -- retry de uma finalização que já entrou
  end if;
  if v.status <> 'em_conferencia' then
    raise exception 'Esta entrega não está em conferência';
  end if;

  insert into public.divergencias (recebimento_id, revisao, loja_id, gtin, produto, tipo, qtd_expedida, qtd_recebida, qtd_avariada, qtd)
  select p_recebimento, v.revisao, v.loja_id, s.gtin, s.produto, d.tipo, s.qtd_expedida, s.qtd_recebida, s.qtd_avariada, d.qtd
    from public.resumo_recebimento(p_recebimento) s
    cross join lateral (
      values
        ('falta'::public.tipo_divergencia,      case when s.situacao <> 'inesperado' then s.qtd_expedida - s.qtd_recebida end),
        ('sobra'::public.tipo_divergencia,      case when s.situacao <> 'inesperado' then s.qtd_recebida - s.qtd_expedida end),
        ('inesperado'::public.tipo_divergencia, case when s.situacao = 'inesperado' then s.qtd_recebida end),
        ('avaria'::public.tipo_divergencia,     s.qtd_avariada)
    ) d(tipo, qtd)
   where d.qtd > 0;
  get diagnostics v_qtd = row_count;

  v_status := case when v_qtd > 0 then 'recebido_com_divergencia' else 'recebido_conferido' end;
  update public.recebimentos_loja
     set status = v_status, finalizado_por = auth.uid(), finalizado_em = now(), atualizado_em = now()
   where id = p_recebimento;

  insert into public.auditoria (ator, acao, entidade, entidade_id, dados)
  values (auth.uid(), 'finalizar_recebimento', 'recebimentos_loja', p_recebimento,
          jsonb_build_object('revisao', v.revisao, 'status', v_status, 'divergencias', v_qtd));
  return v_status;
end;
$$;

-- Supervisor reabre para nova contagem (motivo obrigatório; histórico fica)
create function public.reabrir_recebimento_loja(p_recebimento bigint, p_motivo text)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v record;
begin
  if not public.eh_supervisor() then
    raise exception 'Apenas supervisores podem reabrir o recebimento' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da reabertura';
  end if;
  select id, status, revisao into v from public.recebimentos_loja where id = p_recebimento for update;
  if not found then
    raise exception 'Recebimento não encontrado';
  end if;
  if v.status not in ('recebido_conferido', 'recebido_com_divergencia') then
    raise exception 'Só dá para reabrir um recebimento finalizado';
  end if;
  update public.recebimentos_loja
     set status = 'em_conferencia', revisao = v.revisao + 1,
         finalizado_por = null, finalizado_em = null, atualizado_em = now()
   where id = p_recebimento;
  insert into public.auditoria (ator, acao, entidade, entidade_id, dados, motivo)
  values (auth.uid(), 'reabrir_recebimento', 'recebimentos_loja', p_recebimento,
          jsonb_build_object('status_anterior', v.status, 'revisao_anterior', v.revisao, 'revisao_nova', v.revisao + 1),
          btrim(p_motivo));
  return v.revisao + 1;
end;
$$;

-- Supervisor acompanha e resolve a divergência (quantidades não mudam)
create function public.atualizar_divergencia(
  p_divergencia bigint,
  p_status      public.status_divergencia,
  p_resolucao   text default null
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v record;
begin
  if not public.eh_supervisor() then
    raise exception 'Apenas supervisores podem tratar divergências' using errcode = '42501';
  end if;
  select id, status, resolucao into v from public.divergencias where id = p_divergencia for update;
  if not found then
    raise exception 'Divergência não encontrada';
  end if;
  if v.status = 'resolvida' then
    raise exception 'Esta divergência já foi resolvida';
  end if;
  if p_status = 'aberta' then
    raise exception 'Escolha "em análise" ou "resolvida"';
  end if;
  if p_status = 'resolvida' and coalesce(btrim(p_resolucao), '') = '' then
    raise exception 'Descreva a solução para resolver a divergência';
  end if;
  update public.divergencias
     set status = p_status,
         resolucao = coalesce(nullif(btrim(p_resolucao), ''), resolucao),
         resolvida_por = case when p_status = 'resolvida' then auth.uid() end,
         resolvida_em  = case when p_status = 'resolvida' then now() end
   where id = p_divergencia;
  insert into public.auditoria (ator, acao, entidade, entidade_id, dados, motivo)
  values (auth.uid(), 'atualizar_divergencia', 'divergencias', p_divergencia,
          jsonb_build_object('status_anterior', v.status, 'status_novo', p_status), nullif(btrim(p_resolucao), ''));
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Visões do painel (respeitam o RLS de quem consulta)
-- As somas ficam em subconsultas separadas para um join não multiplicar o outro.
-- ---------------------------------------------------------------------------
create view public.v_expedicoes with (security_invoker = true) as
select
  e.id,
  e.pedido_id,
  e.loja_id,
  e.remessa_id,
  e.numero,
  e.volumes,
  e.observacao,
  e.expedida_em,
  public.nome_usuario(e.expedida_por)  as expedida_por_nome,
  p.nome                               as pedido_nome,
  r.codigo                             as remessa_codigo,
  l.nome                               as loja_nome,
  l.numero                             as loja_numero,
  coalesce(ti.produtos, 0)::int        as produtos,
  coalesce(ti.qtd_expedida, 0)::int    as qtd_expedida,
  rc.id                                as recebimento_id,
  rc.status                            as recebimento_status,
  rc.revisao,
  rc.iniciado_em,
  rc.finalizado_em,
  public.nome_usuario(rc.finalizado_por) as finalizado_por_nome,
  coalesce(tb.qtd_integra, 0)::int     as qtd_integra,
  coalesce(tb.qtd_avariada, 0)::int    as qtd_avariada,
  coalesce(tb.leituras, 0)::int        as leituras,
  coalesce(dv.divergencias, 0)::int    as divergencias,
  coalesce(dv.abertas, 0)::int         as divergencias_abertas
from public.expedicoes e
join public.pedidos p on p.id = e.pedido_id
join public.remessas r on r.id = e.remessa_id
join public.lojas l on l.id = e.loja_id
left join public.recebimentos_loja rc on rc.expedicao_id = e.id
left join lateral (
  select count(*) as produtos, sum(ei.qtd) as qtd_expedida
    from public.expedicao_itens ei where ei.expedicao_id = e.id
) ti on true
left join lateral (
  select sum(rb.qtd) filter (where not rb.avariado) as qtd_integra,
         sum(rb.qtd) filter (where rb.avariado)     as qtd_avariada,
         count(*) filter (where rb.estorno_de is null) as leituras
    from public.recebimento_bips rb
   where rb.recebimento_id = rc.id and rb.revisao = rc.revisao
) tb on true
left join lateral (
  select count(*) as divergencias, count(*) filter (where d.status <> 'resolvida') as abertas
    from public.divergencias d
   where d.recebimento_id = rc.id and d.revisao = rc.revisao
) dv on true;

-- Um pedido da loja do começo ao fim: pedido, separado, conferido no CD,
-- expedido e recebido.
create view public.v_loja_pedidos with (security_invoker = true) as
select
  p.id                                   as pedido_id,
  p.nome                                 as pedido_nome,
  p.remessa_id,
  r.codigo                               as remessa_codigo,
  r.status                               as remessa_status,
  r.criado_em                            as remessa_criada_em,
  r.ativada_em                           as remessa_ativada_em,
  r.data_chegada,
  p.loja_id,
  l.nome                                 as loja_nome,
  l.numero                               as loja_numero,
  coalesce(ti.itens, 0)::int             as itens,
  coalesce(ti.qtd_pedido, 0)::int        as qtd_pedido,
  coalesce(ti.qtd_separada, 0)::int      as qtd_separada,
  cf.status                              as conferencia_cd_status,
  coalesce(cf.qtd_conferida, 0)::int     as qtd_conferida_cd,
  coalesce(ex.expedicoes, 0)::int        as expedicoes,
  coalesce(ex.volumes, 0)::int           as volumes_expedidos,
  coalesce(ex.volumes_recebidos, 0)::int as volumes_recebidos,
  coalesce(ex.qtd_expedida, 0)::int      as qtd_expedida,
  coalesce(rb.qtd_recebida, 0)::int      as qtd_recebida,
  coalesce(rb.qtd_avariada, 0)::int      as qtd_avariada,
  coalesce(ex.aguardando, 0)::int        as entregas_aguardando,
  coalesce(ex.em_conferencia, 0)::int    as entregas_em_conferencia,
  coalesce(ex.conferidas, 0)::int        as entregas_conferidas,
  coalesce(ex.com_divergencia, 0)::int   as entregas_com_divergencia,
  ex.ultima_expedicao_em
from public.pedidos p
join public.remessas r on r.id = p.remessa_id
join public.lojas l on l.id = p.loja_id
left join lateral (
  select count(*) as itens, sum(i.qtd_pedido) as qtd_pedido, sum(i.qtd_separada) as qtd_separada
    from public.itens_pedido i where i.pedido_id = p.id
) ti on true
left join lateral (
  -- conferência do CD mais recente; conta o que bate com o separado
  select c.status,
         (select sum(least(greatest(q.q, 0), i.qtd_separada))
            from public.itens_pedido i
            join (select cb.gtin, sum(cb.qtd) as q from public.conferencia_bips cb
                   where cb.conferencia_id = c.id group by cb.gtin) q on q.gtin = i.gtin
           where i.pedido_id = p.id) as qtd_conferida
    from public.conferencias c
   where c.pedido_id = p.id
   order by c.iniciada_em desc
   limit 1
) cf on true
left join lateral (
  select count(*)                                                   as expedicoes,
         sum(e.volumes)                                             as volumes,
         sum(e.volumes) filter (where rc.status in ('recebido_conferido', 'recebido_com_divergencia')) as volumes_recebidos,
         sum((select sum(ei.qtd) from public.expedicao_itens ei where ei.expedicao_id = e.id)) as qtd_expedida,
         count(*) filter (where rc.status = 'aguardando')               as aguardando,
         count(*) filter (where rc.status = 'em_conferencia')           as em_conferencia,
         count(*) filter (where rc.status = 'recebido_conferido')       as conferidas,
         count(*) filter (where rc.status = 'recebido_com_divergencia') as com_divergencia,
         max(e.expedida_em)                                         as ultima_expedicao_em
    from public.expedicoes e
    left join public.recebimentos_loja rc on rc.expedicao_id = e.id
   where e.pedido_id = p.id
) ex on true
left join lateral (
  -- recebido físico dos produtos do manifesto, na contagem atual de cada entrega
  select sum(b.qtd) as qtd_recebida, sum(b.qtd) filter (where b.avariado) as qtd_avariada
    from public.expedicoes e
    join public.recebimentos_loja rc on rc.expedicao_id = e.id
    join public.recebimento_bips b on b.recebimento_id = rc.id and b.revisao = rc.revisao
   where e.pedido_id = p.id
     and exists (select 1 from public.expedicao_itens ei where ei.expedicao_id = e.id and ei.gtin = b.gtin)
) rb on true;

-- Produto a produto do pedido: o que falta separar, expedir e receber
create view public.v_loja_itens with (security_invoker = true) as
select
  i.id                                  as item_id,
  i.pedido_id,
  p.loja_id,
  p.remessa_id,
  i.gtin,
  i.produto,
  i.qtd_pedido,
  i.qtd_separada,
  coalesce(ex.qtd_expedida, 0)::int     as qtd_expedida,
  coalesce(ex.a_receber, 0)::int        as qtd_a_receber,
  coalesce(rb.qtd_recebida, 0)::int     as qtd_recebida,
  coalesce(rb.qtd_avariada, 0)::int     as qtd_avariada
from public.itens_pedido i
join public.pedidos p on p.id = i.pedido_id
left join lateral (
  select sum(ei.qtd) as qtd_expedida,
         sum(ei.qtd) filter (where rc.status in ('aguardando', 'em_conferencia')) as a_receber
    from public.expedicao_itens ei
    join public.expedicoes e on e.id = ei.expedicao_id
    left join public.recebimentos_loja rc on rc.expedicao_id = e.id
   where ei.item_id = i.id
) ex on true
left join lateral (
  select sum(b.qtd) as qtd_recebida, sum(b.qtd) filter (where b.avariado) as qtd_avariada
    from public.expedicao_itens ei
    join public.recebimentos_loja rc on rc.expedicao_id = ei.expedicao_id
    join public.recebimento_bips b on b.recebimento_id = rc.id and b.revisao = rc.revisao and b.gtin = ei.gtin
   where ei.item_id = i.id
) rb on true;

create view public.v_divergencias with (security_invoker = true) as
select
  d.*,
  e.id                 as expedicao_id,
  e.numero             as expedicao_numero,
  e.pedido_id,
  e.remessa_id,
  p.nome               as pedido_nome,
  r.codigo             as remessa_codigo,
  l.nome               as loja_nome,
  l.numero             as loja_numero,
  rc.revisao = d.revisao as atual,
  public.nome_usuario(d.resolvida_por) as resolvida_por_nome
from public.divergencias d
join public.recebimentos_loja rc on rc.id = d.recebimento_id
join public.expedicoes e on e.id = rc.expedicao_id
join public.pedidos p on p.id = e.pedido_id
join public.remessas r on r.id = e.remessa_id
join public.lojas l on l.id = d.loja_id;

revoke all on public.v_expedicoes, public.v_loja_pedidos, public.v_loja_itens, public.v_divergencias from anon;

-- ---------------------------------------------------------------------------
-- 8. Permissões das funções novas (só usuário logado; nunca anônimo)
-- ---------------------------------------------------------------------------
revoke execute on function public.loja_do_usuario()                                         from anon, public;
revoke execute on function public.nome_usuario(uuid)                                        from anon, public;
revoke execute on function public.usuarios_das_lojas()                                      from anon, public;
revoke execute on function public.pedidos_sem_usuario_de_loja()                             from anon, public, authenticated;
revoke execute on function public.perfis_loja_nao_vira_interno()                            from anon, public, authenticated;
revoke execute on function public.itens_nao_abaixo_do_expedido()                            from anon, public, authenticated;
revoke execute on function public.resumo_recebimento(bigint)                                from anon, public;
revoke execute on function public.expedir_pedido(bigint, integer, uuid, text)               from anon, public;
revoke execute on function public.iniciar_recebimento_loja(bigint)                          from anon, public;
revoke execute on function public.bipar_recebimento(bigint, text, integer, boolean, uuid)   from anon, public;
revoke execute on function public.estornar_bip_recebimento(bigint, uuid)                    from anon, public;
revoke execute on function public.finalizar_recebimento_loja(bigint)                        from anon, public;
revoke execute on function public.reabrir_recebimento_loja(bigint, text)                    from anon, public;
revoke execute on function public.atualizar_divergencia(bigint, public.status_divergencia, text) from anon, public;

grant execute on function public.loja_do_usuario()                                          to authenticated;
grant execute on function public.nome_usuario(uuid)                                         to authenticated;
grant execute on function public.usuarios_das_lojas()                                       to authenticated;
grant execute on function public.resumo_recebimento(bigint)                                 to authenticated;
grant execute on function public.expedir_pedido(bigint, integer, uuid, text)                to authenticated;
grant execute on function public.iniciar_recebimento_loja(bigint)                           to authenticated;
grant execute on function public.bipar_recebimento(bigint, text, integer, boolean, uuid)    to authenticated;
grant execute on function public.estornar_bip_recebimento(bigint, uuid)                     to authenticated;
grant execute on function public.finalizar_recebimento_loja(bigint)                         to authenticated;
grant execute on function public.reabrir_recebimento_loja(bigint, text)                     to authenticated;
grant execute on function public.atualizar_divergencia(bigint, public.status_divergencia, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Tempo real (o Realtime do Supabase respeita as políticas de leitura)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.expedicoes, public.recebimentos_loja, public.divergencias;
