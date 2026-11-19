import test from 'node:test';
import assert from 'node:assert/strict';
import { aplicarLeituraCaixa, textoVolume, validarEtiqueta, ETIQUETA_PADRAO, lerConfiguracaoEtiqueta, salvarConfiguracaoEtiqueta, CHAVE_ETIQUETA } from '../src/lib/caixaTemporaria.ts';

const adesivo = { sku: '001234', descricao: 'Adesivos' };
test('agrupa leituras do mesmo SKU, mantém zeros à esquerda e não altera a lista anterior', () => {
  const lista = aplicarLeituraCaixa([], adesivo, 2);
  assert.deepEqual(aplicarLeituraCaixa(lista, adesivo, 3), [{...adesivo,qtd:5}]);
  assert.equal(lista[0].qtd, 2);
});
test('o desfazer desconta só da caixa aberta e remove o item quando zera', () => {
  const lista = aplicarLeituraCaixa([], adesivo, 2);
  assert.deepEqual(aplicarLeituraCaixa(lista, adesivo, -2), []);
  assert.throws(() => aplicarLeituraCaixa([], adesivo, -1), /caixa aberta/);
  assert.throws(() => aplicarLeituraCaixa(lista, adesivo, -3), /caixa aberta/);
  assert.throws(() => aplicarLeituraCaixa(lista, adesivo, 1.5), /inválida/);
});
test('a nova caixa usa apenas suas novas leituras', () => {
  const primeira = aplicarLeituraCaixa([], adesivo, 8);
  const segunda = aplicarLeituraCaixa([], adesivo, 1);
  assert.equal(primeira[0].qtd, 8);
  assert.equal(segunda[0].qtd, 1);
});
test('só o último volume exibe o total', () => {
  assert.equal(textoVolume(1,false),'1');
  assert.equal(textoVolume(49,false),'49');
  assert.equal(textoVolume(50,true),'50/50');
  assert.throws(() => textoVolume(0,true));
});
test('recusa medidas inválidas e margem sem área imprimível', () => {
  assert.equal(validarEtiqueta(ETIQUETA_PADRAO),null);
  for (const mudanca of [{largura:NaN},{altura:0},{largura:211},{margem:-1},{largura:40,margem:15},{orientacao:'errada'}]) {
    assert.ok(validarEtiqueta({...ETIQUETA_PADRAO,...mudanca}));
  }
});
test('salva só as dimensões no posto e recupera padrão se a configuração estiver corrompida', () => {
  const dados = new Map();
  globalThis.localStorage = {getItem:k=>dados.get(k)??null,setItem:(k,v)=>dados.set(k,v)};
  const config = {...ETIQUETA_PADRAO,largura:80,altura:120};
  salvarConfiguracaoEtiqueta(config);
  assert.deepEqual(lerConfiguracaoEtiqueta(),config);
  assert.deepEqual([...dados.keys()],[CHAVE_ETIQUETA]);
  dados.set(CHAVE_ETIQUETA,'{"largura":0}');
  assert.deepEqual(lerConfiguracaoEtiqueta(),ETIQUETA_PADRAO);
  dados.set(CHAVE_ETIQUETA,'{invalido');
  assert.deepEqual(lerConfiguracaoEtiqueta(),ETIQUETA_PADRAO);
  delete globalThis.localStorage;
});
