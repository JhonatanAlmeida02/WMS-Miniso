import test from 'node:test';
import assert from 'node:assert/strict';
import { produtoDaConferencia } from '../src/lib/produtoConferencia.ts';

const linhas = [
  { gtin: '001234', qtd_pedido: 10, situacao: 'falta' },
  { gtin: 'ANTIGO-ERRADO', qtd_pedido: 0, situacao: 'fora_do_pedido' },
];
test('aceita somente produtos do pedido atual, preservando zeros à esquerda', () => {
  assert.equal(produtoDaConferencia(linhas, ' 001234 '), true);
  assert.equal(produtoDaConferencia(linhas, '1234'), false);
  assert.equal(produtoDaConferencia(linhas, 'OUTRA-LOJA'), false);
  assert.equal(produtoDaConferencia([], '001234'), false);
});
test('uma leitura errada antiga não passa a autorizar novas leituras', () => {
  assert.equal(produtoDaConferencia(linhas, 'ANTIGO-ERRADO'), false);
  assert.equal(produtoDaConferencia([{gtin:'X',qtd_pedido:10,situacao:'fora_do_pedido'}], 'X'), false);
});
