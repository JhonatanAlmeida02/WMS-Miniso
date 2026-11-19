-- =============================================================================
-- Perfis da PRODIGY: Owner, Administrador e Visualizador (além de Supervisor e
-- Operador). Só os valores novos do tipo; o uso vem na migração seguinte,
-- porque o Postgres não deixa usar um valor novo de enum na mesma transação.
-- Especificação: docs/README_ROLES_WMS_MINISO.md (implementação: docs/PERFIS_E_PERMISSOES.md)
-- =============================================================================
alter type public.papel_usuario add value if not exists 'owner';
alter type public.papel_usuario add value if not exists 'administrador';
alter type public.papel_usuario add value if not exists 'visualizador';
