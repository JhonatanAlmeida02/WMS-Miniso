# Perfis e permissões do WMS Miniso

Especificação para implementação no [WMS-Miniso](https://github.com/JhonatanAlmeida02/WMS-Miniso). A proposta define cinco perfis internos da Prodigy e preserva os acessos operacionais das equipes de loja.

## 1. Perfis da Prodigy

| Perfil | Identificador proposto | Responsabilidade |
|---|---|---|
| Owner do WMS | `owner` | Acesso completo. Gerencia os administradores e controla a concessão de acesso administrativo. |
| Administrador | `administrador` | Acesso à operação e às configurações do WMS. Gerencia supervisores, operadores, visualizadores e acessos das lojas. |
| Supervisor | `supervisor` | Coordena a operação do centro de distribuição, da preparação da remessa ao acompanhamento das entregas. |
| Operador | `operador` | Usa **Separar** e **Conferir** nas tarefas atribuídas a ele. |
| Visualizador | `visualizador` | Consulta os painéis e relatórios das lojas autorizadas. |

## 2. Matriz de permissões

| Área ou ação | Owner | Administrador | Supervisor | Operador | Visualizador |
|---|---|---|---|---|---|
| Painel, relatórios e estatísticas | Consulta | Consulta | Consulta operacional | Andamento das próprias tarefas | Consulta no escopo atribuído |
| Log de bips e exportações operacionais existentes | Sim | Sim | Sim | — | — |
| Importar, ativar e concluir remessas | Sim | Sim | Sim | — | — |
| Atribuir operadores para separar ou conferir | Sim | Sim | Sim | — | — |
| Separar, corrigir leituras e finalizar conferência física no CD | Sim | Sim | Supervisão e execução quando atribuída | Tarefas atribuídas | — |
| Registrar expedição e acompanhar recebimento | Sim | Sim | Sim | — | Consulta no escopo atribuído |
| Resolver divergências e reabrir recebimentos | Sim | Sim | Sim | — | Consulta no escopo atribuído |
| Configurações administrativas e cadastro mestre de lojas | Sim | Sim | — | — | — |
| Gerenciar supervisores, operadores, visualizadores e acessos das lojas | Sim | Sim | — | — | — |
| Criar ou promover administradores | Sim | — | — | — | — |

A conclusão da **conferência física de uma loja** encerra a tarefa atribuída ao operador. A **conclusão da remessa inteira** é uma ação de supervisão. As regras de atribuição e correção de leituras continuam valendo para cada etapa.

## 3. Escopo do Visualizador

| Escopo | Dados disponíveis |
|---|---|
| **Por loja** | Painéis e relatórios de uma ou mais lojas atribuídas à conta. A seleção, os filtros e os totais respeitam esse conjunto. |
| **Global MINISO** | Todas as lojas MINISO e os dados da operação da Prodigy vinculados a elas, da separação no CD ao recebimento. Inclui o consolidado da rede. |

O Owner ou Administrador concede o escopo ao configurar a conta. **Global MINISO exige atribuição explícita.** Se uma conta com escopo por loja perder todos os vínculos, fica sem dados para consultar. Novas lojas MINISO entram no escopo global e precisam de atribuição explícita no escopo por loja.

### Contas executivas

| Pessoa | Conta no WMS | Visão |
|---|---|---|
| Dono da MINISO | Visualizador Global MINISO, login individual | CD da Prodigy na operação MINISO e todas as lojas da rede |
| Dono da Prodigy | Visualizador Global MINISO, login individual | A mesma visão executiva da operação MINISO |

O painel executivo cobre andamento das remessas, quantidades separadas, conferidas e expedidas no CD, volumes por loja, situação das entregas e divergências de recebimento. Os relatórios permitem filtrar por período, remessa e loja e comparar os resultados entre unidades. O acesso é de somente leitura, com exportação bloqueada por padrão. O **Owner do WMS** é a conta administrativa do sistema.

## 4. Equipe da loja MINISO

| Perfil da loja | Permissões |
|---|---|
| Administrador da loja | Consulta o painel da própria unidade, confere entregas e gerencia os conferentes da sua loja. O acesso inicial é concedido pela Prodigy. |
| Conferente da loja | Consulta o painel e as entregas da própria unidade. Registra leituras e finaliza a conferência de recebimento. |

O recebimento na loja e a conferência física no CD são tarefas distintas. Uma conta local da loja mantém seu vínculo com a própria unidade. O Visualizador por loja recebe um conjunto de lojas autorizado pela Prodigy.

## 5. Transição das contas atuais

Mapeamento proposto para as contas consultadas anteriormente. Confirmar os responsáveis e revisar o cadastro atual antes de aplicar a migração.

| Conta atual | Destino proposto |
|---|---|
| `jhonatan` | Owner do WMS |
| `caio.log` | Supervisor |
| `operador-01` a `operador-04` | Operador. Identificar o responsável de cada conta. |
| `test1` e `teste` da C3, `teste02` da DP e `teste04` da Liberdade | Revisar finalidade e responsável de cada conta de administrador de loja antes de manter, substituir ou desativar. |
| Dono da MINISO e dono da Prodigy | Criar duas contas individuais de Visualizador Global MINISO. |

Atribuir o primeiro Owner antes de restringir as permissões administrativas do Supervisor. Preservar os IDs das contas existentes e o histórico das operações ao mudar perfis. A atribuição de Administrador fica a cargo do Owner quando houver um responsável designado.

## 6. Implementação e critérios de aceite

- Aplicar autorização por perfil e escopo no banco e nas funções do servidor. Ajustar menus e rotas para refletir as mesmas permissões.
- Manter o vínculo operacional de uma unidade para a equipe de loja. Representar os vínculos do Visualizador com várias lojas de forma independente e validar que o escopo Global MINISO inclui somente lojas e operações dessa rede.
- Calcular os totais de remessas, relatórios e comparativos usando apenas registros autorizados. Nas remessas com várias lojas, filtrar as linhas antes de somar os totais.
- Restringir as operações de escrita e as exportações do Visualizador nas rotas e funções correspondentes. Validar acesso por endereço direto e por consulta ao banco ou à API.
- Em homologação, verificar que um Operador executa apenas as tarefas atribuídas, um Supervisor opera remessas e expedições, e as configurações e a gestão de acessos ficam com Administrador ou Owner.
- Testar um Visualizador com duas lojas e remover um vínculo. Confirmar que o painel, os detalhes, os filtros e os totais passam a considerar apenas a loja restante. Ao remover todos os vínculos, confirmar que a conta fica sem dados.
- Testar as duas contas executivas. Ambas devem ver o consolidado MINISO e os detalhes de todas as lojas da rede. Ações operacionais, gestão de usuários, configurações e exportações seguem bloqueadas.
- Validar a transição em homologação, incluindo a gestão de contas pelo Owner e a continuidade dos acessos locais das lojas.

## Referências do projeto

- [Visão geral do WMS Miniso](https://github.com/JhonatanAlmeida02/WMS-Miniso/blob/main/README.md)
- [Módulo de lojas e recebimento](https://github.com/JhonatanAlmeida02/WMS-Miniso/blob/main/docs/MODULO_LOJAS.md)
