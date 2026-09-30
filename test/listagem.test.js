'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { AdvboxClient } = require('../src/client');
const { RESPOSTA_TRUNCADA } = require('../src/erros');

// fetch falso: devolve o corpo combinado, sem rede.
function fetchFalso(corpo, { status = 200 } = {}) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(corpo),
  });
}

function cliente(corpo, opts = {}) {
  return new AdvboxClient({
    token: 'token-de-teste',
    fetch: fetchFalso(corpo),
    intervaloMs: 0, // sem espera artificial: o limitador tem teste próprio
    ...opts,
  });
}

test('listagem completa: completa=true e nada faltando', async () => {
  const c = cliente({ data: [{ id: 1 }, { id: 2 }], totalCount: 2 });
  const r = await c.clientes();
  assert.equal(r.itens.length, 2);
  assert.equal(r.total, 2);
  assert.equal(r.completa, true);
  assert.equal(r.faltando, 0);
});

test('a API entrega menos do que declara → completa=false, com a conta', async () => {
  // O caso real é o de GET /posts: 157 registros num corpo que declara 169. O mecanismo
  // é o mesmo em qualquer listagem, então o teste passa por clientes().
  const data = Array.from({ length: 157 }, (_, i) => ({ id: i }));
  const c = cliente({ data, totalCount: 169 });
  const r = await c.clientes();

  assert.equal(r.itens.length, 157);
  assert.equal(r.total, 169);
  assert.equal(r.completa, false);
  assert.equal(r.faltando, 12);
});

test('modo estrito lança em vez de deixar passar', async () => {
  const data = Array.from({ length: 157 }, (_, i) => ({ id: i }));
  const c = cliente({ data, totalCount: 169 }, { estrito: true });

  await assert.rejects(() => c.clientes(), (err) => {
    assert.ok(err instanceof RESPOSTA_TRUNCADA);
    assert.equal(err.recebidos, 157);
    assert.equal(err.declarados, 169);
    assert.equal(err.faltando, 12);
    assert.match(err.message, /157 registros mas declara 169/);
    return true;
  });
});

test('resposta como array cru (sem totalCount) é tratada como completa', async () => {
  const c = cliente([{ id: 1 }, { id: 2 }, { id: 3 }]);
  const r = await c.processos();
  assert.equal(r.itens.length, 3);
  assert.equal(r.total, 3);
  assert.equal(r.completa, true);
});

test('lista vazia continua sendo lista vazia — mas o formato não engana', async () => {
  // Aqui está a diferença que dá nome ao projeto: um array vazio devolvido cru
  // não tem como dizer "0 de 0" ou "0 de 23". O objeto tem.
  const c = cliente({ data: [], totalCount: 0 });
  const r = await c.andamentos(12345);
  assert.deepEqual(r.itens, []);
  assert.equal(r.total, 0);
  assert.equal(r.completa, true);
});

test('andamentos exige o id do processo', async () => {
  const c = cliente({ data: [] });
  await assert.rejects(() => c.andamentos(), /exige o id do processo/);
  await assert.rejects(() => c.andamentos(''), /exige o id do processo/);
  await assert.rejects(() => c.andamentos(null), /exige o id do processo/);
});

test('erro HTTP vira Error com status e sem vazar o token', async () => {
  const c = new AdvboxClient({
    token: 'segredo-que-nao-pode-vazar',
    fetch: async () => ({ ok: false, status: 429, text: async () => '{"message":"Too Many Requests"}' }),
  });
  await assert.rejects(() => c.clientes(), (err) => {
    assert.equal(err.status, 429);
    assert.match(err.message, /429/);
    assert.ok(!err.message.includes('segredo-que-nao-pode-vazar'), 'a mensagem não pode conter o token');
    return true;
  });
});

test('construtor exige token', () => {
  const semEnv = { ...process.env };
  delete process.env.ADVBOX_TOKEN;
  delete process.env.ADVBOX_API_TOKEN;
  try {
    assert.throws(() => new AdvboxClient(), /Token do ADVBOX ausente/);
  } finally {
    Object.assign(process.env, semEnv);
  }
});

test('tarefas() junta criadas e concluídas e marca a origem de cada uma', async () => {
  // As duas listas são mutuamente exclusivas na API: quem lê só uma perde metade.
  let chamada = 0;
  const c = new AdvboxClient({
    token: 't',
    intervaloMs: 0,
    fetch: async (url) => {
      chamada++;
      const criadas = url.includes('created_start');
      const corpo = criadas
        ? { data: [{ id: 1 }, { id: 2 }], totalCount: 2 }
        : { data: [{ id: 9 }], totalCount: 1 };
      return { ok: true, status: 200, text: async () => JSON.stringify(corpo) };
    },
  });

  const r = await c.tarefas({ de: '2026-01-01', ate: '2026-12-31' });
  assert.equal(chamada, 2, 'precisa consultar as duas listas');
  assert.equal(r.itens.length, 3);
  assert.equal(r.total, 3);
  assert.equal(r.itens.filter(t => t._lista_origem === 'criadas').length, 2);
  assert.equal(r.itens.filter(t => t._lista_origem === 'concluidas').length, 1);
});
