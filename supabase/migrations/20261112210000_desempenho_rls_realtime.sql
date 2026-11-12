-- Desempenho com remessas grandes (19 lojas, ~4.000 linhas):
--
-- 1) As regras de leitura chamavam usuario_ativo() uma vez POR LINHA. Com
--    "(select ...)" o Postgres avalia uma vez por consulta.
-- 2) Tempo real: itens_pedido sai da publicação. Toda alteração de item vem de
--    registrar_bip, que também grava em bips; as telas escutam bips e
--    recarregam. Metade das mensagens de tempo real (cota do plano Free).

drop policy "ativos leem perfis"   on public.perfis;
drop policy "ativos leem lojas"    on public.lojas;
drop policy "ativos leem remessas" on public.remessas;
drop policy "ativos leem pedidos"  on public.pedidos;
drop policy "ativos leem itens"    on public.itens_pedido;
drop policy "ativos leem bips"     on public.bips;

create policy "ativos leem perfis"   on public.perfis       for select to authenticated using ((select public.usuario_ativo()) or id = (select auth.uid()));
create policy "ativos leem lojas"    on public.lojas        for select to authenticated using ((select public.usuario_ativo()));
create policy "ativos leem remessas" on public.remessas     for select to authenticated using ((select public.usuario_ativo()));
create policy "ativos leem pedidos"  on public.pedidos      for select to authenticated using ((select public.usuario_ativo()));
create policy "ativos leem itens"    on public.itens_pedido for select to authenticated using ((select public.usuario_ativo()));
create policy "ativos leem bips"     on public.bips         for select to authenticated using ((select public.usuario_ativo()));

drop policy "supervisor cria lojas"    on public.lojas;
drop policy "supervisor edita lojas"   on public.lojas;
drop policy "supervisor exclui lojas"  on public.lojas;
drop policy "supervisor edita remessa" on public.remessas;

create policy "supervisor cria lojas"    on public.lojas    for insert to authenticated with check ((select public.eh_supervisor()));
create policy "supervisor edita lojas"   on public.lojas    for update to authenticated using ((select public.eh_supervisor())) with check ((select public.eh_supervisor()));
create policy "supervisor exclui lojas"  on public.lojas    for delete to authenticated using ((select public.eh_supervisor()));
create policy "supervisor edita remessa" on public.remessas for update to authenticated using ((select public.eh_supervisor())) with check ((select public.eh_supervisor()));

-- Índices que as telas usam com remessas grandes
create index if not exists itens_pedido_pedido_idx on public.itens_pedido (pedido_id);
create index if not exists pedidos_remessa_idx on public.pedidos (remessa_id);
create index if not exists bips_operador_idx on public.bips (operador_id, criado_em desc);

alter publication supabase_realtime drop table public.itens_pedido;
