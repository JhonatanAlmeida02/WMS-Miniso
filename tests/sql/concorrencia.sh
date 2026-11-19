#!/usr/bin/env bash
# Concorrência no recebimento da loja (roda depois de 10_modulo_lojas.test.sql):
#  1) 5 aparelhos bipando a mesma entrega ao mesmo tempo, cada leitura enviada
#     duas vezes (retry): nenhuma perdida, nenhuma duplicada.
#  2) bipagem e finalização ao mesmo tempo: nada grava depois do fechamento.
set -euo pipefail
BANCO=${1:-wms_teste}
PSQL=${PSQL:-psql}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
q() { $PSQL -X -qtA -v ON_ERROR_STOP=1 -d "$BANCO" -c "$1"; }

SUP=00000000-0000-0000-0000-0000000000aa
LOJA2=00000000-0000-0000-0000-000000000002
PED2=$(q "select id from public.pedidos where nome = 'PED-2'")
GTIN=0007891000001

como() { echo "set role authenticated; select teste.como('$1');"; }

EXP=$(q "$(como $SUP) select public.expedir_pedido($PED2, 1, gen_random_uuid());" | tail -1)
REC=$(q "select id from public.recebimentos_loja where expedicao_id = $EXP")
q "$(como $LOJA2) select public.iniciar_recebimento_loja($REC);" >/dev/null

echo "--- 5 aparelhos x 50 leituras, cada uma reenviada (retry)"
for s in 1 2 3 4 5; do
  {
    como $LOJA2
    for i in $(seq 1 50); do
      op=$(cat /proc/sys/kernel/random/uuid)
      echo "select 1 from public.bipar_recebimento($REC, '$GTIN', 1, false, '$op');"
      echo "select 1 from public.bipar_recebimento($REC, '$GTIN', 1, false, '$op');"
    done
  } > "$TMP/s$s.sql"
  $PSQL -X -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$TMP/s$s.sql" > /dev/null &
done
wait
TOTAL=$(q "select sum(qtd) from public.recebimento_bips where recebimento_id = $REC")
[ "$TOTAL" = "250" ] || { echo "FALHOU: esperado 250 un., veio $TOTAL"; exit 1; }
echo "ok  250 leituras gravadas uma vez cada"

echo "--- bipagem e finalização ao mesmo tempo"
for s in 1 2 3 4 5; do
  {
    como $LOJA2
    for i in $(seq 1 200); do
      echo "select 1 from public.bipar_recebimento($REC, '$GTIN', 1, false, '$(cat /proc/sys/kernel/random/uuid)');"
    done
  } > "$TMP/r$s.sql"
  $PSQL -X -q -d "$BANCO" -f "$TMP/r$s.sql" > /dev/null 2>&1 &
done
sleep 0.1
q "$(como $LOJA2) select public.finalizar_recebimento_loja($REC);" >/dev/null
wait
NO_FECHAMENTO=$(q "select qtd_recebida from public.divergencias where recebimento_id = $REC and tipo = 'sobra'")
AGORA=$(q "select sum(qtd) from public.recebimento_bips where recebimento_id = $REC")
# Prova de que nada entrou depois: as divergências calculadas no fechamento
# usam exatamente o total que está gravado agora.
[ "$NO_FECHAMENTO" = "$AGORA" ] || { echo "FALHOU: fechou com $NO_FECHAMENTO un. mas há $AGORA gravadas"; exit 1; }
REJEITADAS=$(( 1000 - (AGORA - 250) ))
[ "$REJEITADAS" -gt 0 ] || { echo "FALHOU: a finalização não concorreu com a bipagem"; exit 1; }
echo "ok  fechou com $AGORA un.; as $REJEITADAS leituras que chegaram depois foram recusadas"
echo "CONCORRÊNCIA OK"
