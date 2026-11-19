-- Dados sintéticos descartáveis; não usa nem corrige contagens reais.
begin;
do $$
declare
  u uuid := gen_random_uuid();
  outro uuid := gen_random_uuid();
  l1 bigint; l2 bigint; r bigint; p1 bigint; p2 bigint; c bigint;
begin
  insert into auth.users(id) values(u),(outro);
  insert into public.perfis(id,login,nome,papel) values
    (u,'bloq-'||left(u::text,12),'Conferente teste','operador'),
    (outro,'bloq-'||left(outro::text,12),'Outro conferente teste','operador');
  insert into public.lojas(nome) values('Teste bloqueio A '||u) returning id into l1;
  insert into public.lojas(nome) values('Teste bloqueio B '||u) returning id into l2;
  insert into public.remessas(codigo,status) values('TESTE-BLOQUEIO-'||u,'ativa') returning id into r;
  insert into public.pedidos(remessa_id,loja_id,nome,conferente_id) values(r,l1,'A',u) returning id into p1;
  insert into public.pedidos(remessa_id,loja_id,nome,conferente_id) values(r,l2,'B',outro) returning id into p2;
  insert into public.itens_pedido(pedido_id,gtin,produto,qtd_pedido) values
    (p1,'000123','Produto da loja A',10), (p2,'OUTRO-SKU','Produto da loja B',10);
  insert into public.conferencias(remessa_id,pedido_id,iniciada_por) values(r,p1,u) returning id into c;
  -- Simula uma leitura anterior à correção para verificar o estorno legado.
  insert into public.conferencia_bips(conferencia_id,gtin,qtd,operador_id) values(c,'OUTRO-SKU',222,u);
  perform set_config('teste.bloqueio.conf',c::text,true);
  perform set_config('teste.bloqueio.usuario',u::text,true);
  perform set_config('teste.bloqueio.outro',outro::text,true);
  perform set_config('request.jwt.claim.sub',u::text,true);
end $$;

set local role authenticated;
do $$
declare
  c bigint := current_setting('teste.bloqueio.conf')::bigint;
  antes bigint;
  qtd integer;
  codigo text;
begin
  select r.qtd_conferida into qtd from public.bipar_conferencia(c,' 000123 ',3) r;
  if qtd is distinct from 3 then raise exception 'Produto válido não foi contado'; end if;
  select count(*) into antes from public.conferencia_bips where conferencia_id=c;
  foreach codigo in array array['OUTRO-SKU','NAO-EXISTE'] loop
    begin
      perform public.bipar_conferencia(c,codigo,1);
      raise exception 'Produto inválido foi aceito: %',codigo;
    exception when invalid_parameter_value then
      if position('Leitura bloqueada' in sqlerrm)=0 then raise; end if;
    end;
  end loop;
  if (select count(*) from public.conferencia_bips where conferencia_id=c) <> antes then
    raise exception 'Rejeição gravou um bip';
  end if;
  perform public.bipar_conferencia(c,'OUTRO-SKU',-222);
  if (select sum(cb.qtd) from public.conferencia_bips cb where cb.conferencia_id=c and cb.gtin='OUTRO-SKU') <> 0 then
    raise exception 'Não permitiu estornar a leitura errada anterior';
  end if;
  perform public.bipar_conferencia(c,'000123',-1);
  if (select sum(cb.qtd) from public.conferencia_bips cb where cb.conferencia_id=c and cb.gtin='000123') <> 2 then
    raise exception 'Estorno de produto válido falhou';
  end if;
  perform set_config('request.jwt.claim.sub',current_setting('teste.bloqueio.outro'),true);
  begin
    perform public.bipar_conferencia(c,'000123',1);
    raise exception 'Outro conferente conseguiu escrever';
  exception when insufficient_privilege then null;
  end;
  raise notice 'Bloqueio confirmado: produto válido, outra loja, desconhecido, sem gravação, estornos e atribuição.';
end $$;
rollback;
