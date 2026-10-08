'use strict';

const { AdvboxClient, BASE, INTERVALO_MIN_MS } = require('./src/client');
const { RESPOSTA_TRUNCADA, CAMINHO_INEXISTENTE } = require('./src/erros');
const andamentos = require('./src/andamentos');
const tarefas = require('./src/tarefas');
const settings = require('./src/settings');

module.exports = {
  AdvboxClient,
  BASE,
  INTERVALO_MIN_MS,
  RESPOSTA_TRUNCADA,
  CAMINHO_INEXISTENTE,
  ...andamentos,
  ...tarefas,
  ...settings,
};
