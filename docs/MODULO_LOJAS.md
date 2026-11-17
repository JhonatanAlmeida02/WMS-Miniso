# Módulo das lojas: painel, expedição e conferência de recebimento

Implementação da especificação em [`README_MINISO_CLAUDE_CODE.md`](README_MINISO_CLAUDE_CODE.md).
Está na mesma aplicação e no mesmo banco do PRODIGY WMS e não muda nada para quem já usa.

| Painel da loja | Conferência no coletor | Expedição (PRODIGY) |
|---|---|---|
| ![Painel da loja](modulo-lojas/painel-loja.png) | ![Conferência](modulo-lojas/conferencia-coletor.png) | ![Expedição](modulo-lojas/expedicao.png) |

## Decisões

- **Continuam só dois perfis: `supervisor` e `operador`.** O administrador da loja é um
  **operador com loja vinculada** (`perfis.loja_id`). Ao entrar, ele vai direto para o painel da
  própria loja e não alcança as telas do CD.
- **O isolamento é feito no banco, e não só na tela.** `usuario_ativo()` passou a valer apenas para a
  equipe interna (perfil sem loja). Assim, todas as políticas e funções que já existiam recusam o
  usuário de loja. A leitura da própria loja vem de políticas novas, baseadas em
  `loja_do_usuario()`, que lê a loja do banco e nunca do navegador.
- **A habilitação é por loja** (`lojas.modulo_loja`). Enquanto o acesso estiver desligado, o usuário
  daquela loja não vê nada, mesmo logado.
- **Expedição:** o supervisor registra a saída do que foi separado e ainda não expedido. O manifesto
  (`expedicao_itens`) fica congelado. Um pedido pode ter várias entregas.
- **Recebimento:** a loja confere cada entrega contra o manifesto dela, não contra o pedido inteiro.
  Avaria é marcada na leitura e conta como recebida (físico = íntegro + avariado), mas gera uma
  ocorrência própria. Um GTIN que não estava no manifesto vira ocorrência "não esperado" e não entra
  no pedido.
- **Toda escrita passa por função transacional, com identificador de operação.** Reenviar a mesma
  operação não duplica nada; duas leituras reais do mesmo GTIN contam duas unidades. A bipagem e a
  finalização usam a mesma trava, então nada é gravado depois do fechamento.
- **Reabertura:** só o supervisor reabre, e precisa informar o motivo. A reabertura cria uma nova
  revisão; a contagem anterior e as divergências dela continuam no histórico. A resolução de uma
  divergência registra a solução sem alterar as quantidades.

## O que mudou nas telas existentes (mínimo)

| Arquivo | Mudança |
|---|---|
| `src/components/Layout.tsx` | Item de menu **Expedição**; `LayoutLoja` (mesmo layout, menu da loja); o `Protegido` manda o usuário de loja para `/loja` |
| `src/main.tsx` | Rotas novas (`/expedicao…`, `/loja…`) |
| `src/pages/Usuarios.tsx` + `supabase/functions/usuarios` | Campo **Onde trabalha** (Equipe PRODIGY ou Administrador da loja X) |
| `Painel.tsx`, `Distribuicao.tsx`, `ConferenciaFisica.tsx` | A equipe do CD exclui os usuários de loja |
| `src/lib/tipos.ts`, `useConsulta.ts` | Tipos novos e tabelas de tempo real |

A conferência da loja (`src/pages/loja/ConferirRecebimento.tsx`) usa o mesmo layout, campo de
leitura, multiplicador, sons, vibração, cartão do último bip e lista de leituras da conferência do CD.
A única adição é o botão **Avaria**. O `Conferir.tsx` original **não foi alterado**, para não mexer no
que está em produção. Em uma etapa posterior, as duas telas podem passar a usar um componente único.

## Ativação (homologação primeiro)

1. **Aplique a migração antes de publicar o front.** As telas novas consultam tabelas e visões que
   só existem depois dela:
   `supabase/migrations/20261117120000_modulo_lojas.sql` (`npx supabase db push` ou SQL Editor).
   A migração é aditiva e não apaga nem reescreve dados. Nenhuma loja fica habilitada e nenhum
   usuário fica vinculado.
2. Publique a função de usuários atualizada: `npx supabase functions deploy usuarios`.
3. Publique o front (merge na branch usada pelo Render).
4. Em **Usuários**, crie o administrador de cada loja: Perfil **Operador** e, em Onde trabalha,
   **Administrador da loja XX**. Cada pessoa tem o próprio login; não use conta compartilhada.
5. Em **Expedição → Acesso das lojas**, habilite as lojas piloto (2 lojas) e depois as demais.
6. Rotina: separação e conferência do CD como hoje → **Expedição → Expedir** (informe os volumes) →
   a loja confere em **Entregas** → o supervisor acompanha **Recebimentos** e **Divergências**.

Pedidos antigos, sem expedição registrada, não aparecem como entregas para conferir. O separado
nunca vira expedido de forma automática.

## Desligar o módulo (rollback funcional)

- **Uma loja:** desmarque a loja em **Expedição → Acesso das lojas**. O acesso é cortado na hora e
  nada é apagado.
- **Uma pessoa:** desative o usuário em **Usuários**. O banco não deixa tirar a loja de um usuário
  (ele viraria equipe interna).
- **Tudo:** desligue todas as lojas. Não é preciso desfazer a migração, e não se deve fazer isso: o
  histórico de expedição e recebimento fica preservado.

## Testes

```bash
npm run test:sql
```

Esse comando roda em um Postgres local descartável (`wms_teste`), sem Docker e sem tocar em nenhum
projeto Supabase. O arquivo `tests/sql/00_stub_supabase.sql` simula o mínimo do Supabase (papéis,
`auth.uid()`, publicação). O comando aplica **todas** as migrações e cobre:

- isolamento entre lojas (pedidos, itens, remessas, perfis, bips, expedições, confronto, funções);
- usuário de loja barrado na separação, na conferência do CD, na expedição, na importação, na
  distribuição e na escrita direta;
- os cenários de quantidade da especificação (falta 2; entrega parcial sem falta; avaria sem falta;
  sobra; GTIN inesperado);
- repetição de requisição (retry), estorno, finalização repetida, reabertura com motivo e
  histórico;
- usuário desativado e loja desligada perdendo o acesso com a sessão aberta;
- regressão: equipe interna e conferência do CD funcionando como antes;
- concorrência: 5 aparelhos bipando com retry (sem perda e sem duplicação) e bipagem durante a
  finalização (nada é gravado depois do fechamento).

## Pendências reais

- `npm run test:db` e `npm run test:e2e` (os testes que já existiam) precisam do Supabase local
  com Docker e não foram rodados neste ambiente.
- O `.env.development` continua apontando para o projeto de produção, como antes. Para desenvolver
  e testar este módulo, crie um `.env.development.local` apontando para um Supabase local ou de
  homologação.
- Ficaram fora deste release: volumes identificados individualmente (QR por caixa), anexos/fotos de
  divergência, recebimento no CD e MFA. A especificação trata esses itens como evoluções.
- Latência em rede e coletores reais ainda não foi medida.
