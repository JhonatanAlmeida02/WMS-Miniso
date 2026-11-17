#!/usr/bin/env bash
# Testes de banco do módulo das lojas num Postgres local descartável.
# Não usa Docker nem Supabase: cria o banco "wms_teste", simula o mínimo do
# Supabase (tests/sql/00_stub_supabase.sql), aplica TODAS as migrações e roda
# os testes. Nunca aponta para produção.
#
# Uso: bash tests/sql/rodar.sh        (PSQL="psql -U postgres" para outro acesso)
set -euo pipefail
cd "$(dirname "$0")/../.."
PSQL=${PSQL:-psql}
BANCO=${BANCO:-wms_teste}

$PSQL -q -d postgres -c "drop database if exists $BANCO" -c "create database $BANCO" >/dev/null
rodar() {
  local saida
  if ! saida=$($PSQL -X -q -v ON_ERROR_STOP=1 -o /dev/null -d "$BANCO" -f "$1" 2>&1); then
    echo "$saida" | grep -v -e 'wal_level' -e 'Set wal_level'
    echo "FALHOU em $1"
    exit 1
  fi
  echo "$saida" | grep -v -e 'wal_level' -e 'Set wal_level' | sed 's/^psql:[^ ]* NOTICE:  /  /' || true
}

rodar tests/sql/00_stub_supabase.sql
for m in supabase/migrations/*.sql; do rodar "$m"; done
rodar tests/sql/10_modulo_lojas.test.sql
bash tests/sql/concorrencia.sh "$BANCO"
