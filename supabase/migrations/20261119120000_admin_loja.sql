-- =============================================================================
-- Equipe da loja: o administrador da loja cadastra os conferentes da própria
-- loja. ADITIVA: só um campo novo em perfis e funções novas/refeitas do módulo
-- das lojas. A equipe do CD não muda.
--   * admin_loja = true  -> administrador da loja (cadastrado pela PRODIGY)
--   * admin_loja = false -> conferente da loja (cadastrado pelo administrador)
-- Os dois só veem a própria loja; a gravação continua nas funções do banco.
-- =============================================================================

alter table public.perfis add column admin_loja boolean not null default false;
alter table public.perfis add constraint perfis_admin_loja_so_loja check (not admin_loja or loja_id is not null);

-- Quem já é de loja foi cadastrado pela PRODIGY como administrador
update public.perfis set admin_loja = true where loja_id is not null;

-- Lista da área "Lojas MINISO" (supervisor), agora com o tipo de acesso
drop function public.usuarios_das_lojas();
create function public.usuarios_das_lojas()
returns table (id uuid, login text, nome text, cargo text, ativo boolean, loja_id bigint, admin_loja boolean, ultima_atividade timestamptz, criado_em timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.eh_supervisor() then
    raise exception 'Apenas supervisores' using errcode = '42501';
  end if;
  return query
    select p.id, p.login, p.nome, p.cargo, p.ativo, p.loja_id, p.admin_loja, p.ultima_atividade, p.criado_em
      from public.perfis p
     where p.loja_id is not null
     order by p.ativo desc, p.admin_loja desc, p.nome;
end;
$$;

-- Equipe da minha loja (só o administrador da loja, com o acesso da loja ligado)
create function public.equipe_da_minha_loja()
returns table (id uuid, login text, nome text, cargo text, ativo boolean, admin_loja boolean, ultima_atividade timestamptz, criado_em timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_loja bigint;
begin
  select p.loja_id into v_loja
    from public.perfis p join public.lojas l on l.id = p.loja_id
   where p.id = auth.uid() and p.ativo and p.admin_loja and l.modulo_loja;
  if v_loja is null then
    raise exception 'Apenas o administrador da loja' using errcode = '42501';
  end if;
  return query
    select p.id, p.login, p.nome, p.cargo, p.ativo, p.admin_loja, p.ultima_atividade, p.criado_em
      from public.perfis p
     where p.loja_id = v_loja
     order by p.ativo desc, p.admin_loja desc, p.nome;
end;
$$;

revoke execute on function public.usuarios_das_lojas()   from anon, public;
revoke execute on function public.equipe_da_minha_loja() from anon, public;
grant execute on function public.usuarios_das_lojas()   to authenticated;
grant execute on function public.equipe_da_minha_loja() to authenticated;
