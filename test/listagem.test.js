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

// fetch falso que responde conforme a URL, e guarda as URLs pedidas.
function clientePorUrl(responder, opts = {}) {
  const urls = [];
  const c = new AdvboxClient({
    token: 't',
    intervaloMs: 0,
    fetch: async (url) => {
      urls.push(url);
      const corpo = responder(url);
      return { ok: true, status: 200, text: async () => JSON.stringify(corpo) };
    },
    ...opts,
  });
  return { c, urls };
}

const offsetDe = url => Number(new URL(url).searchParams.get('offset'));
const ids = (de, ate) => Array.from({ length: ate - de }, (_, i) => ({ id: de + i }));

test('tarefas() junta criadas e concluídas e marca a origem de cada uma', async () => {
  // Quem lê só a lista de criadas perde o trabalho que todos já concluíram.
  const { c, urls } = clientePorUrl(url => url.includes('created_start')
    ? { data: [{ id: 1 }, { id: 2 }], totalCount: 2 }
    : { data: [{ id: 9 }], totalCount: 1 });

  const r = await c.tarefas({ de: '2026-01-01', ate: '2026-12-31' });
  assert.equal(urls.length, 2, 'precisa consultar as duas listas');
  assert.equal(r.itens.length, 3);
  assert.equal(r.total, 3);
  assert.equal(r.itens.filter(t => t._lista_origem === 'criadas').length, 2);
  assert.equal(r.itens.filter(t => t._lista_origem === 'concluidas').length, 1);
});

test('tarefa concluída pela metade está nas duas listas e conta uma vez só', async () => {
  // O caso real: 22 tarefas nas duas listas, todas com um convidado que concluiu e
  // outro que não. Concatenar daria 3.378 numa base de 3.356.
  const parcial = {
    id: 7,
    users: [{ user_id: 1, completed: '2026-06-09 12:47:37' }, { user_id: 2, completed: null }],
  };
  const { c } = clientePorUrl(url => url.includes('created_start')
    ? { data: [{ id: 1 }, parcial], totalCount: 2 }
    : { data: [parcial, { id: 9 }], totalCount: 2 });

  const r = await c.tarefas({ de: '2026-01-01', ate: '2026-12-31' });
  assert.equal(r.itens.length, 3);
  assert.equal(r.total, 3);
  assert.equal(r.completa, true);
  assert.deepEqual(r.itens.find(t => t.id === 7)._lista_origem, 'ambas');
});

test('paginação segue o offset até a página curta', async () => {
  const { c, urls } = clientePorUrl(url => {
    const off = offsetDe(url);
    return off === 0 ? { data: ids(0, 1000), totalCount: 1193 } : { data: ids(1000, 1193), totalCount: 1193 };
  });

  const r = await c.processos();
  assert.equal(urls.length, 2);
  assert.match(urls[0], /\/lawsuits\?limit=1000&offset=0$/);
  assert.match(urls[1], /offset=1000$/);
  assert.equal(r.itens.length, 1193);
  assert.equal(r.completa, true);
});

test('paginação mantém o filtro da janela e acusa o que nem o fim da varredura alcança', async () => {
  // O caso real (08/10/2026): concluídas declaram 3.308 e entregam 3.193 em quatro páginas.
  const { c, urls } = clientePorUrl(url => {
    const off = offsetDe(url);
    const fim = Math.min(off + 1000, 3193);
    return { data: ids(off, fim), totalCount: 3308 };
  });

  const r = await c.tarefasConcluidas({ de: '2025-01-01', ate: '2026-10-08' });
  assert.equal(urls.length, 4);
  assert.match(urls[0], /\/posts\?completed_start=2025-01-01&completed_end=2026-10-08&limit=1000&offset=0$/);
  assert.equal(r.itens.length, 3193);
  assert.equal(r.total, 3308);
  assert.equal(r.faltando, 115);
  assert.equal(r.completa, false);
});

test('registro repetido entre páginas conta uma vez', async () => {
  // Offset sobre lista que muda durante a varredura empurra um registro para a página seguinte.
  const { c } = clientePorUrl(url => offsetDe(url) === 0
    ? { data: ids(0, 1000), totalCount: 1001 }
    : { data: [{ id: 999 }, { id: 1000 }], totalCount: 1001 });

  const r = await c.clientes();
  assert.equal(r.itens.length, 1001);
  assert.equal(r.completa, true);
});

test('rota que ignora o offset não prende a paginação num laço', async () => {
  const { c, urls } = clientePorUrl(() => ({ data: ids(0, 1000) }));

  const r = await c.clientes();
  assert.equal(urls.length, 2, 'a segunda página repetida inteira encerra a varredura');
  assert.equal(r.itens.length, 1000);
});

test('totalCount que oscila durante a varredura: vale o maior declarado', async () => {
  // Medido: 227 numa chamada, 225 na seguinte. Daqui não dá para saber se foi exclusão
  // legítima ou contagem instável, então a listagem sai como incompleta.
  const { c } = clientePorUrl(url => offsetDe(url) === 0
    ? { data: ids(0, 1000), totalCount: 1227 }
    : { data: ids(1000, 1225), totalCount: 1225 });

  const r = await c.clientes();
  assert.equal(r.total, 1227);
  assert.equal(r.faltando, 2);
  assert.equal(r.completa, false);
});

test('histórico no teto de 20 não se declara completo', async () => {
  // Medido: processo com 432 tarefas, 20 no histórico, e offset=20 devolve os mesmos 20.
  const { c } = clientePorUrl(() => ({ data: ids(0, 20) }));
  const r = await c.historico(13782346);
  assert.equal(r.itens.length, 20);
  assert.equal(r.completa, false);
  assert.equal(r.total, null, 'o total real é desconhecido; inventar um seria pior');
  assert.equal(r.faltando, null);
});

test('histórico abaixo do teto é completo', async () => {
  const { c } = clientePorUrl(() => ({ data: ids(0, 7) }));
  const r = await c.historico(1);
  assert.equal(r.completa, true);
  assert.equal(r.total, 7);
});

test('histórico no teto, em modo estrito, lança sem inventar total', async () => {
  const { c } = clientePorUrl(() => ({ data: ids(0, 20) }), { estrito: true });
  await assert.rejects(() => c.historico(1), (err) => {
    assert.ok(err instanceof RESPOSTA_TRUNCADA);
    assert.equal(err.declarados, null);
    assert.equal(err.faltando, null);
    assert.match(err.message, /teto desta rota/);
    return true;
  });
});

test('401 avisa que pode ser rota inexistente, não só token', async () => {
  // Rota inexistente responde 401 "Unauthenticated.", igual a token inválido.
  const c = new AdvboxClient({
    token: 't',
    intervaloMs: 0,
    fetch: async () => ({ ok: false, status: 401, text: async () => '{"error":"Unauthenticated."}' }),
  });
  await assert.rejects(() => c.processo(1), (err) => {
    assert.equal(err.status, 401);
    assert.match(err.message, /Unauthenticated/);
    assert.match(err.message, /rota inexistente/);
    return true;
  });
});
