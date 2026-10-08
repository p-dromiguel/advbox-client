'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { situacaoDaTarefa, convidadosPendentes } = require('../src/tarefas');

const tarefa = (...completed) => ({
  id: 1,
  users: completed.map((c, i) => ({ user_id: 100 + i, completed: c })),
});

test('ninguém concluiu → aberta', () => {
  assert.equal(situacaoDaTarefa(tarefa(null, null)), 'aberta');
});

test('todos concluíram → concluida', () => {
  assert.equal(situacaoDaTarefa(tarefa('2026-06-09 12:47:37', '2026-06-10 08:00:00')), 'concluida');
});

test('um concluiu e outro não → parcial (é a que aparece nas duas listas)', () => {
  assert.equal(situacaoDaTarefa(tarefa('2026-06-09 12:47:37', null)), 'parcial');
});

test('sem convidados na resposta → desconhecida, nunca "aberta" por omissão', () => {
  assert.equal(situacaoDaTarefa({ id: 1 }), 'desconhecida');
  assert.equal(situacaoDaTarefa({ id: 1, users: [] }), 'desconhecida');
  assert.equal(situacaoDaTarefa(null), 'desconhecida');
});

test('convidadosPendentes devolve quem ainda não concluiu', () => {
  // O caso real: tarefa 231913606, concluída por um convidado em 09/06 e aberta para o outro.
  const t = { users: [{ user_id: 260244, completed: null }, { user_id: 277397, completed: '2026-06-09 12:47:37' }] };
  assert.deepEqual(convidadosPendentes(t), [260244]);
});

test('completed vazio conta como não concluído', () => {
  assert.deepEqual(convidadosPendentes(tarefa('', '  ')), [100, 101]);
});
