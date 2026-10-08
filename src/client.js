'use strict';

const { RESPOSTA_TRUNCADA, CAMINHO_INEXISTENTE } = require('./erros');

const BASE = 'https://app.advbox.com.br/api/v1';

// A API limita GET a 30/min. Excedeu, devolve 429. Um espaçamento mínimo entre
// chamadas custa quase nada e evita o 429 — que é caro, porque chega no meio de
// uma varredura e deixa metade dos dados para trás.
const INTERVALO_MIN_MS = 2100;
const TIMEOUT_PADRAO_MS = 15000;

// Tamanho de página das listagens paginadas. É o maior que a API aceita.
const POR_PAGINA = 1000;

// GET /history/{id} devolve no máximo 20 itens, e `offset` e `page` são
// ignorados: a segunda "página" volta com os mesmos 20. Medido num processo
// com 432 tarefas.
const TETO_HISTORICO = 20;
const STATUS_HISTORICO = ['pending', 'completed', 'all'];

/**
 * Cliente da API do ADVBOX.
 *
 * O que este cliente faz de diferente de um wrapper qualquer: ele não devolve
 * lista crua. Toda listagem volta como {itens, total, completa} — porque a API
 * devolve menos do que ela mesma declara, e quem recebe um array não tem como
 * saber disso. Ver README, seção "As cinco armadilhas".
 */
class AdvboxClient {
  /**
   * @param {object} opts
   * @param {string} [opts.token]   Token Bearer. Se omitido, lê de ADVBOX_TOKEN.
   * @param {number} [opts.timeoutMs]
   * @param {boolean} [opts.estrito] Se true, listagem truncada lança em vez de sinalizar.
   * @param {number} [opts.intervaloMs] Espaçamento mínimo entre chamadas. 0 desliga.
   * @param {function} [opts.fetch]  Injeção para teste.
   */
  constructor({
    token,
    timeoutMs = TIMEOUT_PADRAO_MS,
    estrito = false,
    intervaloMs = INTERVALO_MIN_MS,
    fetch: fetchImpl,
  } = {}) {
    this._token = token || process.env.ADVBOX_TOKEN || process.env.ADVBOX_API_TOKEN;
    if (!this._token) {
      throw new Error(
        'Token do ADVBOX ausente. Passe { token } ou defina ADVBOX_TOKEN no ambiente.'
      );
    }
    this._timeoutMs = timeoutMs;
    this._estrito = estrito;
    this._intervaloMs = intervaloMs;
    this._fetch = fetchImpl || globalThis.fetch;
    this._proximaLiberacaoEm = 0;
  }

  // ── camada HTTP ────────────────────────────────────────────────────────────

  async _esperarVez() {
    if (!this._intervaloMs) return;
    const agora = Date.now();
    const espera = this._proximaLiberacaoEm - agora;
    if (espera > 0) await new Promise(r => setTimeout(r, espera));
    this._proximaLiberacaoEm = Math.max(agora, this._proximaLiberacaoEm) + this._intervaloMs;
  }

  /**
   * Requisição crua. Só é usada pelos métodos nomeados desta classe — o caminho
   * e os parâmetros nunca vêm de fora. Isso é deliberado: caminho inexistente
   * nesta API não responde 404 (já respondeu 200 com lista vazia, hoje responde
   * 401), e parâmetro desconhecido é ignorado com 200 e a base inteira. Caminho
   * ou filtro montado por quem chama é uma fonte silenciosa de dado errado.
   */
  async _req(metodo, caminho, corpo) {
    await this._esperarVez();

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this._timeoutMs);
    try {
      const r = await this._fetch(BASE + caminho, {
        method: metodo,
        headers: {
          Authorization: 'Bearer ' + this._token,
          Accept: 'application/json',
          ...(corpo ? { 'Content-Type': 'application/json' } : {}),
        },
        body: corpo ? JSON.stringify(corpo) : undefined,
        signal: ctrl.signal,
      });

      const texto = await r.text();
      let dados = null;
      try { dados = texto ? JSON.parse(texto) : null; } catch { /* fica null */ }

      if (!r.ok) {
        const msg = (dados && (dados.message || dados.error)) || texto || `HTTP ${r.status}`;
        // Rota inexistente responde 401 "Unauthenticated.", igual a token inválido.
        // Sem a dica, a primeira reação é trocar um token que estava certo.
        const dica = r.status === 401
          ? ' (nesta API, 401 é também a resposta para rota inexistente: confira o caminho antes do token)'
          : '';
        // A mensagem nunca inclui o token: só método, caminho e o que a API disse.
        const err = new Error(`ADVBOX ${metodo} ${caminho} → ${r.status}: ${String(msg).slice(0, 300)}${dica}`);
        err.status = r.status;
        throw err;
      }
      return dados;
    } catch (e) {
      if (e.name === 'AbortError') {
        const err = new Error(`ADVBOX ${metodo} ${caminho} → timeout de ${this._timeoutMs}ms`);
        err.status = 504;
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Normaliza uma listagem e CONFERE o total declarado pela própria API.
   *
   * ARMADILHA (listagem truncada): `GET /posts` já devolveu 157 registros
   * declarando `totalCount: 169` no mesmo corpo. Paginar até o fim não fecha a
   * conta: as concluídas declararam 3.308 e entregaram 3.193 em quatro páginas.
   * Quem recebe só o array acha que tem a base inteira.
   *
   * Isto só pega o buraco que a API ADMITE. O de `GET /customers` ela não admite:
   * ver `clientes()`.
   */
  _lista(dados, contexto) {
    const itens = Array.isArray(dados) ? dados : (dados && dados.data) || [];
    const declarado = dados && typeof dados.totalCount === 'number' ? dados.totalCount : null;
    const total = declarado != null ? declarado : itens.length;
    const completa = itens.length >= total;

    if (!completa && this._estrito) {
      throw new RESPOSTA_TRUNCADA(contexto, itens.length, total);
    }
    return { itens, total, completa, faltando: completa ? 0 : total - itens.length };
  }

  /**
   * Busca uma listagem página por página e devolve no formato de `_lista`.
   *
   * Três cuidados, todos medidos:
   * - para na página CURTA, não no `totalCount`: o total declarado oscila entre
   *   chamadas seguidas (227 → 225) e é maior do que o alcançável;
   * - tira repetição pela `chave` (`id` por padrão): offset sobre uma lista que
   *   muda durante a varredura pode trazer o mesmo registro em duas páginas;
   * - para se uma página não trouxer nada novo: rota que ignora `offset` devolve
   *   a mesma página para sempre (é o que `/history` faz).
   *
   * O total comparado no fim é o MAIOR que a API declarou durante a varredura.
   * Se ela declarou 227 e depois 225, pode ter sido exclusão legítima ou contagem
   * instável; daqui não dá para saber, então a listagem sai como incompleta.
   */
  async _paginar(caminho, contexto, chave = 'id') {
    const sep = caminho.includes('?') ? '&' : '?';
    const vistos = new Set();
    const itens = [];
    let declarado = null;

    for (let offset = 0; ; offset += POR_PAGINA) {
      const dados = await this._req('GET', `${caminho}${sep}limit=${POR_PAGINA}&offset=${offset}`);
      const lote = Array.isArray(dados) ? dados : (dados && dados.data) || [];
      if (dados && typeof dados.totalCount === 'number') {
        declarado = Math.max(declarado == null ? 0 : declarado, dados.totalCount);
      }

      let novos = 0;
      for (const item of lote) {
        if (item && item[chave] != null) {
          if (vistos.has(item[chave])) continue;
          vistos.add(item[chave]);
        }
        itens.push(item);
        novos++;
      }
      if (lote.length < POR_PAGINA || novos === 0) break;
    }
    return this._lista({ data: itens, totalCount: declarado }, contexto);
  }

  // ── configurações da conta ─────────────────────────────────────────────────

  /**
   * GET /settings — todos os ids da conta (usuários, etapas, tipos, origens...).
   * Consultar ANTES dos outros: nenhum id deve ser fixado no código.
   */
  async settings() {
    return this._req('GET', '/settings');
  }

  // ── clientes ───────────────────────────────────────────────────────────────

  /**
   * GET /customers — @returns {{itens, total, completa, faltando}}
   *
   * ARMADILHA que `completa` NÃO detecta: a listagem esconde os clientes que
   * estão SEM ORIGEM, e o `totalCount` esconde junto. Medido: a listagem trouxe
   * 377 e declarou 377, enquanto as partes citadas em `GET /lawsuits` somavam 447.
   * Os 70 existem (`GET /customers/{id}` responde 200 com a ficha); quase todos
   * vieram de uma importação que criou a ficha só com o nome. Para ter a base
   * inteira, junte esta listagem com as partes de `GET /lawsuits` (lá a chave é
   * `customer_id`, aqui é `id`).
   */
  async clientes() {
    return this._paginar('/customers', 'GET /customers');
  }

  /**
   * GET /customers?identification= — o filtro de CPF chama `identification`,
   * não `cpf`. Só dígitos.
   */
  async clientePorCpf(cpf) {
    const digitos = String(cpf || '').replace(/\D/g, '');
    if (!digitos) return null;
    const { itens } = this._lista(
      await this._req('GET', '/customers?identification=' + encodeURIComponent(digitos)),
      'GET /customers?identification'
    );
    return itens.find(c => String(c.identification || '').replace(/\D/g, '') === digitos) || null;
  }

  /** GET /customers/birthdays — aniversariantes do mês atual. */
  async aniversariantes() {
    return this._paginar('/customers/birthdays', 'GET /customers/birthdays');
  }

  // ── processos ──────────────────────────────────────────────────────────────

  /** GET /lawsuits */
  async processos() {
    return this._paginar('/lawsuits', 'GET /lawsuits');
  }

  /** GET /lawsuits/{id} */
  async processo(id) {
    return this._req('GET', `/lawsuits/${encodeURIComponent(id)}`);
  }

  // ── andamentos ─────────────────────────────────────────────────────────────

  /**
   * GET /movements/{lawsuitId} — andamentos de UM processo.
   *
   * CUIDADO: o caminho NÃO é `/lawsuits/{id}/movements`. Esse caminho não
   * existe, e em agosto de 2026 a API respondia 200 com lista vazia em vez de
   * 404, o que se lê como "este processo não tem andamento". Em um caso real
   * havia 23 movimentações do tribunal num processo dado como parado.
   *
   * Este é o único método que traz `header`, e é o `header` que distingue
   * andamento do tribunal do que o seu próprio sistema escreveu.
   *
   * A doc diz que id inexistente responde 204; medido em 08/10/2026, responde
   * 404 "Not found.", que aqui vira erro com `status: 404`.
   */
  async andamentos(lawsuitId) {
    if (lawsuitId == null || lawsuitId === '') {
      throw new CAMINHO_INEXISTENTE('andamentos(lawsuitId) exige o id do processo.');
    }
    return this._lista(
      await this._req('GET', `/movements/${encodeURIComponent(lawsuitId)}`),
      `GET /movements/${lawsuitId}`
    );
  }

  /**
   * GET /last_movements — último andamento de CADA processo, um item por processo.
   *
   * ARMADILHA (campo perdido em lote): é a chamada barata, mas não traz o campo
   * `header`, que é o que diria se o andamento veio do tribunal ou foi escrito
   * pelo seu sistema. O exemplo da doc mostra o campo preenchido; medido em
   * 08/10/2026, ele não veio em nenhum dos 182 itens. Serve para descobrir ONDE
   * olhar; não serve para decidir a origem. Para isso, `andamentos(id)`.
   *
   * O padrão da rota é 100 itens por página (documentado), então ela é
   * paginada. O item não tem `id`: a chave é `lawsuit_id`.
   */
  async ultimosAndamentos() {
    return this._paginar('/last_movements', 'GET /last_movements', 'lawsuit_id');
  }

  /**
   * GET /history/{lawsuitId} — não é `/lawsuits/{id}/history`.
   *
   * ARMADILHA (teto fixo): a doc diz que a rota "retorna todas as tarefas do
   * processo de uma vez". Devolve no máximo 20, e não pagina (`offset` e `page`
   * são ignorados, como a doc avisa). Não há `totalCount` para denunciar o
   * corte. Medido: processo com 432 tarefas, 20 no histórico.
   *
   * Por isso, ao bater no teto, a listagem volta com `completa: false` e
   * `total: null` (o total real é desconhecido, e inventar um seria pior).
   *
   * @param {object} [opts]
   * @param {'pending'|'completed'|'all'} [opts.status] Filtro documentado, e
   *   funciona: reduz o recorte (16 pendentes onde o padrão trazia 20). O teto
   *   vale do mesmo jeito. Valor fora desses três é recusado aqui, porque a API
   *   ignora valor inválido em silêncio e devolve tudo.
   */
  async historico(lawsuitId, { status } = {}) {
    if (status != null && !STATUS_HISTORICO.includes(status)) {
      throw new CAMINHO_INEXISTENTE(
        `historico(): status "${status}" não existe. Use ${STATUS_HISTORICO.join(', ')}; ` +
        `a API ignora valor inválido e devolveria tudo.`
      );
    }
    const contexto = `GET /history/${lawsuitId}${status ? `?status=${status}` : ''}`;
    const qs = status ? `?status=${status}` : '';
    const { itens } = this._lista(
      await this._req('GET', `/history/${encodeURIComponent(lawsuitId)}${qs}`),
      contexto
    );
    if (itens.length < TETO_HISTORICO) {
      return { itens, total: itens.length, completa: true, faltando: 0 };
    }
    if (this._estrito) throw new RESPOSTA_TRUNCADA(contexto, itens.length, null);
    return { itens, total: null, completa: false, faltando: null };
  }

  // ── tarefas ────────────────────────────────────────────────────────────────

  /**
   * GET /posts — tarefas.
   *
   * ARMADILHA (conclusão por convidado): a conclusão não é da tarefa, é de cada
   * convidado (`users[].completed`). As duas janelas de `GET /posts` seguem isso:
   * - `created_*` traz a tarefa enquanto ALGUM convidado ainda não concluiu.
   *   A que todos concluíram sai dela;
   * - `completed_*` traz a tarefa assim que o PRIMEIRO convidado conclui.
   *
   * Então quem lê só a de criadas perde o trabalho terminado, e quem junta as
   * duas por concatenação conta duas vezes a tarefa concluída pela metade, que
   * está nas duas ao mesmo tempo (22 numa base de 3.356, medido). Pior ainda é
   * subtrair os ids das concluídas das criadas para achar "o que está aberto":
   * some a tarefa que ainda está aberta para alguém.
   *
   * Por isso o padrão aqui é buscar as DUAS e unir por `id`, com a origem
   * marcada em cada item (`_lista_origem`: 'criadas' | 'concluidas' | 'ambas').
   * "Aberta para quem" se responde com `convidadosPendentes(tarefa)`.
   *
   * `faltando` soma o que faltou nas duas listas, então é um teto: o que faltou
   * numa pode ser o mesmo que faltou na outra.
   *
   * `de` e `ate` são obrigatórios, no formato AAAA-MM-DD: ver `janela()`.
   */
  async tarefas({ de, ate } = {}) {
    const [criadas, concluidas] = await Promise.all([
      this.tarefasCriadas({ de, ate }),
      this.tarefasConcluidas({ de, ate }),
    ]);
    const porId = new Map();
    for (const t of criadas.itens) porId.set(t.id, { ...t, _lista_origem: 'criadas' });
    for (const t of concluidas.itens) {
      const ja = porId.get(t.id);
      porId.set(t.id, ja ? { ...ja, _lista_origem: 'ambas' } : { ...t, _lista_origem: 'concluidas' });
    }
    const itens = [...porId.values()];
    const faltando = criadas.faltando + concluidas.faltando;
    return {
      itens,
      total: itens.length + faltando,
      completa: criadas.completa && concluidas.completa,
      faltando,
      partes: { criadas, concluidas },
    };
  }

  /**
   * GET /posts com janela de CRIAÇÃO. Traz a tarefa enquanto algum convidado
   * ainda não concluiu; a que todos concluíram não vem.
   */
  async tarefasCriadas({ de, ate } = {}) {
    return this._paginar(`/posts${janela('created', de, ate)}`, 'GET /posts (criadas)');
  }

  /**
   * GET /posts com janela de CONCLUSÃO (a data é a da conclusão, não a da
   * criação). Traz a tarefa assim que o primeiro convidado conclui, mesmo com
   * outros ainda pendentes.
   */
  async tarefasConcluidas({ de, ate } = {}) {
    return this._paginar(`/posts${janela('completed', de, ate)}`, 'GET /posts (concluídas)');
  }
}

/**
 * Monta a janela de datas de `GET /posts`. As duas datas são obrigatórias.
 *
 * A doc avisa, e a medição confirma: mandar só uma data do par faz a API
 * IGNORAR o filtro inteiro. Só `created_start` declarou 191 tarefas, o mesmo
 * total de sem filtro nenhum; com o par, 66. E sem filtro a API não devolve "todas"
 * como a doc diz: devolve só as que têm convidado pendente. Então janela
 * incompleta aqui é erro, não um padrão silencioso.
 */
function janela(prefixo, de, ate) {
  const formato = /^\d{4}-\d{2}-\d{2}$/;
  const d = de == null ? '' : String(de).slice(0, 10);
  const a = ate == null ? '' : String(ate).slice(0, 10);
  if (!formato.test(d) || !formato.test(a)) {
    throw new CAMINHO_INEXISTENTE(
      `Janela de tarefas exige { de, ate } no formato AAAA-MM-DD (recebi de=${JSON.stringify(de)}, ` +
      `ate=${JSON.stringify(ate)}). Com uma data só, a API ignora o filtro e devolve outra coisa.`
    );
  }
  return `?${prefixo}_start=${d}&${prefixo}_end=${a}`;
}

module.exports = { AdvboxClient, BASE, INTERVALO_MIN_MS };
