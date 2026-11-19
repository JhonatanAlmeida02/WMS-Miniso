-- Bloqueia produtos fora do pedido antes de qualquer gravação.
-- Preserva as permissões, a atribuição do conferente e o histórico existente.
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
  v_pedido     bigint;
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

  select c.status, p.conferente_id, p.id into v_status, v_conferente, v_pedido
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

  -- Recusa novas entradas de outro pedido. Estornos de erros antigos continuam possíveis.
  if p_qtd > 0 and not exists (
    select 1 from public.itens_pedido i
     where i.pedido_id = v_pedido and i.gtin = v_gtin
  ) then
    raise exception 'Produto não pertence ao pedido desta loja. Leitura bloqueada.' using errcode = '22023';
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

revoke execute on function public.bipar_conferencia(bigint,text,integer) from anon, public;
grant execute on function public.bipar_conferencia(bigint,text,integer) to authenticated;
