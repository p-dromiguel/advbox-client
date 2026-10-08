'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { resolverId, resolverItem, nomesDisponiveis, normalizar } = require('../src/settings');

// Amostra no formato do GET /settings. Sem dado real de ninguém.
const SETTINGS = {
  users: [
    { id: 101, name: 'ANA PAULA MOREIRA' },
    { id: 102, name: 'JOÃO DA SILVA' },
  ],
  tasks: [
    { id: 9001, task: 'ELABORAR PETIÇÃO INICIAL', reward: 60 },
    { id: 9002, task: 'REUNIÃO COM CLIENTE', reward: 20 },
  ],
  stages: [{ id: 7001, stage: 'AÇÃO PROTOCOLADA/INICIADA' }],
  origins: [{ id: 5001, origin: 'INDICAÇÃO' }],
};

test('resolve id por nome exato', () => {
  assert.equal(resolverId(SETTINGS, 'users', 'ANA PAULA MOREIRA'), 101);
  assert.equal(resolverId(SETTINGS, 'stages', 'AÇÃO PROTOCOLADA/INICIADA'), 7001);
});

test('ignora acento, caixa e espaço sobrando', () => {
  assert.equal(resolverId(SETTINGS, 'users', 'joão da silva'), 102);
  assert.equal(resolverId(SETTINGS, 'users', 'JOAO DA SILVA'), 102);
  assert.equal(resolverId(SETTINGS, 'tasks', '  reunião   com cliente '), 9002);
  assert.equal(resolverId(SETTINGS, 'origins', 'indicacao'), 5001);
});

test('a coleção de tarefas guarda o nome em `task`, não em `name`', () => {
  // É o erro mais fácil de cometer nessa API: todo mundo assume `name`.
  assert.equal(resolverId(SETTINGS, 'tasks', 'ELABORAR PETIÇÃO INICIAL'), 9001);
});

test('resolverItem devolve o objeto inteiro — os pontos vêm do tipo', () => {
  const item = resolverItem(SETTINGS, 'tasks', 'elaborar petição inicial');
  assert.equal(item.id, 9001);
  assert.equal(item.reward, 60);
});

test('nome inexistente devolve null, sem inventar id', () => {
  assert.equal(resolverId(SETTINGS, 'users', 'FULANO QUE NÃO EXISTE'), null);
  assert.equal(resolverId(SETTINGS, 'tasks', ''), null);
});

test('coleção desconhecida é erro de programação, não null silencioso', () => {
  assert.throws(() => resolverId(SETTINGS, 'inexistente', 'x'), /Coleção desconhecida/);
});

test('coleção que não veio na resposta é erro, não "não achei"', () => {
  // A lawsuit_types existe na API, mas esta amostra não a trouxe.
  assert.throws(() => resolverId(SETTINGS, 'lawsuit_types', 'CÍVEL'), /não trouxe a coleção "lawsuit_types"/);
  assert.throws(() => resolverId(null, 'users', 'ANA'), /não trouxe a coleção "users"/);
});

test('steps e groups não existem no /settings: pedir é erro de programação', () => {
  assert.throws(() => resolverId(SETTINGS, 'steps', 'X'), /Coleção desconhecida/);
  assert.throws(() => resolverId(SETTINGS, 'groups', 'X'), /Coleção desconhecida/);
});

test('nomesDisponiveis ajuda a mensagem de erro a dizer o que existe', () => {
  assert.deepEqual(nomesDisponiveis(SETTINGS, 'tasks'), [
    'ELABORAR PETIÇÃO INICIAL',
    'REUNIÃO COM CLIENTE',
  ]);
});

test('normalizar é estável para nulo e indefinido', () => {
  assert.equal(normalizar(null), '');
  assert.equal(normalizar(undefined), '');
  assert.equal(normalizar('  Ação   Penal  '), 'ACAO PENAL');
});
