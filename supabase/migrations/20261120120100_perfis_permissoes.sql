-- =============================================================================
-- Perfis e permissões da PRODIGY. Especificação: docs/README_ROLES_WMS_MINISO.md
--
--   owner          acesso completo; único que cria ou promove administradores
--   administrador  operação + configurações; gerencia supervisores,
--                  operadores, visualizadores e os acessos das lojas
--   supervisor     coordena a operação do CD (remessas, distribuição,
--                  conferência, expedição, recebimentos, divergências)
--   operador       separa e confere o que foi atribuído a ele
--   visualizador   só leitura, nas lojas do seu escopo (por loja ou Global MINISO)
--
-- Como fica no banco, sem reescrever as funções que já rodam:
--   * eh_supervisor() passa a valer para "supervisão ou acima" (owner,
--     administrador e supervisor). Tudo o que o supervisor fazia continua.
--   * eh_administrador() (owner/administrador) protege o que sai do supervisor:
--     cadastro mestre de lojas, liberação do módulo da loja e acessos das lojas.
--   * usuario_ativo() continua sendo a equipe interna operacional e deixa de
--     fora o visualizador, que lê por políticas próprias, só no seu escopo.
--   * Sempre existe pelo menos um owner ativo.
-- As equipes das lojas (perfis.loja_id) não mudam.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Rede da loja (o escopo Global MINISO cobre só as lojas da rede MINISO)
-- ---------------------------------------------------------------------------
alter table public.lojas add column rede text not null default 'MINISO'
  constraint lojas_rede_preenchida check (btrim(rede) <> '');
create index lojas_rede_idx on public.lojas (rede);

-- ---------------------------------------------------------------------------
-- 2. Escopo do visualizador
-- ---------------------------------------------------------------------------
alter table public.perfis add column escopo_visualizador text
  constraint perfis_escopo_valido check (escopo_visualizador in ('lojas', 'global_miniso'));
-- Todo visualizador tem escopo explícito, e só visualizador tem escopo.
-- (perfis_loja_so_operador já garante que visualizador não tem loja_id.)
alter table public.perfis add constraint perfis_escopo_so_visualizador
  check ((papel = 'visualizador') = (escopo_visualizador is not null));

-- Lojas atribuídas a um visualizador de escopo "por loja"
create table public.visualizador_lojas (
  usuario_id uuid not null references public.perfis (id) on delete cascade,
  loja_id    bigint not null references public.lojas (id) on delete cascade,
  criado_em  timestamptz not null default now(),
  criado_por uuid references public.perfis (id) on delete set null,
  primary key (usuario_id, loja_id)
);
create index visualizador_lojas_loja_idx on public.visualizador_lojas (loja_id);

create function public.visualizador_lojas_so_visualizador() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.perfis where id = new.usuario_id and papel = 'visualizador') then
    raise exception 'Só visualizadores recebem lojas atribuídas';
  end if;
  return new;
end;
$$;
create trigger visualizador_lojas_so_visualizador
  before insert or update on public.visualizador_lojas
  for each row execute function public.visualizador_lojas_so_visualizador();

-- Deixou de ser visualizador: os vínculos com lojas saem junto
create function public.perfis_limpa_vinculos_visualizador() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.papel = 'visualizador' and new.papel <> 'visualizador' then
    delete from public.visualizador_lojas where usuario_id = new.id;
  end if;
  return new;
end;
$$;
create trigger perfis_limpa_vinculos_visualizador
  after update of papel on public.perfis
  for each row execute function public.perfis_limpa_vinculos_visualizador();

-- ---------------------------------------------------------------------------
-- 3. Quem está logado
-- ---------------------------------------------------------------------------

-- Equipe interna operacional (owner, administrador, supervisor, operador).
-- O visualizador fica de fora: todas as políticas e funções atuais o recusam.
create or replace function public.usuario_ativo() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.perfis
     where id = auth.uid() and ativo and loja_id is null and papel <> 'visualizador'
  );
$$;

-- Supervisão ou acima. Mantém o nome porque já é usado em todas as funções
-- de remessa, distribuição, conferência, expedição e recebimento.
create or replace function public.eh_supervisor() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.perfis
     where id = auth.uid() and ativo and loja_id is null
       and papel in ('owner', 'administrador', 'supervisor')
  );
$$;

create function public.eh_administrador() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.perfis
     where id = auth.uid() and ativo and loja_id is null
       and papel in ('owner', 'administrador')
  );
$$;

create function public.eh_owner() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.perfis
     where id = auth.uid() and ativo and loja_id is null and papel = 'owner'
  );
$$;

-- Lojas que o visualizador logado pode consultar. Nulo para quem não é
-- visualizador ativo; vazio para quem é "por loja" e não tem nenhuma loja.
create function public.lojas_do_visualizador() returns bigint[]
language sql stable security definer set search_path = ''
as $$
  select case p.escopo_visualizador
           when 'global_miniso' then
             (select coalesce(array_agg(l.id), '{}') from public.lojas l where l.rede = 'MINISO')
           when 'lojas' then
             (select coalesce(array_agg(v.loja_id), '{}') from public.visualizador_lojas v where v.usuario_id = p.id)
         end
    from public.perfis p
   where p.id = auth.uid() and p.ativo and p.loja_id is null and p.papel = 'visualizador';
$$;

-- ---------------------------------------------------------------------------
-- 4. Sempre um owner ativo
-- ---------------------------------------------------------------------------
create function public.perfis_manter_owner() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.papel = 'owner' and old.ativo
     and (tg_op = 'DELETE' or new.papel <> 'owner' or not new.ativo)
     and not exists (select 1 from public.perfis where papel = 'owner' and ativo and id <> old.id) then
    raise exception 'O WMS precisa de pelo menos um Owner ativo' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger perfis_manter_owner
  before update of papel, ativo or delete on public.perfis
  for each row execute function public.perfis_manter_owner();

-- ---------------------------------------------------------------------------
-- 5. O que sai do supervisor e fica com owner/administrador
-- ---------------------------------------------------------------------------

-- Cadastro mestre de lojas (inclui ligar/desligar o acesso da loja).
-- A importação de remessa continua criando lojas novas: ela roda no banco.
drop policy "supervisor cria lojas"   on public.lojas;
drop policy "supervisor edita lojas"  on public.lojas;
drop policy "supervisor exclui lojas" on public.lojas;
create policy "administrador cria lojas"   on public.lojas for insert to authenticated
  with check ((select public.eh_administrador()));
create policy "administrador edita lojas"  on public.lojas for update to authenticated
  using ((select public.eh_administrador())) with check ((select public.eh_administrador()));
create policy "administrador exclui lojas" on public.lojas for delete to authenticated
  using ((select public.eh_administrador()));

-- Usuários das lojas (aba "Usuários e acesso" da área Lojas MINISO)
create or replace function public.usuarios_das_lojas()
returns table (id uuid, login text, nome text, cargo text, ativo boolean, loja_id bigint, admin_loja boolean, ultima_atividade timestamptz, criado_em timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.eh_administrador() then
    raise exception 'Apenas Owner ou Administrador' using errcode = '42501';
  end if;
  return query
    select p.id, p.login, p.nome, p.cargo, p.ativo, p.loja_id, p.admin_loja, p.ultima_atividade, p.criado_em
      from public.perfis p
     where p.loja_id is not null
     order by p.ativo desc, p.admin_loja desc, p.nome;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Leitura do visualizador, só nas lojas do escopo (somente leitura)
-- O filtro é por linha: numa remessa com várias lojas, os totais das visões
-- (security_invoker) somam apenas as lojas autorizadas. Log de bips e
-- auditoria ficam de fora.
-- ---------------------------------------------------------------------------
create policy "visualizador lê lojas do escopo" on public.lojas for select to authenticated
  using (id = any ((select public.lojas_do_visualizador())::bigint[]));
create policy "visualizador lê pedidos do escopo" on public.pedidos for select to authenticated
  using (loja_id = any ((select public.lojas_do_visualizador())::bigint[]));
create policy "visualizador lê itens do escopo" on public.itens_pedido for select to authenticated
  using ((select public.lojas_do_visualizador()) is not null
         and exists (select 1 from public.pedidos p
                      where p.id = itens_pedido.pedido_id and p.loja_id = any ((select public.lojas_do_visualizador())::bigint[])));
create policy "visualizador lê remessas do escopo" on public.remessas for select to authenticated
  using ((select public.lojas_do_visualizador()) is not null
         and exists (select 1 from public.pedidos p
                      where p.remessa_id = remessas.id and p.loja_id = any ((select public.lojas_do_visualizador())::bigint[])));
create policy "visualizador lê conferências do escopo" on public.conferencias for select to authenticated
  using ((select public.lojas_do_visualizador()) is not null
         and exists (select 1 from public.pedidos p
                      where p.id = conferencias.pedido_id and p.loja_id = any ((select public.lojas_do_visualizador())::bigint[])));
create policy "visualizador lê leituras da conferência do escopo" on public.conferencia_bips for select to authenticated
  using ((select public.lojas_do_visualizador()) is not null
         and exists (select 1 from public.conferencias c join public.pedidos p on p.id = c.pedido_id
                      where c.id = conferencia_bips.conferencia_id and p.loja_id = any ((select public.lojas_do_visualizador())::bigint[])));
create policy "visualizador lê expedições do escopo" on public.expedicoes for select to authenticated
  using (loja_id = any ((select public.lojas_do_visualizador())::bigint[]));
create policy "visualizador lê itens expedidos do escopo" on public.expedicao_itens for select to authenticated
  using ((select public.lojas_do_visualizador()) is not null
         and exists (select 1 from public.expedicoes e
                      where e.id = expedicao_itens.expedicao_id and e.loja_id = any ((select public.lojas_do_visualizador())::bigint[])));
create policy "visualizador lê recebimentos do escopo" on public.recebimentos_loja for select to authenticated
  using (loja_id = any ((select public.lojas_do_visualizador())::bigint[]));
create policy "visualizador lê leituras do recebimento do escopo" on public.recebimento_bips for select to authenticated
  using ((select public.lojas_do_visualizador()) is not null
         and exists (select 1 from public.recebimentos_loja r
                      where r.id = recebimento_bips.recebimento_id and r.loja_id = any ((select public.lojas_do_visualizador())::bigint[])));
create policy "visualizador lê divergências do escopo" on public.divergencias for select to authenticated
  using (loja_id = any ((select public.lojas_do_visualizador())::bigint[]));

-- Vínculos: owner/administrador veem todos; o visualizador vê os seus.
-- Gravação só pela função de usuários (chave de serviço).
alter table public.visualizador_lojas enable row level security;
create policy "administrador ou o próprio lê vínculos" on public.visualizador_lojas for select to authenticated
  using ((select public.eh_administrador()) or usuario_id = (select auth.uid()));
revoke all on public.visualizador_lojas from anon;
revoke insert, update, delete, truncate on public.visualizador_lojas from authenticated;

-- ---------------------------------------------------------------------------
-- 7. Permissões das funções
-- ---------------------------------------------------------------------------
revoke execute on function public.eh_administrador()                    from anon, public;
revoke execute on function public.eh_owner()                            from anon, public;
revoke execute on function public.lojas_do_visualizador()               from anon, public;
revoke execute on function public.visualizador_lojas_so_visualizador()  from anon, public, authenticated;
revoke execute on function public.perfis_limpa_vinculos_visualizador()  from anon, public, authenticated;
revoke execute on function public.perfis_manter_owner()                 from anon, public, authenticated;
grant execute on function public.eh_administrador()      to authenticated;
grant execute on function public.eh_owner()              to authenticated;
grant execute on function public.lojas_do_visualizador() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Transição: o primeiro Owner chega junto com a restrição do supervisor,
-- para a gestão de contas nunca ficar sem dono. Os IDs e o histórico das
-- contas não mudam. Demais contas seguem como estão (caio.log segue
-- supervisor; operador-01 a 04 seguem operadores).
-- ---------------------------------------------------------------------------
update public.perfis set papel = 'owner'
 where login = 'jhonatan' and loja_id is null and ativo;
