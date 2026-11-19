# Caixas temporárias na conferência da PRODIGY

Na conferência do CD (`/conferir`), cada leitura confirmada pelo servidor alimenta a caixa aberta com SKU (GTIN), descrição e quantidade. Repetições do mesmo SKU são somadas. As bipagens normais continuam sendo gravadas pelo fluxo já existente da conferência; não há tabela, chamada extra ou histórico para os itens das caixas.

1. A primeira caixa começa no volume 1.
2. **Fechar caixa e imprimir** solicita a impressão da lista atual, descarta os itens e as últimas leituras da caixa e abre a próxima caixa vazia.
3. Na última caixa, use **Fechar última caixa**. Confira o confronto e confirme **Finalizar e imprimir última caixa**. Após o servidor confirmar a finalização, a etiqueta mostra o volume e o total: por exemplo, **50/50**. As anteriores mostram **1**, **2** etc.
4. Leitura não confirmada ou falha ao finalizar não imprime. Cliques repetidos ficam bloqueados durante a operação. Se o comando de impressão falhar, a caixa é mantida para nova tentativa na mesma tela.

As listas existem apenas em memória, não em banco, localStorage ou sessionStorage. Após sair ou recarregar, seus itens são perdidos e não há reimpressão de caixas anteriores. O navegador avisa antes de recarregar com caixa preenchida. O próximo número de volume fica no sessionStorage desta aba, por conferência; não existe coordenação de volumes entre computadores ou abas. Use um único posto por conferência. As leituras já gravadas no banco continuam contando mesmo se a lista temporária for perdida.

Em **Configurações → Etiqueta**, o supervisor ajusta largura, altura, margens e orientação e pode imprimir teste. A configuração é salva no localStorage do navegador daquele posto, inclusive para os operadores que usarem o mesmo navegador; não é propagada a outras máquinas. O padrão é 100 × 150 mm com margem de 2 mm. Caixas com muitas linhas usam continuação em outras etiquetas, repetindo a identificação do volume.

## Impressão sem confirmação

O site chama `window.print()`. Para enviar diretamente à impressora padrão, cada posto precisa do Microsoft Edge 144 ou superior com a política **SilentPrintingEnabled** habilitada. Sem ela, aparece o diálogo normal. A aplicação não consegue habilitar políticas do Windows pela página.

Configuração administrada: em `HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Edge`, defina `SilentPrintingEnabled` como DWORD `1`. Em `edge://policy`, recarregue as políticas e confirme o valor `true` sem erro. Ajuste a mídia no driver para corresponder à etiqueta e faça um teste físico. A política se aplica às impressões do Edge no posto.

O navegador não confirma saída de papel ou cancelamento do diálogo; por isso a mensagem é **Impressão solicitada**. A lista é descartada quando o comando ao navegador retorna. Para este fluxo temporário, é necessário validar impressora, papel e impressão silenciosa antes da operação.

Referência: https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/silentprintingenabled

Validação automatizada: `node --test tests/caixa-temporaria.test.mjs tests/lojas-ui.test.mjs` e `npm run build`. Impressão física e política do posto devem ser validadas na impressora de destino.
