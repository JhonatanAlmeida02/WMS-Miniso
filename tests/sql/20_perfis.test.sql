-- Testes de perfis e permissões (owner, administrador, supervisor, operador,
-- visualizador). Roda depois de 10_modulo_lojas.test.sql e reaproveita os
-- ajudantes (schema teste) e os dados dele.
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- Contas novas
-- ---------------------------------------------------------------------------
reset role;
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000d1'), ('00000000-0000-0000-0000-0000000000d2'),
  ('00000000-0000-0000-0000-0000000000e1'), ('00000000-0000-0000-0000-0000000000e2'),
  ('00000000-0000-0000-0000-0000000000e3'), ('00000000-0000-0000-0000-0000000000e4');
insert into public.perfis (id, login, nome, papel, escopo_visualizador) values
  ('00000000-0000-0000-0000-0000000000d1', 'dono',  'Owner',              'owner',         null),
  ('00000000-0000-0000-0000-0000000000d2', 'adm',   'Administrador',      'administrador', null),
  ('00000000-0000-0000-0000-0000000000e1', 'vis2',  'Visualizador 2 lojas', 'visualizador', 'lojas'),
  ('00000000-0000-0000-0000-0000000000e2', 'visg',  'Visualizador global',  'visualizador', 'global_miniso'),
  ('00000000-0000-0000-0000-0000000000e3', 'vis0',  'Visualizador sem loja', 'visualizador', 'lojas'),
  ('00000000-0000-0000-0000-0000000000e4', 'visx',  'Visualizador inativo', 'visualizador', 'global_miniso');
update public.perfis set ativo = false where login = 'visx';
insert into public.visualizador_lojas (usuario_id, loja_id)
select '00000000-0000-0000-0000-0000000000e1', id from public.lojas where numero in (1, 2);

-- Uma loja de outra rede, com pedido, para provar que o Global MINISO não a vê
set role authenticated;
select teste.como('00000000-0000-0000-0000-0000000000aa');
select public.importar_remessa('REM-OUTRA', '[
  {"pedido":"PED-X","loja":"Loja Outra Rede","gtin":"7891000000009","produto":"Produto X","qtd":"7"},
  {"pedido":"PED-X1","loja":"Loja 01","gtin":"7891000000009","produto":"Produto X","qtd":"3"}
]'::jsonb) as rem_outra \gset
reset role;
update public.lojas set rede = 'OUTRA' where nome = 'Loja Outra Rede';
select id as loja_outra from public.lojas where nome = 'Loja Outra Rede' \gset

\echo '--- regras do cadastro'
select teste.deve_falhar('update public.perfis set escopo_visualizador = null where login = ''vis2''', 'perfis_escopo_so_visualizador', 'visualizador precisa de escopo explícito');
select teste.deve_falhar('update public.perfis set escopo_visualizador = ''lojas'' where login = ''sup''', 'perfis_escopo_so_visualizador', 'só visualizador tem escopo');
select teste.deve_falhar('update public.perfis set escopo_visualizador = ''tudo'' where login = ''vis2''', 'perfis_escopo_valido', 'escopo inválido é recusado');
select teste.deve_falhar(format('update public.perfis set loja_id = %s where login = ''vis2''', (select id from public.lojas where numero = 1)), 'perfis_loja_so_operador', 'visualizador não é usuário de loja');
select teste.deve_falhar(format('insert into public.visualizador_lojas (usuario_id, loja_id) values (''00000000-0000-0000-0000-0000000000aa'', %s)', (select id from public.lojas where numero = 1)), 'só visualizadores', 'loja atribuída só a visualizador');

\echo '--- sempre um owner ativo'
select teste.deve_falhar('update public.perfis set ativo = false where login = ''dono''', 'pelo menos um owner', 'não desativa o último owner');
select teste.deve_falhar('update public.perfis set papel = ''supervisor'' where login = ''dono''', 'pelo menos um owner', 'não rebaixa o último owner');
select teste.deve_falhar('delete from public.perfis where login = ''dono''', 'pelo menos um owner', 'não exclui o último owner');
update public.perfis set papel = 'owner' where login = 'adm';
update public.perfis set papel = 'administrador' where login = 'adm';
select teste.igual((select count(*) from public.perfis where papel = 'owner' and ativo), 1::bigint, 'com dois owners, um pode deixar de ser');

\echo '--- quem é quem'
set role authenticated;
select teste.como('00000000-0000-0000-0000-0000000000d1');
select teste.igual(public.eh_owner() and public.eh_administrador() and public.eh_supervisor() and public.usuario_ativo(), true, 'owner tem tudo');
select teste.como('00000000-0000-0000-0000-0000000000d2');
select teste.igual((public.eh_owner(), public.eh_administrador(), public.eh_supervisor()), (false, true, true), 'administrador: admin e supervisão, não owner');
select teste.como('00000000-0000-0000-0000-0000000000aa');
select teste.igual((public.eh_owner(), public.eh_administrador(), public.eh_supervisor()), (false, false, true), 'supervisor: só supervisão');
select teste.como('00000000-0000-0000-0000-0000000000bb');
select teste.igual((public.eh_administrador(), public.eh_supervisor(), public.usuario_ativo()), (false, false, true), 'operador: equipe interna sem supervisão');
select teste.como('00000000-0000-0000-0000-0000000000e2');
select teste.igual((public.eh_administrador(), public.eh_supervisor(), public.usuario_ativo()), (false, false, false), 'visualizador fora da equipe operacional');

\echo '--- supervisor opera, mas não cuida de cadastro mestre nem de acessos'
select teste.como('00000000-0000-0000-0000-0000000000aa');
select teste.deve_falhar('insert into public.lojas (nome) values (''Loja Nova'')', 'row-level security', 'supervisor não cadastra loja');
update public.lojas set modulo_loja = not modulo_loja where numero = 1;
select teste.deve_falhar('select * from public.usuarios_das_lojas()', 'apenas owner ou administrador', 'supervisor não lista acessos das lojas');
select public.importar_remessa('REM-SUP', '[{"pedido":"PED-S","loja":"Loja 02","gtin":"7891000000002","produto":"Produto B","qtd":"2"}]'::jsonb) as rem_sup \gset
select teste.igual((select count(*) from public.remessas where id = :rem_sup), 1::bigint, 'supervisor continua importando remessa');
reset role;
select teste.igual((select modulo_loja from public.lojas where numero = 1), true, 'supervisor não liga/desliga o acesso da loja');
set role authenticated;
select teste.como('00000000-0000-0000-0000-0000000000d2');
insert into public.lojas (nome) values ('Loja Nova');
select teste.igual((select count(*) from public.lojas where nome = 'Loja Nova'), 1::bigint, 'administrador cadastra loja');
update public.lojas set modulo_loja = false where numero = 3;
select teste.igual((select count(*) from public.usuarios_das_lojas()) > 0, true, 'administrador lista acessos das lojas');
select public.alterar_status_remessa(:rem_sup, 'ativa');
select teste.igual((select status::text from public.remessas where id = :rem_sup), 'ativa', 'administrador também opera remessas');
select teste.como('00000000-0000-0000-0000-0000000000bb');
select teste.deve_falhar(format('select public.alterar_status_remessa(%s, ''concluida'')', :rem_sup), 'apenas supervisores', 'operador não conclui remessa');

\echo '--- visualizador por loja (Loja 01 e Loja 02)'
select teste.como('00000000-0000-0000-0000-0000000000e1');
select teste.igual((select array_agg(numero order by numero) from public.lojas), array[1, 2], 'vê só as duas lojas atribuídas');
select teste.igual((select count(*) from public.pedidos where loja_id not in (select id from public.lojas where numero in (1, 2))), 0::bigint, 'nenhum pedido fora do escopo');
select teste.igual((select count(*) from public.bips), 0::bigint, 'sem log de bips');
select teste.igual((select count(*) from public.auditoria), 0::bigint, 'sem auditoria');
select teste.igual((select count(*) from public.perfis), 1::bigint, 'só o próprio perfil');
select teste.igual((select count(*) from public.visualizador_lojas), 2::bigint, 'vê os próprios vínculos');
select sum(qtd_pedido) as vis_rem from public.v_remessas where codigo = 'REM-TESTE' \gset
select sum(qtd_pedido) as vis_rem_outra from public.v_remessas where codigo = 'REM-OUTRA' \gset
select coalesce(sum(qtd_pedido), 0) as vis_pedidos from public.v_loja_pedidos \gset
select count(*) as vis_exp from public.v_expedicoes \gset
select count(*) as vis_div from public.v_divergencias \gset
reset role;
select teste.igual(:vis_rem::bigint,
  (select sum(i.qtd_pedido) from public.itens_pedido i join public.pedidos p on p.id = i.pedido_id join public.remessas r on r.id = p.remessa_id join public.lojas l on l.id = p.loja_id
    where r.codigo = 'REM-TESTE' and l.numero in (1, 2)),
  'remessa com 3 lojas soma só as 2 do escopo');
select teste.igual(:vis_rem_outra::bigint, 3::bigint, 'remessa com loja de outra rede soma só a Loja 01');
select teste.igual(:vis_exp::bigint, (select count(*) from public.expedicoes e join public.lojas l on l.id = e.loja_id where l.numero in (1, 2)), 'entregas só do escopo');
select teste.igual(:vis_div::bigint, (select count(*) from public.divergencias d join public.lojas l on l.id = d.loja_id where l.numero in (1, 2)), 'divergências só do escopo');

\echo '--- visualizador não grava nada'
set role authenticated;
select teste.como('00000000-0000-0000-0000-0000000000e1');
select teste.deve_falhar('select public.importar_remessa(''V'', ''[{"pedido":"P","loja":"L","gtin":"1","produto":"p","qtd":"1"}]''::jsonb)', 'apenas supervisores', 'não importa remessa');
select teste.deve_falhar(format('select public.expedir_pedido(%s, 1, gen_random_uuid())', (select id from public.pedidos limit 1)), 'apenas supervisores', 'não expede');
select teste.deve_falhar(format('select * from public.registrar_bip(%s, 1)', (select id from public.itens_pedido limit 1)), 'acesso', 'não bipa na separação');
select teste.deve_falhar(format('select public.alterar_status_remessa(%s, ''concluida'')', :rem_sup), 'apenas supervisores', 'não conclui remessa');
select teste.deve_falhar(format('select public.atualizar_divergencia(%s, ''resolvida'', ''x'')', coalesce((select id from public.divergencias limit 1), 0)), 'apenas supervisores', 'não resolve divergência');
select teste.deve_falhar('insert into public.lojas (nome) values (''Loja do Visualizador'')', 'row-level security', 'não cadastra loja');
select teste.deve_falhar('select * from public.usuarios_das_lojas()', 'apenas owner ou administrador', 'não lista acessos');
update public.lojas set nome = 'Hackeada' where numero = 1;
reset role;
select teste.igual((select count(*) from public.lojas where nome = 'Hackeada'), 0::bigint, 'update direto não altera nada');

\echo '--- remover um vínculo: painel, detalhes e totais passam a ver só a Loja 01'
delete from public.visualizador_lojas where usuario_id = '00000000-0000-0000-0000-0000000000e1'
   and loja_id = (select id from public.lojas where numero = 2);
set role authenticated;
select teste.como('00000000-0000-0000-0000-0000000000e1');
select teste.igual((select array_agg(numero order by numero) from public.lojas), array[1], 'sobrou só a Loja 01');
select teste.igual((select array_agg(distinct loja_numero) from public.v_loja_pedidos), array[1], 'pedidos só da Loja 01');
select sum(qtd_pedido) as vis_rem1 from public.v_remessas where codigo = 'REM-TESTE' \gset
select teste.igual((select count(*) from public.v_loja_itens where loja_id <> (select id from public.lojas where numero = 1)), 0::bigint, 'itens só da Loja 01');
reset role;
select teste.igual(:vis_rem1::bigint,
  (select sum(i.qtd_pedido) from public.itens_pedido i join public.pedidos p on p.id = i.pedido_id join public.remessas r on r.id = p.remessa_id join public.lojas l on l.id = p.loja_id
    where r.codigo = 'REM-TESTE' and l.numero = 1),
  'total da remessa recalculado só com a Loja 01');

\echo '--- sem nenhum vínculo: sem dados'
delete from public.visualizador_lojas where usuario_id = '00000000-0000-0000-0000-0000000000e1';
set role authenticated;
select teste.como('00000000-0000-0000-0000-0000000000e1');
select teste.igual((select count(*) from public.lojas) + (select count(*) from public.pedidos) + (select count(*) from public.remessas)
                   + (select count(*) from public.expedicoes) + (select count(*) from public.divergencias), 0::bigint, 'conta sem vínculos não vê nada');
select teste.como('00000000-0000-0000-0000-0000000000e3');
select teste.igual((select count(*) from public.v_loja_pedidos), 0::bigint, 'visualizador criado sem loja não vê nada');

\echo '--- Global MINISO'
select teste.como('00000000-0000-0000-0000-0000000000e2');
select count(*) as glob_lojas from public.lojas \gset
select teste.igual((select count(*) from public.lojas where id = :loja_outra), 0::bigint, 'loja de outra rede fica fora');
select teste.igual((select count(*) from public.pedidos where nome = 'PED-X'), 0::bigint, 'pedido de outra rede fica fora');
select sum(qtd_pedido) as glob_outra from public.v_remessas where codigo = 'REM-OUTRA' \gset
select teste.deve_falhar('insert into public.lojas (nome) values (''Loja Global'')', 'row-level security', 'global também é só leitura');
reset role;
select teste.igual(:glob_lojas::bigint, (select count(*) from public.lojas where rede = 'MINISO'), 'vê todas as lojas MINISO, inclusive as cadastradas depois');
select teste.igual(:glob_outra::bigint, 3::bigint, 'na remessa mista soma só o que é MINISO');
select teste.igual((select count(*) from public.v_loja_pedidos), (select count(*) from public.pedidos), 'superusuário vê tudo (controle)');

\echo '--- conta inativa e troca de perfil'
set role authenticated;
select teste.como('00000000-0000-0000-0000-0000000000e4');
select teste.igual((select count(*) from public.lojas), 0::bigint, 'visualizador inativo não vê nada');
reset role;
insert into public.visualizador_lojas (usuario_id, loja_id) select '00000000-0000-0000-0000-0000000000e3', id from public.lojas where numero = 1;
update public.perfis set papel = 'supervisor', escopo_visualizador = null where login = 'vis0';
select teste.igual((select count(*) from public.visualizador_lojas where usuario_id = '00000000-0000-0000-0000-0000000000e3'), 0::bigint, 'deixou de ser visualizador: vínculos removidos');

\echo '--- anônimo não executa nada novo'
select teste.igual(has_function_privilege('anon', 'public.eh_administrador()', 'execute'), false, 'anon sem eh_administrador');
select teste.igual(has_function_privilege('anon', 'public.lojas_do_visualizador()', 'execute'), false, 'anon sem lojas_do_visualizador');
select teste.igual(has_table_privilege('anon', 'public.visualizador_lojas', 'select'), false, 'anon sem leitura de vínculos');
select teste.igual(has_table_privilege('authenticated', 'public.visualizador_lojas', 'insert'), false, 'ninguém grava vínculo direto');

\echo 'TESTES DE PERFIS PASSARAM'
