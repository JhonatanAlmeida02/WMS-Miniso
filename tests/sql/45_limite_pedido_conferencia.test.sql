begin;
do $$
declare u uuid:=gen_random_uuid(); l bigint; r bigint; p bigint; c bigint;
begin
  insert into auth.users(id) values(u);
  insert into public.perfis(id,login,nome,papel) values(u,'lim-'||left(u::text,12),'Teste limite','operador');
  insert into public.lojas(nome) values('Teste limite '||u) returning id into l;
  insert into public.remessas(codigo,status) values('TESTE-LIMITE-'||u,'ativa') returning id into r;
  insert into public.pedidos(remessa_id,loja_id,nome,conferente_id) values(r,l,'Limite',u) returning id into p;
  insert into public.itens_pedido(pedido_id,gtin,produto,qtd_pedido,qtd_separada) values
    (p,'000123','Produto válido',10,8),(p,'LEGADO','Contagem antiga acima',10,10);
  insert into public.conferencias(remessa_id,pedido_id,iniciada_por) values(r,p,u) returning id into c;
  insert into public.conferencia_bips(conferencia_id,gtin,qtd,operador_id) values(c,'LEGADO',12,u);
  perform set_config('teste.limite.conf',c::text,true);
  perform set_config('request.jwt.claim.sub',u::text,true);
end $$;
set local role authenticated;
do $$
declare c bigint:=current_setting('teste.limite.conf')::bigint; qtd integer; antes bigint;
begin
  select count(*) into antes from public.conferencia_bips where conferencia_id=c;
  begin
    perform public.bipar_conferencia(c,'000123',11);
    raise exception 'Aceitou 11 para pedido 10';
  exception when invalid_parameter_value then
    if position('Quantidade acima do pedido' in sqlerrm)=0 then raise; end if;
  end;
  if (select count(*) from public.conferencia_bips where conferencia_id=c)<>antes then raise exception 'Gravou excesso'; end if;
  perform public.bipar_conferencia(c,'000123',8);
  begin
    perform public.bipar_conferencia(c,'000123',3);
    raise exception 'Aceitou 8+3 acima de 10';
  exception when invalid_parameter_value then null;
  end;
  select x.qtd_conferida into qtd from public.bipar_conferencia(c,'000123',2) x;
  if qtd<>10 then raise exception 'Não aceitou exatamente o saldo 2'; end if;
  begin
    perform public.bipar_conferencia(c,'000123',1);
    raise exception 'Modo rápido ultrapassou produto completo';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.bipar_conferencia(c,'000123',2147483647);
    raise exception 'Quantidade enorme foi aceita';
  exception when invalid_parameter_value then null;
  end;
  perform public.bipar_conferencia(c,'000123',-2);
  select x.qtd_conferida into qtd from public.bipar_conferencia(c,'000123',2) x;
  if qtd<>10 then raise exception 'Não liberou saldo depois do estorno'; end if;
  begin
    perform public.bipar_conferencia(c,'LEGADO',1);
    raise exception 'Permitiu aumentar excesso legado';
  exception when invalid_parameter_value then null;
  end;
  perform public.bipar_conferencia(c,'LEGADO',-3);
  select x.qtd_conferida into qtd from public.bipar_conferencia(c,'LEGADO',1) x;
  if qtd<>10 then raise exception 'Não permitiu corrigir excesso legado'; end if;
  raise notice 'Limite confirmado: 11/10, acumulado 8+3, saldo exato, rápido, quantidade enorme e estornos.';
end $$;
rollback;
