'use strict';

const { RESPOSTA_TRUNCADA, CAMINHO_INEXISTENTE } = require('./erros');

const BASE = 'https://app.advbox.com.br/api/v1';

// A API limita GET a 30/min. Excedeu, devolve 429. Um espaçamento mínimo entre
// chamadas custa quase nada e evita o 429 — que é caro, porque chega no meio de
// uma varredura e deixa metade dos dados para trás.
const INTERVALO_MIN_MS = 2100;
const TIMEOUT_PADRAO_MS = 15000;

/**
 * Cliente da API do ADVBOX.
 *
 * O que este cliente faz de diferente de um wrapper qualquer: ele não devolve
 * lista crua. Toda listagem volta como {itens, total, completa} — porque a API
 * devolve menos do que ela mesma declara, e quem recebe um array não tem como
 * saber disso. Ver README, seção "As quatro armadilhas não documentadas".
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
   * nunca vem de fora. Isso é deliberado: caminho inexistente nesta API responde
   * 200 com lista vazia, não 404, então caminho montado por quem chama é uma
   * fonte silenciosa de "não tem dado" quando na verdade tem.
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
        // A mensagem nunca inclui o token: só método, caminho e o que a API disse.
        const err = new Error(`ADVBOX ${metodo} ${caminho} → ${r.status}: ${String(msg).slice(0, 300)}`);
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
   * ARMADILHA (listagem truncada): `GET /customers` já devolveu 377 declarando
   * `totalCount: 447` no mesmo corpo. `GET /posts`, 157 declarando 169. Paginar
   * por offset não alcança o resto. Quem recebe só o array acha que tem a base
   * inteira — e uma auditoria em cima disso acusa gente que está cadastrada.
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

  // ── configurações da conta ─────────────────────────────────────────────────

  /**
   * GET /settings — todos os ids da conta (usuários, etapas, tipos, origens...).
   * Consultar ANTES dos outros: nenhum id deve ser fixado no código.
   */
  async settings() {
    return this._req('GET', '/settings');
  }

  // ── clientes ───────────────────────────────────────────────────────────────

  /** GET /customers — @returns {{itens, total, completa, faltando}} */
  async clientes({ limit = 1000 } = {}) {
    return this._lista(await this._req('GET', `/customers?limit=${limit}`), 'GET /customers');
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

  /** GET /customers/birthdays */
  async aniversariantes() {
    return this._lista(await this._req('GET', '/customers/birthdays'), 'GET /customers/birthdays');
  }

  // ── processos ──────────────────────────────────────────────────────────────

  /** GET /lawsuits */
  async processos({ limit = 1000 } = {}) {
    return this._lista(await this._req('GET', `/lawsuits?limit=${limit}`), 'GET /lawsuits');
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
   * existe e a API responde 200 com lista vazia em vez de 404 — o que se lê como
   * "este processo não tem andamento". Em um caso real havia 23 movimentações do
   * tribunal num processo dado como parado.
   *
   * Este é o único método que traz `header` preenchido, e é o `header` que
   * distingue andamento do tribunal do que o seu próprio sistema escreveu.
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
   * GET /last_movements — último andamento de CADA processo, numa chamada só.
   *
   * ARMADILHA (campo perdido em lote): é a chamada barata, mas devolve `header` NULO em todos os
   * registros — justamente o campo que diria se o andamento veio do tribunal ou
   * foi escrito pelo seu sistema. Serve para descobrir ONDE olhar; não serve
   * para decidir a origem. Para isso, `andamentos(id)`, um processo por vez.
   */
  async ultimosAndamentos() {
    return this._lista(await this._req('GET', '/last_movements'), 'GET /last_movements');
  }

  /** GET /history/{lawsuitId} — não é `/lawsuits/{id}/history`. */
  async historico(lawsuitId) {
    return this._lista(
      await this._req('GET', `/history/${encodeURIComponent(lawsuitId)}`),
      `GET /history/${lawsuitId}`
    );
  }

  // ── tarefas ────────────────────────────────────────────────────────────────

  /**
   * GET /posts — tarefas.
   *
   * ARMADILHA (listas exclusivas): `created_*` e `completed_*` são MUTUAMENTE
   * EXCLUSIVAS. Tarefa concluída SAI da lista de criadas e passa a existir só na
   * de concluídas. Lendo uma só, metade do histórico some sem nenhum aviso — e o
   * que some é exatamente o trabalho que foi terminado.
   *
   * Por isso o padrão aqui é buscar as DUAS e devolver junto, com a origem
   * marcada em cada item (`_lista_origem`). Para uma só, use `tarefasCriadas` ou
   * `tarefasConcluidas` e assuma o buraco conscientemente.
   */
  async tarefas({ de, ate } = {}) {
    const [criadas, concluidas] = await Promise.all([
      this.tarefasCriadas({ de, ate }),
      this.tarefasConcluidas({ de, ate }),
    ]);
    const itens = [
      ...criadas.itens.map(t => ({ ...t, _lista_origem: 'criadas' })),
      ...concluidas.itens.map(t => ({ ...t, _lista_origem: 'concluidas' })),
    ];
    return {
      itens,
      total: criadas.total + concluidas.total,
      completa: criadas.completa && concluidas.completa,
      faltando: criadas.faltando + concluidas.faltando,
      partes: { criadas, concluidas },
    };
  }

  /** GET /posts com janela de CRIAÇÃO. Não inclui tarefa concluída. */
  async tarefasCriadas({ de, ate } = {}) {
    const qs = janela('created', de, ate);
    return this._lista(await this._req('GET', `/posts${qs}`), 'GET /posts (criadas)');
  }

  /** GET /posts com janela de CONCLUSÃO. Só tarefa concluída. */
  async tarefasConcluidas({ de, ate } = {}) {
    const qs = janela('completed', de, ate);
    return this._lista(await this._req('GET', `/posts${qs}`), 'GET /posts (concluídas)');
  }
}

function janela(prefixo, de, ate) {
  const p = new URLSearchParams();
  if (de) p.set(`${prefixo}_start`, String(de).slice(0, 10));
  if (ate) p.set(`${prefixo}_end`, String(ate).slice(0, 10));
  const s = p.toString();
  return s ? '?' + s : '';
}

module.exports = { AdvboxClient, BASE, INTERVALO_MIN_MS };
