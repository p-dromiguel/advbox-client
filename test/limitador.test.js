'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { AdvboxClient } = require('../src/client');

const respostaVazia = async () => ({ ok: true, status: 200, text: async () => '{"data":[]}' });

test('espaça as chamadas para não estourar o limite de 30/min', async () => {
  const c = new AdvboxClient({ token: 't', intervaloMs: 40, fetch: respostaVazia });

  const inicio = Date.now();
  await c.processos();
  await c.processos();
  await c.processos();
  const gasto = Date.now() - inicio;

  // A primeira sai na hora; a 2ª e a 3ª esperam um intervalo cada.
  assert.ok(gasto >= 80, `esperava ao menos 80ms de espaçamento, gastou ${gasto}ms`);
});

test('intervaloMs = 0 desliga o limitador', async () => {
  const c = new AdvboxClient({ token: 't', intervaloMs: 0, fetch: respostaVazia });

  const inicio = Date.now();
  for (let i = 0; i < 5; i++) await c.processos();
  const gasto = Date.now() - inicio;

  assert.ok(gasto < 60, `esperava execução imediata, gastou ${gasto}ms`);
});

test('timeout vira erro 504 legível', async () => {
  const c = new AdvboxClient({
    token: 't',
    intervaloMs: 0,
    timeoutMs: 20,
    fetch: (_url, opts) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const e = new Error('abortado');
        e.name = 'AbortError';
        reject(e);
      });
    }),
  });

  await assert.rejects(() => c.processos(), (err) => {
    assert.equal(err.status, 504);
    assert.match(err.message, /timeout de 20ms/);
    return true;
  });
});
