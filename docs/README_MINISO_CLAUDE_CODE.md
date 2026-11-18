# PRODIGY WMS — extensão MINISO para conferência nas lojas

Especificação de desenvolvimento para Claude Code ou equipe de engenharia.
Data: 17/11/2026. Estado: requisitos para implementação; não representa funcionalidade já entregue.

## 1. Objetivo e regra principal

Evoluir o projeto existente https://github.com/JhonatanAlmeida02/tiny-Wms adicionando o serviço de recebimento e conferência nas 19 lojas MINISO, com painel individual de acompanhamento da separação.

**Manter o PRODIGY original: identidade visual, login, navegação, funcionalidades, dados, separação, conferência no CD e painel central. Acrescentar o novo módulo à mesma aplicação.**

Não criar 19 aplicações, 19 bancos ou uma reescrita do WMS. Não substituir o README original por este documento: adicionar esta especificação em `docs/README_MINISO_CLAUDE_CODE.md` e inserir apenas um link no README principal durante a implementação.

O que muda para a loja: ao entrar com sua conta pessoal, o administrador vê o painel de sua loja, acompanha a separação feita pela PRODIGY e confere a mercadoria quando chega.

O que muda para a PRODIGY: além das funções atuais, acompanha expedições, recebimentos e divergências por loja. A separação continua no CD.

## 2. Instrução de execução para Claude Code

1. Ler as instruções locais do repositório e inspecionar o código atual antes de alterar arquivos.
2. Identificar os componentes, funções SQL, políticas RLS e testes existentes. Os caminhos deste documento são referências observadas, não garantia de que a branch continua igual.
3. Implementar de forma incremental, em branch de trabalho, preservando contratos usados pelo WMS atual.
4. Criar migrações novas e aditivas. Não editar migrações já aplicadas, recriar o banco ou apagar dados.
5. Reutilizar componentes de interface e a infraestrutura existente. Não adicionar outro backend, framework ou provedor de autenticação sem necessidade demonstrada.
6. Desenvolver e testar com banco local/homologação, nunca com dados de produção por padrão.
7. Entregar código, migrações, políticas, testes, instruções de ativação e relatório do que foi validado. Não declarar testes como executados sem executá-los.
8. Implementar o escopo obrigatório abaixo. Integrações externas, estoque permanente das lojas e ERP ficam fora do escopo inicial.

## 3. Base existente e pontos de atenção

Na análise realizada, o projeto usa React, TypeScript, Vite e Tailwind, com Supabase Auth, PostgreSQL, funções SQL e Realtime. Já possui importação de Excel/CSV, remessas, pedidos por loja, distribuição, bipagem, conferência física e estatísticas.

Referências para inspeção:

| Arquivo/área | Reaproveitamento esperado |
|---|---|
| `src/components/ConferenciaFisica.tsx` | Componente base da experiência de conferência |
| `src/pages/Conferir.tsx` | Fluxo atual de conferência |
| `src/pages/Painel.tsx` | Padrões visuais e indicadores |
| `src/components/Confronto.tsx` | Comparação de quantidades |
| `src/components/Layout.tsx` | Navegação e estrutura visual |
| `src/lib/auth.tsx` e `src/lib/tipos.ts` | Sessão, perfis e tipos |
| `supabase/functions/usuarios/index.ts` | Gestão de usuários no servidor |
| `supabase/migrations/` | Esquema, transações e permissões |
| `tests/` | Regressão, integração, concorrência e E2E |

As políticas de leitura examinadas permitem consultas amplas a usuários ativos. Antes de habilitar contas de loja, restringir explicitamente essas políticas: um usuário de loja ativo não pode herdar a leitura global da equipe PRODIGY. Políticas permissivas são combinadas; adicionar uma política restrita sem remover/substituir a ampla não resolve o isolamento.

O README examinado também informa uso de produção por padrão em desenvolvimento. Corrigir a configuração para impedir gravações acidentais durante desenvolvimento e testes.

Essa análise não é auditoria completa do ambiente publicado; validar o estado atual do repositório e do esquema em homologação.

## 4. Arquitetura

- Uma aplicação PRODIGY WMS e um banco compartilhado para esta operação.
- Login individual pelo Supabase Auth; nunca conta/senha compartilhada por loja.
- Acesso por perfil e vínculo de usuário com loja.
- PRODIGY mantém visão central; loja acessa somente seus registros.
- `loja_id` pertence ao pedido/expedição; os registros filhos herdam esse escopo por relações verificadas no banco.
- Não confiar no filtro de tela, parâmetro de URL ou `loja_id` enviado pelo navegador para autorizar acesso.
- Usar RPCs transacionais para bipagem, finalização, expedição, estorno e resolução de divergências.
- Não habilitar novos usuários de loja antes de concluir testes de isolamento de todas as rotas de acesso.

Links como `/loja/painel` e `/loja/recebimentos` são propostas de rota; adaptar à organização atual. Usuário com várias lojas só pode alternar entre vínculos autorizados. Usuário com uma loja entra diretamente nela.

## 5. Perfis e permissões

Preservar os papéis internos existentes. Acrescentar os papéis necessários sem fazer usuários de loja se passarem por supervisores PRODIGY.

| Perfil | Leitura | Escrita |
|---|---|---|
| Administrador PRODIGY | Operação completa | Configurações, usuários e vínculos autorizados |
| Supervisor PRODIGY | Todas as lojas e operação | Fluxo atual, expedição e resolução de ocorrências |
| Operador PRODIGY | Escopo interno existente autorizado | Separação atribuída, conforme regras atuais |
| Conferente PRODIGY | Escopo interno existente autorizado | Conferência de saída atribuída |
| Administrador da loja | Painel, pedidos, expedições e recebimentos de suas lojas | Iniciar/concluir conferência de recebimento e registrar divergências |
| Conferente da loja | Entregas e tarefas autorizadas de suas lojas | Bipagem de recebimento e registro de divergências |

No MVP, cadastro e concessão de acesso ficam com a PRODIGY. O administrador da loja não pode atribuir papéis, tornar-se supervisor, cadastrar vínculos com outras lojas ou alterar pedidos, separação, expedição e conferência de saída.

## 6. Fluxo operacional

1. PRODIGY importa e valida remessa/pedidos utilizando o fluxo atual.
2. PRODIGY recebe os produtos no CD e registra disponibilidade e divergências de entrada quando o controle de recebimento for habilitado.
3. Supervisor distribui as tarefas; operadores separam para as lojas conforme o WMS atual.
4. PRODIGY realiza sua conferência de saída com a interface atual.
5. PRODIGY identifica volumes e registra expedição por loja, congelando a composição efetivamente enviada.
6. Administrador da loja acompanha separação e envio no painel.
7. Na chegada, a loja identifica a entrega/volume e inicia sua própria conferência usando a mesma interface da PRODIGY.
8. A loja bipa os itens recebidos e registra avarias, sobras, faltas e produtos incorretos.
9. Ao finalizar, o sistema compara pedido original, expedido e recebido, preservando todos os valores.
10. Sem diferenças: recebido conferido. Com diferenças: recebido com divergência; PRODIGY acompanha e registra resolução.

O andamento é por pedido, expedição e recebimento da loja. A conclusão de uma loja não conclui automaticamente as demais. O status atual da remessa PRODIGY mantém seu significado; adicionar status de entrega separados, sem redefinir silenciosamente `concluida`.

Entregas parciais: um pedido pode gerar várias expedições. A conferência compara o recebido com o manifesto daquela expedição, não com o pedido inteiro. O painel mostra o saldo ainda não expedido e as entregas restantes.

## 7. Conferência: mesma tela para todos

**Requisito obrigatório: a conferência da loja deve ter o mesmo layout, componentes, campos de leitura, botões, lista, sons, feedbacks e comportamento de coletor da conferência PRODIGY. Não criar uma segunda experiência visual.**

Reaproveitar o componente atual por composição/adaptadores. Se for necessária uma extração de lógica, preservar a aparência e o funcionamento original com testes de regressão. Evitar copiar uma página inteira e manter duas implementações divergentes.

Contrato conceitual, a adaptar ao código real:

```ts
type ContextoConferencia =
  | { tipo: 'saida_cd'; conferenciaId: number }
  | { tipo: 'recebimento_loja'; recebimentoId: string };

// A interface é compartilhada; o adaptador escolhe as consultas e operações.
// O contexto enviado pelo cliente não substitui autorização no banco.
```

Diferenças necessárias de contexto:

| Aspecto | Conferência PRODIGY | Conferência na loja |
|---|---|---|
| Origem do esperado | Pedido/separação, conforme fluxo atual | Manifesto imutável da expedição |
| Destino das bipagens | Tabelas atuais de conferência de saída | Novas tabelas de recebimento da loja |
| Identificação | Remessa, loja e tarefa | Remessa, loja, expedição e volume |
| Efeito da finalização | Comportamento atual de saída | Recebido conferido ou com divergência |

Na loja, aceitar registro de sobra/produto inesperado como ocorrência rastreável, sem acrescentá-lo ao pedido original. Item desconhecido mantém código lido e motivo para análise; não cadastrar produto automaticamente por uma leitura desconhecida.

A sugestão anterior de conferência cega é opcional. **Não habilitar contagem cega apenas nas lojas se isso tornar a experiência diferente da PRODIGY.** No primeiro release, manter o comportamento visual atual; uma política de contagem cega futura deve ser consistente no componente compartilhado.

## 8. Painel do administrador da loja

O administrador acompanha a separação feita pela PRODIGY para a própria loja, desde o pedido até o recebimento. Usar os mesmos padrões de cartões, tabelas, tipografia e cores do painel PRODIGY.

Indicadores obrigatórios:

- Pedidos/remessas ativos da loja.
- Quantidade pedida, separada, conferida no CD, expedida e recebida.
- Percentual de separação: unidades separadas / unidades pedidas × 100; para denominador zero exibir “Sem itens”.
- Quantidade de volumes expedidos, recebidos e pendentes.
- Entregas aguardando conferência, em conferência, finalizadas e com divergência.
- Pendências por produto: pedido menos separado; saldo a expedir separado do saldo a receber.

Tabela por pedido/remessa com código, datas, progresso, situação, totais e ação “Ver detalhes”. Dentro dos detalhes, produtos e quantidades, expedições parciais, volumes e histórico de recebimento. A ação “Conferir recebimento” só aparece para entrega expedida e usuário autorizado.

Filtros: remessa, pedido, período, situação e produto. CSV/exportações, se disponibilizados, seguem as mesmas permissões do painel.

Não expor dados de outras lojas, ranking global de operadores, cadastro completo de usuários ou informações administrativas internas. Informações de funcionários devem ser mínimas e pertinentes.

Realtime apenas para dados autorizados; atualizar a consulta relevante sem recarregar o aplicativo inteiro. Mostrar última atualização e estado de conexão. Usar atualização manual/polling controlado como fallback, sem tratar Realtime como fonte de verdade.

## 9. Modelo de dados incremental

Manter `perfis`, `lojas`, `remessas`, `pedidos`, `itens_pedido`, `bips`, `conferencias` e `conferencia_bips`. Nunca reutilizar a conferência de saída como conferência da loja.

Os nomes seguintes são propostos; ajustar à convenção existente. FKs para tabelas atuais devem usar os tipos reais atuais. Novas entidades podem usar UUID, timestamps `timestamptz` e autoria baseada em `auth.uid()`.

| Nova entidade | Campos/relações essenciais |
|---|---|
| `usuario_lojas` | `usuario_id`, `loja_id`, papel local, ativo; vínculo único por usuário/loja |
| `expedicoes` | ID, loja, remessa, referência, status, datas, criado/expedido por |
| `expedicao_itens` | Expedição, item do pedido, GTIN/descrição congelados, quantidade expedida |
| `volumes` | Expedição, identificador único legível/QR, situação |
| `volume_itens` | Volume, item da expedição, quantidade |
| `recebimentos_loja` | Expedição, estado, início/fim, responsável e revisão |
| `recebimento_loja_bips` | Recebimento, volume, item ou código inesperado, quantidade, condição, autor, horário, operação única, referência de estorno |
| `recebimento_loja_itens` | Totais por recebimento/item, derivados de eventos ou mantidos na mesma transação |
| `divergencias` | Recebimento/item, tipo, quantidades, descrição, estado, responsável/resolução |
| `divergencia_anexos` | Divergência, caminho privado, MIME, tamanho e autor |
| `auditoria` | Ator, ação, entidade, valores relevantes antes/depois, motivo e horário |

Controles adicionais de entrada, quando habilitados: `recebimentos_cd` e `recebimento_cd_itens`, com recebido, avariado e liberado por produto/remessa. Fazer essa evolução de forma opt-in para novas remessas; não bloquear remessas antigas que não possuem dados de recebimento.

Restrições obrigatórias:

- SKU/GTIN são texto, mantendo zeros à esquerda.
- Quantidades inteiras em unidades; conversão de caixa só com fator de embalagem explícito. Não adivinhar fator pelo código.
- Volume pertence a uma única expedição e loja; itens devem pertencer a pedidos dessa mesma loja/remessa. Validar com FKs compostas ou validações transacionais equivalentes.
- Soma dos volumes precisa reconciliar com o manifesto antes da saída.
- Total expedido em todas as entregas de um item não pode ultrapassar o saldo elegível conferido. Travar os registros envolvidos em concorrência.
- Manifesto fica imutável após expedição. Correções posteriores são eventos/versionamento auditado, nunca edição silenciosa do histórico.
- Totais recebidos preservam avariado e íntegro separadamente. Total físico = íntegro + avariado; não contar uma unidade duas vezes.
- Diferença física = recebido físico − expedido. Avaria é uma ocorrência adicional, mesmo quando a diferença física é zero.
- Uma entrega tem um recebimento lógico; recontagens são revisões/tentativas auditadas. Garantir unicidade da sessão ativa conforme a política implementada.
- Índices por loja, remessa, pedido, expedição, recebimento, estado e data, conforme consultas reais.
- Eventos/auditoria não podem ser apagados por usuários operacionais. Histórico com referências deve usar exclusão restrita, não cascata destrutiva.

## 10. Estados e transações

Estados sugeridos de expedição: `rascunho` → `expedida`. Cancelamento somente antes de expedir; retorno posterior é ocorrência própria. Não inventar rastreamento de transportadora: “expedida” significa saída registrada.

Estados de recebimento: `aguardando` → `em_conferencia` → `recebido_conferido` ou `recebido_com_divergencia`. Resolução de divergência tem ciclo separado: `aberta` → `em_analise` → `resolvida`.

Reabertura exige autorização, motivo e nova revisão; mantém os eventos anteriores. Ocorrência resolvida não apaga a divergência histórica nem muda as quantidades originais para fingir igualdade.

RPCs propostas (nomes adaptáveis):

| Operação | Garantias no servidor/banco |
|---|---|
| `obter_painel_loja` | Agregações somente do escopo autorizado; preferir invoker/RLS |
| `expedir_pedido` | Perfil PRODIGY, saldo, volumes completos, locks e manifesto atômico |
| `iniciar_recebimento_loja` | Expedição válida, vínculo ativo e prevenção de sessões duplicadas |
| `registrar_bip_recebimento` | Usuário/loja/volume corretos, estado aberto, quantidade e idempotência |
| `estornar_bip_recebimento` | Referência ao evento, motivo, autorização e saldo não negativo |
| `finalizar_recebimento_loja` | Lock da sessão, totais consistentes e divergências geradas atomicamente |
| `reabrir_recebimento_loja` | Permissão elevada, motivo obrigatório e revisão auditada |
| `resolver_divergencia` | PRODIGY autorizada, solução registrada sem editar histórico |

Cada comando de escrita tem identificador de operação criado uma vez no cliente e reaproveitado em retries. Repetir a mesma operação retorna o resultado já gravado; mesmo identificador com payload diferente gera erro. Nova leitura física recebe novo identificador: não deduplicar por GTIN/horário, pois duas unidades iguais são leituras válidas.

Todas as mutações verificam sessão, conta ativa, papel, loja, estado e relações. Finalização e bipagem concorrentes precisam compartilhar a estratégia de lock para impedir gravação após encerramento.

Sem internet: mostrar estado de conexão e não dar confirmação verde de gravação. MVP online, sem sincronização offline automática. Se uma resposta se perder, repetir com o mesmo identificador antes de assumir sucesso ou pedir uma nova leitura.

## 11. Segurança

- Supabase Auth para senhas; não armazenar senha em tabelas, logs ou código.
- Cadastro público desabilitado; convite/gestão controlados pela PRODIGY.
- MFA para perfis administrativos; configurar recuperação segura e limitação de tentativas.
- Desativação de usuário/vínculo deve bloquear imediatamente operações no banco mesmo com token ainda válido.
- `service_role` somente no servidor; nenhuma chave privilegiada com prefixo `VITE_` ou no bundle.
- Negar acesso anônimo. Aplicar RLS a tabelas novas e revisar as antigas, views, RPCs, exportações, Storage e Realtime.
- Views com comportamento de invocador quando apropriado; funções `SECURITY DEFINER` exigem checagem explícita, `search_path` fixo e grants mínimos.
- Papel/vínculo não pode vir de metadado editável pelo próprio usuário.
- Anexos em bucket privado; acesso autorizado e URLs temporárias. Validar formato, tamanho e tipo no servidor; impedir acesso cruzado por caminho.
- HTTPS, proteção contra XSS, dependências revisadas e segredos fora do Git.
- Backups e restauração testada; retenção de dados, fotos e auditoria definida com a empresa.
- Logs de falhas sem tokens, senhas ou conteúdo pessoal desnecessário.

Referências técnicas para o implementador consultar na versão atual:

- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/auth
- https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

Este documento define controles e critérios; não certifica conformidade integral. Validar requisitos corporativos MINISO/PRODIGY e políticas aplicáveis antes de produção.

## 12. Compatibilidade e ativação

1. Registrar baseline de telas, funções e testes do PRODIGY atual.
2. Criar banco de homologação com dados sintéticos representativos das 19 lojas.
3. Aplicar novas tabelas, funções e políticas sem conceder contas de loja inicialmente.
4. Fazer backfill apenas de vínculos aprovados; nunca conceder acesso global por padrão.
5. Introduzir módulo com habilitação controlada por loja no servidor. Flag de interface não substitui autorização.
6. Reutilizar a tela de conferência com adapter, mantendo o fluxo antigo como padrão.
7. Validar 2 lojas e depois expandir para 19.
8. No rollback funcional, desabilitar o módulo novo e preservar seus dados; não desfazer endurecimento de segurança nem excluir histórico.

Pedidos históricos sem manifesto não devem aparecer como entregas prontas para conferência. Disponibilizar consulta histórica conforme permissão; habilitar recebimento apenas com expedição real registrada. Não converter automaticamente quantidade separada em expedida.

Recebimento no CD, alocação por disponibilidade e gestão avançada de volumes são evoluções compatíveis; implementar apenas as partes mínimas necessárias ao manifesto e à conferência de entrega no primeiro release. Um volume único identificado por expedição é aceitável inicialmente se refletir a operação física; não inventar caixas fictícias.

## 13. Critérios de aceite e testes

- [ ] Todos os fluxos PRODIGY originais continuam funcionando, com identidade visual preservada.
- [ ] Conferência de CD e loja usam o mesmo componente/experiência visual, verificados em desktop e coletor.
- [ ] Administrador da Loja 01 acompanha sua separação, pedidos e recebimentos.
- [ ] Usuário da Loja 01 não acessa a Loja 02 por URL, SDK, REST, RPC, exportação, anexo ou Realtime.
- [ ] Administrador da loja não muda permissões nem altera pedido, separação ou saída do CD.
- [ ] Supervisor PRODIGY continua com visão central e recebe as divergências por loja.
- [ ] Pedido 20, expedido 20, recebido 18 gera falta de 2 sem alterar os dois primeiros valores.
- [ ] Pedido 20, primeira entrega 10, recebimento 10 não gera falta de 10; saldo a expedir permanece 10.
- [ ] Pedido/expedido 20, recebidos 18 íntegros e 2 avariados gera avaria de 2, sem falta física.
- [ ] Sobra e GTIN inesperado são registrados como ocorrências, sem modificar o pedido.
- [ ] Reenvio da mesma requisição não duplica bip; duas leituras reais do mesmo GTIN contam duas unidades.
- [ ] Bipagens simultâneas e finalização concorrente não perdem dados nem permitem gravação após fechamento.
- [ ] Usuário desativado ou removido da loja perde o acesso com sessão já aberta.
- [ ] Recebimento finalizado exige reabertura auditada para nova contagem.
- [ ] Entrega/volume de outra loja é rejeitado no banco.
- [ ] Agregações não multiplicam quantidades por joins entre bips, volumes e recebimentos.
- [ ] GTIN com zeros à esquerda mantém seu valor na importação, leitura e exportação.
- [ ] Migrações preservam registros e funcionamento de remessas históricas.
- [ ] Restauração de backup e desativação do módulo são documentadas/testadas em homologação.

Executar os comandos existentes adequados, incluindo build, testes de banco e E2E após ler `package.json`. Acrescentar cenários de isolamento e recebimento. Medir latência em rede/dispositivos reais; não usar resultados locais antigos como garantia de produção.

## 14. Entregáveis esperados

1. Extensão funcional na aplicação atual, com navegação por perfil.
2. Painel individual do administrador da loja.
3. Conferência de recebimento reutilizando a interface PRODIGY.
4. Manifesto/expedição, registros de recebimento e tratamento de divergências.
5. Migrações aditivas, RLS e funções transacionais.
6. Testes de regressão, isolamento, concorrência e idempotência.
7. Documentação de configuração, perfis, ativação por loja, backup e rollback funcional.
8. Relatório final com mudanças, validações executadas e pendências reais.

## 15. Prompt de início para Claude Code

> Implemente a extensão descrita neste documento no repositório tiny-Wms. Preserve o PRODIGY original, sua identidade visual e seus fluxos; acrescente o módulo MINISO na mesma aplicação e banco. Reutilize a tela de conferência da PRODIGY para a conferência de recebimento das lojas, com dados e permissões separados. Cada administrador de loja deve ter painel para acompanhar exclusivamente a separação e as entregas da própria loja. Inspecione o código atual, siga as instruções do repositório, implemente migrações aditivas e isolamento real por RLS/RPC, proteja retries e concorrência e execute testes relevantes. Não use produção para desenvolver e não substitua o README original por esta especificação. Entregue a implementação e as instruções de ativação, declarando exatamente o que foi testado.
