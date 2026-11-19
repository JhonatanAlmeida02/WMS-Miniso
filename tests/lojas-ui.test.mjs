import test from 'node:test';
import assert from 'node:assert/strict';
import { agruparPorLoja } from '../src/lib/agruparLojas.ts';

test('lojas com o mesmo nome permanecem separadas pelo ID', () => {
  const linhas = [
    { loja_id: 2, loja_nome: 'Centro', loja_numero: 2, qtd: 4 },
    { loja_id: 1, loja_nome: 'Centro', loja_numero: 1, qtd: 3 },
    { loja_id: 2, loja_nome: 'Centro', loja_numero: 2, qtd: 5 },
  ];
  const grupos = agruparPorLoja(linhas);
  assert.deepEqual(grupos.map(g => [g.id, g.linhas.length]), [[1, 1], [2, 2]]);
  assert.equal(grupos.find(g => g.id === 2).linhas.reduce((n,l) => n+l.qtd,0), 9);
  assert.equal(grupos.flatMap(g => g.linhas).length, linhas.length);
});

test('ordena pelo número da loja e mantém lojas sem número no fim', () => {
  const grupos = agruparPorLoja([
    { loja_id: 10, loja_nome: 'Loja 10', loja_numero: null },
    { loja_id: 3, loja_nome: 'Loja 3', loja_numero: 3 },
    { loja_id: 2, loja_nome: 'Loja 2', loja_numero: null },
    { loja_id: 1, loja_nome: 'Loja 1', loja_numero: 1 },
  ]);
  assert.deepEqual(grupos.map(g => g.id), [1, 3, 2, 10]);
});

test('uma lista vazia não cria grupos fictícios', () => {
  assert.deepEqual(agruparPorLoja([]), []);
});
