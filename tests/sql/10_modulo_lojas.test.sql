-- Testes do módulo das lojas, direto no Postgres (sem Docker).
-- Rodar com: bash tests/sql/rodar.sh
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- Ajudantes
-- ---------------------------------------------------------------------------
create schema teste;
grant usage on schema teste to authenticated, anon;

create function teste.como(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p::text, ''), false);
$$;

create function teste.igual(p_veio anyelement, p_esperado anyelement, p_msg text) returns void
language plpgsql as $$
begin
  if p_veio is distinct from p_esperado then
    raise exception 'FALHOU: % (veio %, esperado %)', p_msg, p_veio, p_esperado;
  end if;
  raise notice 'ok  %', p_msg;
end $$;

create function teste.deve_falhar(p_sql text, p_trecho text, p_msg text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(lower(p_trecho) in lower(sqlerrm)) = 0 then
      raise exception 'FALHOU: % (erro diferente: "%", esperado "%")', p_msg, sqlerrm, p_trecho;
    end if;
    raise notice 'ok  %', p_msg;
    return;
  end;
  raise exception 'FALHOU: % (deveria ter sido recusado)', p_msg;
end $$;
grant execute on all functions in schema teste to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Dados sintéticos: 1 supervisor, 1 operador do CD, 3 usuários de loja
-- (Loja 03 com o módulo desligado)
-- ---------------------------------------------------------------------------
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000aa'), ('00000000-0000-0000-0000-0000000000bb'),
  ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003'), ('00000000-0000-0000-0000-0000000000cc');
insert into public.lojas (nome, numero, modulo_loja) values
  ('Loja 01', 1, true), ('Loja 02', 2, true), ('Loja 03', 3, false);
insert into public.perfis (id, login, nome, papel, loja_id) values
  ('00000000-0000-0000-0000-0000000000aa', 'sup', 'Supervisor', 'supervisor', null),
  ('00000000-0000-0000-0000-0000000000bb', 'operador1', 'Operador CD', 'operador', null),
  ('00000000-0000-0000-0000-0000000000cc', 'operador2', 'Operador CD 2', 'operador', null),
  ('00000000-0000-0000-0000-000000000001', 'loja01', 'Admin Loja 01', 'operador', (select id from public.lojas where numero = 1)),
  ('00000000-0000-0000-0000-000000000002', 'loja02', 'Admin Loja 02', 'operador', (select id from public.lojas where numero = 2)),
  ('00000000-0000-0000-0000-000000000003', 'loja03', 'Admin Loja 03', 'operador', (select id from public.lojas where numero = 3));

\echo '--- supervisor importa e distribui (fluxo atual)'
set role authenticated;
select teste.como('00000000-0000-0000-0000-0000000000aa');
select public.importar_remessa('REM-TESTE', '[
  {"pedido":"PED-1","loja":"Loja 01","gtin":"0007891000001","produto":"Produto A","qtd":"20"},
  {"pedido":"PED-1","loja":"Loja 01","gtin":"7891000000002","produto":"Produto B","qtd":"20"},
  {"pedido":"PED-1","loja":"Loja 01","gtin":"7891000000003","produto":"Produto C","qtd":"20"},
  {"pedido":"PED-1","loja":"Loja 01","gtin":"7891000000004","produto":"Produto D","qtd":"5"},
  {"pedido":"PED-2","loja":"Loja 02","gtin":"0007891000001","produto":"Produto A","qtd":"10"},
  {"pedido":"PED-3","loja":"Loja 03","gtin":"0007891000001","produto":"Produto A","qtd":"5"}
]'::jsonb) as remessa \gset
select public.alterar_status_remessa(:remessa, 'ativa');
select public.distribuir_pedidos(jsonb_agg(jsonb_build_object('pedido_id', id, 'operador_id', '00000000-0000-0000-0000-0000000000bb')))
  from public.pedidos where remessa_id = :remessa;

reset role;
select id as ped1 from public.pedidos where nome = 'PED-1' \gset
select id as ped2 from public.pedidos where nome = 'PED-2' \gset
select id as it_a from public.itens_pedido where pedido_id = :ped1 and gtin = '0007891000001' \gset
select id as it_b from public.itens_pedido where pedido_id = :ped1 and gtin = '7891000000002' \gset
select id as it_c from public.itens_pedido where pedido_id = :ped1 and gtin = '7891000000003' \gset
select id as it_d from public.itens_pedido where pedido_id = :ped1 and gtin = '7891000000004' \gset
select id as it_a2 from public.itens_pedido where pedido_id = :ped2 \gset

select teste.igual((select gtin from public.itens_pedido where id = :it_a), '0007891000001', 'GTIN com zeros à esquerda preservado na importação');

\echo '--- operador do CD separa (fluxo atual)'
set role authenticated;
select teste.como('00000000-0000-0000-0000-0000000000bb');
select teste.igual((select count(*) from public.pedidos), 3::bigint, 'operador do CD continua vendo todos os pedidos');
select public.registrar_bip(:it_a, 20);
select public.registrar_bip(:it_b, 20);
select public.registrar_bip(:it_c, 10);
select public.registrar_bip(:it_d, 5);
select public.registrar_bip(:it_a2, 10);

\echo '--- usuário de loja não entra no fluxo do CD'
select teste.como('00000000-0000-0000-0000-000000000001');
select teste.deve_falhar(format('select public.registrar_bip(%s, 1)', :it_a), 'sem acesso', 'loja não bipa separação');
select teste.deve_falhar(format('select public.iniciar_conferencia(%s)', :ped1), 'sem acesso', 'loja não abre conferência do CD');
select teste.deve_falhar(format('select public.expedir_pedido(%s, 1, gen_random_uuid())', :ped1), 'apenas supervisores', 'loja não expede');
select teste.deve_falhar('select public.importar_remessa(''X'', ''[{"pedido":"P","loja":"L","gtin":"1","produto":"p","qtd":"1"}]''::jsonb)', 'apenas supervisores', 'loja não importa remessa');
select teste.deve_falhar(format('select public.distribuir_pedidos(''[{"pedido_id":%s,"operador_id":null}]''::jsonb)', :ped1), 'apenas supervisores', 'loja não distribui');
select teste.deve_falhar('insert into public.recebimento_bips (recebimento_id, revisao, gtin, qtd, operacao_id) values (1, 1, ''1'', 1, gen_random_uuid())', 'permission denied', 'loja não grava direto na tabela');
update public.lojas set nome = 'invadida' where numero = 1;
update public.pedidos set operador_id = null where id = :ped1;
reset role;
select teste.igual((select nome from public.lojas where numero = 1), 'Loja 01', 'loja não renomeia a própria loja');
select teste.igual((select operador_id from public.pedidos where id = :ped1), '00000000-0000-0000-0000-0000000000bb'::uuid, 'loja não altera o pedido');

\echo '--- supervisor não consegue pôr usuário de loja na separação'
set role authenticated;
select teste.como('00000000-0000-0000-0000-0000000000aa');
select teste.deve_falhar(format('select public.distribuir_pedidos(''[{"pedido_id":%s,"operador_id":"00000000-0000-0000-0000-000000000001"}]''::jsonb)', :ped1),
  'usuário de loja', 'usuário de loja não vira operador da separação');
select teste.deve_falhar(format('select public.atribuir_conferentes(''[{"pedido_id":%s,"conferente_id":"00000000-0000-0000-0000-000000000001"}]''::jsonb)', :ped1),
  'usuário de loja', 'usuário de loja não vira conferente do CD');
reset role;
select teste.deve_falhar('update public.perfis set loja_id = null where login = ''loja01''', 'não pode virar usuário interno', 'tirar a loja não transforma em equipe interna');
select teste.deve_falhar('update public.perfis set papel = ''supervisor'' where login = ''loja01''', 'perfis_loja_so_operador', 'usuário de loja não vira supervisor');

\echo '--- expedição 1 do PED-1 (A20 B20 C10 D5)'
set role authenticated;
select teste.como('00000000-0000-0000-0000-0000000000aa');
select gen_random_uuid() as op_exp1 \gset
select public.expedir_pedido(:ped1, 3, :'op_exp1', 'primeira entrega') as exp1 \gset
select teste.igual(public.expedir_pedido(:ped1, 3, :'op_exp1', 'primeira entrega'), :exp1::bigint, 'retry da expedição devolve a mesma');
select teste.deve_falhar(format('select public.expedir_pedido(%s, 1, gen_random_uuid())', :ped1), 'nada separado', 'sem saldo novo não expede');
select teste.igual((select sum(qtd)::int from public.expedicao_itens where expedicao_id = :exp1), 55, 'manifesto congelou 55 un.');
select id as rec1 from public.recebimentos_loja where expedicao_id = :exp1 \gset
select teste.igual((select status::text from public.recebimentos_loja where id = :rec1), 'aguardando', 'entrega fica aguardando a loja');

\echo '--- separação não tira abaixo do expedido'
select teste.como('00000000-0000-0000-0000-0000000000bb');
select teste.deve_falhar(format('select public.registrar_bip(%s, -1, ''ajuste'')', :it_a), 'já foi expedido', 'ajuste abaixo do expedido é recusado');

\echo '--- isolamento entre lojas'
select teste.como('00000000-0000-0000-0000-000000000002');
select teste.igual((select count(*) from public.pedidos), 1::bigint, 'loja 02 vê só o próprio pedido');
select teste.igual((select count(*) from public.v_pedidos), 1::bigint, 'loja 02: v_pedidos só da loja');
select teste.igual((select count(*) from public.itens_pedido), 1::bigint, 'loja 02 vê só os próprios itens');
select teste.igual((select count(*) from public.lojas), 1::bigint, 'loja 02 vê só a própria loja');
select teste.igual((select count(*) from public.remessas), 1::bigint, 'loja 02 vê só a remessa com pedido seu');
select teste.igual((select qtd_pedido from public.v_remessas), 10, 'loja 02: total da remessa só com o pedido dela');
select teste.igual((select count(*) from public.bips), 0::bigint, 'loja não lê o log de bips da equipe');
select teste.igual((select count(*) from public.perfis), 1::bigint, 'loja lê só o próprio perfil');
select teste.igual((select count(*) from public.expedicoes), 0::bigint, 'loja 02 não vê expedição da loja 01');
select teste.igual((select count(*) from public.v_expedicoes), 0::bigint, 'loja 02: v_expedicoes vazia');
select teste.igual((select count(*) from public.expedicao_itens), 0::bigint, 'loja 02 não vê manifesto da loja 01');
select teste.igual((select count(*) from public.recebimentos_loja), 0::bigint, 'loja 02 não vê recebimento da loja 01');
select teste.igual((select count(*) from public.resumo_recebimento(:rec1)), 0::bigint, 'loja 02 não lê o confronto da loja 01');
select teste.igual((select count(*) from public.itens_do_gtin('0007891000001')), 0::bigint, 'loja não busca itens da separação');
select teste.deve_falhar(format('select public.iniciar_recebimento_loja(%s)', :rec1), 'não encontrada', 'loja 02 não abre entrega da loja 01');
select teste.deve_falhar(format('select * from public.bipar_recebimento(%s, ''0007891000001'', 1, false, gen_random_uuid())', :rec1), 'não encontrada', 'loja 02 não bipa entrega da loja 01');
select teste.deve_falhar(format('select public.finalizar_recebimento_loja(%s)', :rec1), 'não encontrada', 'loja 02 não finaliza entrega da loja 01');

select teste.como('00000000-0000-0000-0000-000000000003');
select teste.igual((select count(*) from public.pedidos), 0::bigint, 'loja com módulo desligado não vê nada');
select teste.igual(public.loja_do_usuario(), null::bigint, 'módulo desligado: sem loja no banco');

select teste.como(null);
select teste.igual((select count(*) from public.pedidos), 0::bigint, 'sem sessão não vê nada');

\echo '--- recebimento 1 na loja 01'
select teste.como('00000000-0000-0000-0000-000000000001');
select teste.igual((select count(*) from public.v_expedicoes), 1::bigint, 'loja 01 vê a própria entrega');
select teste.deve_falhar(format('select * from public.bipar_recebimento(%s, ''0007891000001'', 1, false, gen_random_uuid())', :rec1), 'não está em conferência', 'não bipa antes de iniciar');
select teste.igual(public.iniciar_recebimento_loja(:rec1)::text, 'em_conferencia', 'inicia a conferência');
select teste.igual(public.iniciar_recebimento_loja(:rec1)::text, 'em_conferencia', 'iniciar de novo retoma a mesma');
-- A: 18 de 20 (falta 2)
select bip_id from public.bipar_recebimento(:rec1, '0007891000001', 18, false, gen_random_uuid());
-- B: 18 íntegros + 2 avariados (avaria 2, sem falta)
select bip_id from public.bipar_recebimento(:rec1, '7891000000002', 18, false, gen_random_uuid());
select bip_id from public.bipar_recebimento(:rec1, '7891000000002', 2, true, gen_random_uuid());
-- C: 10 de 10 (o pedido é 20, mas a entrega é 10: sem falta)
select bip_id from public.bipar_recebimento(:rec1, '7891000000003', 10, false, gen_random_uuid());
-- D: 6 de 5 (sobra 1) e um GTIN que não veio (inesperado)
select bip_id from public.bipar_recebimento(:rec1, '7891000000004', 6, false, gen_random_uuid());
select bip_id from public.bipar_recebimento(:rec1, '9990000000001', 1, false, gen_random_uuid());

\echo '--- idempotência: retry não duplica; duas leituras reais contam duas'
select gen_random_uuid() as op1 \gset
select bip_id as bip1 from public.bipar_recebimento(:rec1, '7891000000004', 1, false, :'op1') \gset
select teste.igual((select bip_id from public.bipar_recebimento(:rec1, '7891000000004', 1, false, :'op1')), :bip1::bigint, 'retry devolve a mesma leitura');
select teste.deve_falhar(format('select * from public.bipar_recebimento(%s, ''7891000000004'', 2, false, %L)', :rec1, :'op1'), 'dados diferentes', 'mesmo identificador com outro payload é erro');
select teste.igual((select qtd_recebida from public.resumo_recebimento(:rec1) where gtin = '7891000000004'), 7, 'D: 6 + 1 (retry não contou)');
select gen_random_uuid() as op_est \gset
select bip_id from public.estornar_bip_recebimento(:bip1, :'op_est');
select teste.igual((select bip_id from public.estornar_bip_recebimento(:bip1, :'op_est')) is not null, true, 'retry do estorno é aceito');
select teste.deve_falhar(format('select * from public.estornar_bip_recebimento(%s, gen_random_uuid())', :bip1), 'já foi desfeita', 'não estorna duas vezes');
select teste.igual((select qtd_recebida from public.resumo_recebimento(:rec1) where gtin = '7891000000004'), 6, 'D volta a 6 depois do estorno');

\echo '--- finalização e divergências'
select teste.igual(public.finalizar_recebimento_loja(:rec1)::text, 'recebido_com_divergencia', 'finaliza com divergência');
select teste.igual(public.finalizar_recebimento_loja(:rec1)::text, 'recebido_com_divergencia', 'retry da finalização');
select teste.deve_falhar(format('select * from public.bipar_recebimento(%s, ''0007891000001'', 1, false, gen_random_uuid())', :rec1), 'não está em conferência', 'não grava depois de finalizado');
select teste.igual((select string_agg(tipo || ':' || gtin || ':' || qtd, ' ' order by tipo, gtin) from public.divergencias where recebimento_id = :rec1),
  'falta:0007891000001:2 sobra:7891000000004:1 avaria:7891000000002:2 inesperado:9990000000001:1', 'divergências geradas');
select teste.igual((select qtd_expedida || '/' || qtd_recebida from public.divergencias where gtin = '0007891000001'), '20/18', 'pedido 20, expedido 20, recebido 18: falta 2');
reset role;
select teste.igual((select qtd_pedido || '/' || qtd_separada from public.itens_pedido where id = :it_a), '20/20', 'pedido e separado não mudaram');
select teste.igual((select qtd from public.expedicao_itens where item_id = :it_a), 20, 'expedido não mudou');
select teste.igual((select count(*) from public.divergencias where gtin = '7891000000002' and tipo = 'falta'), 0::bigint, '18 íntegros + 2 avariados: sem falta física');
select teste.igual((select count(*) from public.divergencias where gtin = '7891000000003'), 0::bigint, 'entrega parcial de 10 recebida 10: sem falta');
select teste.igual((select count(*) from public.itens_pedido where gtin = '9990000000001'), 0::bigint, 'GTIN inesperado não entra no pedido');

\echo '--- painel: saldo a expedir e agregações sem multiplicar'
set role authenticated;
select teste.como('00000000-0000-0000-0000-000000000001');
select teste.igual((select qtd_pedido - qtd_expedida from public.v_loja_itens where gtin = '7891000000003'), 10, 'C: saldo a expedir 10');
select teste.igual((select qtd_pedido || '/' || qtd_separada || '/' || qtd_expedida || '/' || qtd_recebida || '/' || qtd_avariada from public.v_loja_pedidos),
  '65/55/55/54/2', 'painel: pedido/separado/expedido/recebido/avariado');

\echo '--- segunda entrega do PED-1 (C mais 10)'
select teste.como('00000000-0000-0000-0000-0000000000bb');
select public.registrar_bip(:it_c, 10);
select teste.como('00000000-0000-0000-0000-0000000000aa');
select public.expedir_pedido(:ped1, 1, gen_random_uuid()) as exp2 \gset
select teste.igual((select numero from public.expedicoes where id = :exp2), 2, 'segunda entrega numerada');
select teste.igual((select string_agg(gtin || ':' || qtd, ' ') from public.expedicao_itens where expedicao_id = :exp2), '7891000000003:10', 'só o saldo novo foi expedido');
select id as rec2 from public.recebimentos_loja where expedicao_id = :exp2 \gset

select teste.como('00000000-0000-0000-0000-000000000001');
select public.iniciar_recebimento_loja(:rec2);
select teste.igual((select qtd_expedida || '/' || expedicoes || '/' || volumes_expedidos || '/' || volumes_recebidos from public.v_loja_pedidos), '65/2/4/3', 'painel com duas entregas');
select bip_id from public.bipar_recebimento(:rec2, '7891000000003', 1, false, gen_random_uuid());
select public.finalizar_recebimento_loja(:rec2);
select teste.igual((select qtd from public.divergencias where recebimento_id = :rec2 and tipo = 'falta'), 9, 'entrega 2: falta 9');

\echo '--- reabertura: só supervisor, com motivo; histórico fica'
select teste.deve_falhar(format('select public.reabrir_recebimento_loja(%s, ''x'')', :rec2), 'apenas supervisores', 'loja não reabre');
select teste.como('00000000-0000-0000-0000-0000000000aa');
select teste.deve_falhar(format('select public.reabrir_recebimento_loja(%s, ''  '')', :rec2), 'motivo', 'reabrir exige motivo');
select teste.igual(public.reabrir_recebimento_loja(:rec2, 'Caixa encontrada no depósito'), 2, 'reaberto na revisão 2');
select teste.como('00000000-0000-0000-0000-000000000001');
select teste.igual((select count(*) from public.resumo_recebimento(:rec2) where qtd_recebida > 0), 0::bigint, 'nova contagem começa do zero');
select bip_id from public.bipar_recebimento(:rec2, '7891000000003', 10, false, gen_random_uuid());
select teste.igual(public.finalizar_recebimento_loja(:rec2)::text, 'recebido_conferido', 'recontagem bateu');
select teste.igual((select count(*) from public.v_divergencias where recebimento_id = :rec2), 1::bigint, 'divergência da revisão 1 continua no histórico');
select teste.igual((select atual from public.v_divergencias where recebimento_id = :rec2), false, 'e aparece como de contagem anterior');

\echo '--- supervisor trata divergência sem mudar quantidades'
select id as div_a from public.divergencias where recebimento_id = :rec1 and tipo = 'falta' \gset
select teste.deve_falhar(format('select public.atualizar_divergencia(%s, ''resolvida'')', :div_a), 'apenas supervisores', 'loja não resolve divergência');
select teste.como('00000000-0000-0000-0000-0000000000aa');
select teste.deve_falhar(format('select public.atualizar_divergencia(%s, ''resolvida'')', :div_a), 'descreva a solução', 'resolver exige descrição');
select public.atualizar_divergencia(:div_a, 'em_analise');
select public.atualizar_divergencia(:div_a, 'resolvida', 'Reenviadas 2 un. na próxima remessa');
select teste.igual((select status::text || '/' || qtd from public.divergencias where id = :div_a), 'resolvida/2', 'resolvida, quantidade original preservada');
select teste.igual((select count(*) from public.auditoria where entidade = 'divergencias'), 2::bigint, 'auditoria registrou as mudanças');
select teste.como('00000000-0000-0000-0000-000000000001');
select teste.igual((select count(*) from public.auditoria), 0::bigint, 'loja não lê a auditoria');

\echo '--- usuário desativado perde o acesso com a sessão aberta'
reset role;
update public.perfis set ativo = false where login = 'loja01';
set role authenticated;
select teste.como('00000000-0000-0000-0000-000000000001');
select teste.igual((select count(*) from public.pedidos), 0::bigint, 'desativado não lê mais nada');
select teste.deve_falhar(format('select public.iniciar_recebimento_loja(%s)', :rec1), 'sem acesso', 'desativado não grava');
reset role;
update public.perfis set ativo = true where login = 'loja01';
update public.lojas set modulo_loja = false where numero = 1;
set role authenticated;
select teste.como('00000000-0000-0000-0000-000000000001');
select teste.igual((select count(*) from public.v_expedicoes), 0::bigint, 'desligar o módulo da loja corta o acesso');
reset role;
update public.lojas set modulo_loja = true where numero = 1;

\echo '--- regressão: equipe interna e conferência do CD seguem iguais'
set role authenticated;
select teste.como('00000000-0000-0000-0000-0000000000aa');
select teste.igual((select count(*) from public.pedidos), 3::bigint, 'supervisor vê todos os pedidos');
select teste.igual((select count(*) from public.perfis), 3::bigint, 'telas atuais: supervisor vê só a equipe interna nos perfis');
select teste.igual((select count(*) from public.usuarios_das_lojas()), 3::bigint, 'área Lojas MINISO: supervisor lista os usuários das lojas');
select teste.igual((select finalizado_por_nome from public.v_expedicoes where id = :exp1), 'Admin Loja 01', 'supervisor vê quem finalizou o recebimento');
select teste.como('00000000-0000-0000-0000-0000000000bb');
select teste.igual((select count(*) from public.perfis where loja_id is not null), 0::bigint, 'operador do CD não vê usuários de loja');
select teste.deve_falhar('select * from public.usuarios_das_lojas()', 'apenas supervisores', 'operador não lista usuários das lojas');
select teste.como('00000000-0000-0000-0000-000000000002');
select teste.igual(public.nome_usuario('00000000-0000-0000-0000-000000000001'), null::text, 'loja 02 não descobre nome de usuário da loja 01');
select teste.igual(public.nome_usuario('00000000-0000-0000-0000-0000000000aa'), 'Supervisor', 'loja vê o nome da equipe PRODIGY nos registros');
select teste.deve_falhar('select * from public.usuarios_das_lojas()', 'apenas supervisores', 'loja não lista usuários');
select teste.como('00000000-0000-0000-0000-0000000000aa');
select public.atribuir_conferentes(format('[{"pedido_id":%s,"conferente_id":"00000000-0000-0000-0000-0000000000cc"}]', :ped2)::jsonb);
select teste.como('00000000-0000-0000-0000-0000000000cc');
select public.iniciar_conferencia(:ped2) as conf2 \gset
select teste.igual((select qtd_conferida from public.bipar_conferencia(:conf2, '0007891000001', 10)), 10, 'conferência do CD continua funcionando');
select public.finalizar_conferencia(:conf2);
select teste.igual((select count(*) from public.v_divergencias), 5::bigint, 'operador interno vê as divergências');

\echo '--- anônimo não executa nada novo'
reset role;
select teste.igual(has_function_privilege('anon', 'public.bipar_recebimento(bigint,text,integer,boolean,uuid)', 'execute'), false, 'anon sem bipar_recebimento');
select teste.igual(has_function_privilege('anon', 'public.expedir_pedido(bigint,integer,uuid,text)', 'execute'), false, 'anon sem expedir_pedido');
select teste.igual(has_function_privilege('anon', 'public.loja_do_usuario()', 'execute'), false, 'anon sem loja_do_usuario');
select teste.igual(has_table_privilege('anon', 'public.recebimento_bips', 'select'), false, 'anon sem leitura de recebimento_bips');
select teste.igual(has_table_privilege('authenticated', 'public.divergencias', 'update'), false, 'ninguém edita divergência direto');

\echo 'TODOS OS TESTES PASSARAM'
