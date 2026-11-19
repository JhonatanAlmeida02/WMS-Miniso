# Perfis e permissões: como está implementado

Especificação: [README_ROLES_WMS_MINISO.md](README_ROLES_WMS_MINISO.md).
Migrações: `20261120120000_papeis_novos.sql` (valores do enum) e
`20261120120100_perfis_permissoes.sql` (regras). Testes: `tests/sql/20_perfis.test.sql`.

## Perfis

| Perfil | `perfis.papel` | Tela inicial | Menu |
|---|---|---|---|
| Owner | `owner` | Painel | Tudo |
| Administrador | `administrador` | Painel | Tudo |
| Supervisor | `supervisor` | Painel | Sem **Cadastros** (Usuários, Lojas) e sem a aba **Usuários e acesso** de Lojas MINISO |
| Operador | `operador` | Início do operador | Separar e Conferir (como antes) |
| Visualizador | `visualizador` | Visão da rede | Só **Visão da rede** (painel da loja e pedido, sem exportar) |

Usuários das lojas não mudam: continuam `operador` com `perfis.loja_id` e `admin_loja`.

## Onde a regra fica

Banco (vale para tela, API e endereço digitado):

- `eh_supervisor()` agora é "supervisão ou acima" (owner, administrador, supervisor). Todas as funções de remessa, distribuição, conferência, expedição, recebimento e divergência seguem com a mesma checagem.
- `eh_administrador()` (owner/administrador): cadastro de lojas (inserir, editar, excluir, ligar o acesso da loja) e `usuarios_das_lojas()`.
- `usuario_ativo()` deixa o visualizador de fora: nenhuma política ou função antiga o aceita.
- `lojas_do_visualizador()` devolve as lojas do escopo; políticas novas de leitura usam isso em lojas, remessas, pedidos, itens, conferências do CD, expedições, recebimentos e divergências. Log de bips e auditoria ficam fora.
- As visões são `security_invoker`: numa remessa com várias lojas, os totais somam só as linhas autorizadas.
- `perfis_manter_owner`: o banco recusa desativar, rebaixar ou excluir o último owner ativo.

Funções do servidor:

- `usuarios`: só owner e administrador. Administrador concede supervisor, operador e visualizador; só o owner concede administrador. A conta owner só é alterada por ela mesma. Ninguém muda o próprio perfil nem se desativa.
- `usuarios-loja`: a parte da PRODIGY passou de supervisor para owner/administrador. O administrador da loja continua cadastrando os conferentes da própria loja.

## Escopo do visualizador

- `perfis.escopo_visualizador`: `lojas` ou `global_miniso`, obrigatório para visualizador (e só para ele).
- `visualizador_lojas`: lojas atribuídas ao escopo "por loja". Sem nenhuma loja, a conta entra e não vê dados.
- `lojas.rede` (padrão `MINISO`): o Global MINISO cobre as lojas da rede MINISO, inclusive as cadastradas depois. Loja de outra rede fica fora.
- Exportação: o botão não aparece para o visualizador. Os dados que ele lê já são só os do escopo.

## Transição

A migração dá `owner` à conta `jhonatan` no mesmo passo em que tira do supervisor a gestão de contas, para nunca ficar sem dono. IDs e histórico não mudam. `caio.log` segue supervisor; `operador-01` a `04` seguem operadores. As contas de loja `test1`, `teste`, `teste02` e `teste04` não foram alteradas: revisar à parte. As contas dos donos (MINISO e PRODIGY) são criadas pela tela Usuários, como Visualizador Global MINISO.
