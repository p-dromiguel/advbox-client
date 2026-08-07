'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  origemDoAndamento,
  apenasDoTribunal,
  origemEhDecidivel,
  rastreabilidade,
} = require('../src/andamentos');

test('header com sigla do tribunal → tribunal', () => {
  assert.equal(origemDoAndamento({ header: 'TJRJ' }), 'tribunal');
});

test('header nulo → interno (foi o nosso sistema que escreveu)', () => {
  assert.equal(origemDoAndamento({ header: null }), 'interno');
  assert.equal(origemDoAndamento({ header: '' }), 'interno');
  assert.equal(origemDoAndamento({ header: '   ' }), 'interno');
});

test('sem o campo header → desconhecido, nunca "interno" por omissão', () => {
  // Distinção que evita o erro caro: a ausência do campo não é prova de que o
  // andamento é interno. É prova de que esta chamada não sabe responder.
  assert.equal(origemDoAndamento({ description: 'Juntada' }), 'desconhecido');
  assert.equal(origemDoAndamento(null), 'desconhecido');
  assert.equal(origemDoAndamento(undefined), 'desconhecido');
});

test('o filtro por origem da API não separa; o header separa', () => {
  // Os dois vieram na MESMA resposta de ?origin=TRIBUNAL — o filtro não filtrou.
  const resposta = [
    { header: 'TJRJ', description: 'Conclusos para despacho' },
    { header: null, description: 'Cobrança gerada — 1ª parcela' },
  ];
  const doTribunal = apenasDoTribunal(resposta);
  assert.equal(doTribunal.length, 1);
  assert.equal(doTribunal[0].description, 'Conclusos para despacho');
});

test('origemEhDecidivel é falso quando todo header é nulo', () => {
  // Formato de /last_movements: barata, em lote, e com header nulo em tudo.
  const emLote = [{ header: null }, { header: null }, { header: null }];
  assert.equal(origemEhDecidivel(emLote), false);

  // Sem essa guarda, o filtro devolveria [] e alguém concluiria
  // "nenhum andamento do tribunal" a partir de um campo que a chamada não traz.
  assert.deepEqual(apenasDoTribunal(emLote), []);
});

test('origemEhDecidivel é verdadeiro se ao menos um header veio preenchido', () => {
  assert.equal(origemEhDecidivel([{ header: null }, { header: 'TJSP' }]), true);
});

test('lista vazia não é decidível', () => {
  assert.equal(origemEhDecidivel([]), false);
  assert.equal(origemEhDecidivel(null), false);
});

test('processo sem número não é rastreável no tribunal', () => {
  assert.equal(rastreabilidade({ process_number: '0801966-16.2025.8.19.0007' }), 'rastreavel');
  assert.equal(rastreabilidade({ process_number: null }), 'sem_numero');
  assert.equal(rastreabilidade({ process_number: '  ' }), 'sem_numero');
  assert.equal(rastreabilidade({}), 'sem_numero');
});
