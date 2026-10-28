/**
 * Cérebro alternativo: Gemini, sem Claude Code.
 *
 * Emula o que o Agent SDK entrega ao bridge (system/init, stream_event com
 * text_delta, result), então o resto do server.mjs funciona sem mudanças:
 * streaming de fala, barge-in (interrupt) e erros falados.
 *
 * Ferramentas (MCP, blades, Chrome, celular) NÃO existem neste modo: é conversa
 * por voz, com busca do Google opcional (GEMINI_SEARCH=1).
 */

import { readFileSync, writeFileSync } from 'node:fs'

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const MAX_HISTORY = 30 // mensagens (user + model) mantidas no contexto

/**
 * Velocidade. Os modelos Gemini 3 "pensam" antes de responder, o que soma
 * segundos numa conversa por voz. GEMINI_THINKING controla isso: low (padrão),
 * minimal, medium, high, ou off para não enviar nada. Se o modelo recusar o
 * parâmetro, o bridge avisa e segue sem ele.
 */
const THINKING = (process.env.GEMINI_THINKING ?? 'low').trim().toLowerCase()
const TIMING = process.env.JARVIS_TIMING !== '0'

/**
 * Memória entre sessões: guarda as últimas mensagens em bridge/memoria.json
 * (só no seu computador) e recarrega ao abrir. JARVIS_MEMORY=0 desliga.
 * Para apagar o que ele lembra, apague o arquivo.
 */
const MEMORY_ON = process.env.JARVIS_MEMORY !== '0'
const MEMORY_FILE = process.env.JARVIS_MEMORY_FILE ?? new URL('./memoria.json', import.meta.url)
function loadMemory() {
  if (!MEMORY_ON) return []
  try {
    const a = JSON.parse(readFileSync(MEMORY_FILE, 'utf8'))
    if (!Array.isArray(a)) return []
    const ok = a.filter(
      (m) => (m?.role === 'user' || m?.role === 'model') && typeof m?.parts?.[0]?.text === 'string',
    )
    while (ok.length && ok[0].role !== 'user') ok.shift()
    return ok.slice(-MAX_HISTORY)
  } catch {
    return []
  }
}
function saveMemory(h) {
  if (!MEMORY_ON) return
  try {
    writeFileSync(MEMORY_FILE, JSON.stringify(h))
  } catch {
    /* memória é opcional */
  }
}
const TRANSIENT = new Set([500, 502, 503, 504]) // sobrecarga do lado do Google
const RETRY_DELAYS_MS = [400, 900] // 3 tentativas por modelo

/** Espera, mas acorda na hora se o usuário interromper (barge-in). */
const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true })
  })

export const GEMINI_PROMPT = `Você é o JARVIS. Fala em voz alta com uma única pessoa.

Responda SEMPRE em português do Brasil.

TAMANHO. Duas frases é o teto numa conversa; o normal é menos de doze palavras.
Tudo é lido em voz alta e o usuário espera em silêncio, então resposta longa é
falha, por melhor que seja. Só alongue ao ler dados que ele pediu.

TOM. Mordomo britânico, seco e preciso. Sem entusiasmo, sem "claro!", sem "com
prazer", sem pedir desculpas, sem enrolação. Sucesso é dito sem moldura: "O
cálculo está concluído." Falha é um fato sobre o mundo: "Infelizmente, não há
registro disso." "Senhor" no fim da frase é cortesia de rotina; no começo
("Senhor, a bateria está em onze por cento") indica urgência. Use em cerca de
metade das falas, nunca duas vezes na mesma.

HUMOR. Seco, no mesmo tom de um relatório de status. Nunca sinalize a piada.

FORMATO. Apenas prosa falada. Sem markdown, sem listas, sem títulos, sem emoji,
sem asteriscos. Escreva números, datas e horas como se fala: "oito e quinze",
"primeiro de agosto", nunca "8:15" nem "2026-08-01".

Se precisar de informação atual e tiver busca disponível, use-a e responda só o
essencial. Se não souber, diga que não há registro, sem inventar.`

/**
 * Personalidade editável: bridge/personalidade.txt (ou JARVIS_PROMPT_FILE).
 * É relida a cada fala, então editar o arquivo vale na próxima resposta, sem
 * reiniciar o bridge. Se o arquivo não existir, usa o prompt embutido.
 */
const PROMPT_FILE = process.env.JARVIS_PROMPT_FILE ?? new URL('./personalidade.txt', import.meta.url)
function personalidade(fallback) {
  try {
    const t = readFileSync(PROMPT_FILE, 'utf8').trim()
    if (t) return t
  } catch {
    /* sem arquivo: usa o embutido */
  }
  return fallback
}

/** Data e hora locais do PC (o Gemini não tem relógio). JARVIS_TZ força um fuso. */
function agora() {
  return new Date().toLocaleString('pt-BR', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: process.env.JARVIS_TZ || undefined,
  })
}

/** Extrai o texto falável de um evento SSE do Gemini (ignora "pensamento"). */
function textOf(evt) {
  const parts = evt?.candidates?.[0]?.content?.parts ?? []
  let out = ''
  for (const p of parts) {
    if (p?.thought) continue
    if (typeof p?.text === 'string') out += p.text
  }
  return out
}

/** Lê o corpo SSE e entrega o texto de cada evento `data:`. */
async function* sseTexts(res) {
  const decoder = new TextDecoder()
  let buf = ''
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '')
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const raw = line.slice(5).trim()
      if (!raw || raw === '[DONE]') continue
      try {
        const t = textOf(JSON.parse(raw))
        if (t) yield t
      } catch {
        /* linha parcial ou evento sem texto */
      }
    }
  }
}

async function errorText(res) {
  try {
    const j = await res.json()
    return j?.error?.message ?? `HTTP ${res.status}`
  } catch {
    return `HTTP ${res.status}`
  }
}

/**
 * @param {object} o
 * @param {AsyncIterable<{message:{content:string}}>} o.input  mensagens do usuário
 * @param {string} o.apiKey
 * @param {string} o.model
 * @param {string} [o.systemPrompt]
 * @param {boolean} [o.search]  liga Grounding with Google Search
 * @param {string} [o.baseUrl]
 */
export function geminiSession({
  input,
  apiKey,
  model,
  systemPrompt = GEMINI_PROMPT,
  search = false,
  baseUrl = process.env.GEMINI_BASE_URL ?? DEFAULT_BASE,
}) {
  const history = loadMemory()
  let controller = null
  let closed = false
  let searchWorks = search
  let warnedSearch = false
  let thinkingWorks = THINKING !== '' && THINKING !== 'off'
  let warnedThinking = false

  async function* run() {
    yield { type: 'system', subtype: 'init', mcp_servers: [] }

    for await (const m of input) {
      if (closed) return
      const text = m?.message?.content
      if (typeof text !== 'string' || !text.trim()) continue

      history.push({ role: 'user', parts: [{ text }] })
      while (history.length > MAX_HISTORY) history.shift()
      while (history.length && history[0].role !== 'user') history.shift()
      const t0 = Date.now()
      let tFirst = 0

      controller = new AbortController()
      const signal = controller.signal
      let full = ''

      try {
        const call = (withSearch, useModel = model) =>
          fetch(
            `${baseUrl}/models/${encodeURIComponent(useModel)}:streamGenerateContent?alt=sse`,
            {
              method: 'POST',
              signal,
              headers: {
                'content-type': 'application/json',
                'x-goog-api-key': apiKey,
              },
              body: JSON.stringify({
                systemInstruction: {
                  parts: [
                    {
                      text: `${personalidade(systemPrompt)}\n\nData e hora atuais do usuário: ${agora()}. Use isto para responder sobre hora, data e dia da semana.`,
                    },
                  ],
                },
                contents: history,
                ...(withSearch ? { tools: [{ google_search: {} }] } : {}),
                generationConfig: {
                  // Folga para o "pensamento", que conta no limite de saída.
                  maxOutputTokens: 1024,
                  temperature: 0.8,
                  ...(thinkingWorks ? { thinkingConfig: { thinkingLevel: THINKING } } : {}),
                },
              }),
            },
          )

        // Tenta de novo em picos de demanda (503 etc.) e, se persistir, usa o
        // modelo reserva (GEMINI_FALLBACK_MODEL), se houver.
        const fallback = process.env.GEMINI_FALLBACK_MODEL
        const chain = [model, ...(fallback && fallback !== model ? [fallback] : [])]
        const send = async (withSearch) => {
          let r
          for (const m of chain) {
            for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
              r = await call(withSearch, m)
              if (r.ok || !TRANSIENT.has(r.status)) {
                if (r.ok && m !== model) {
                  console.warn(`[jarvis] respondendo com o modelo reserva ${m}.`)
                }
                return r
              }
              await r.body?.cancel().catch(() => {})
              if (i < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[i], signal)
              if (signal.aborted) return r
            }
            console.warn(`[jarvis] ${m} sobrecarregado (${r.status}).`)
          }
          return r
        }

        let res = await send(searchWorks)
        let why = ''

        // 400/403: ou o modelo não aceita o parâmetro de pensamento, ou a busca
        // do Google exige faturamento. Corrige o que for e tenta de novo, em vez
        // de deixar o Jarvis mudo.
        for (let fix = 0; fix < 2 && !res.ok && (res.status === 400 || res.status === 403); fix++) {
          why = await errorText(res)
          if (thinkingWorks && /think/i.test(why)) {
            thinkingWorks = false
            if (!warnedThinking) {
              warnedThinking = true
              console.warn(`[jarvis] modelo recusou o nível de pensamento (${why}). Seguindo sem ele.`)
            }
          } else if (searchWorks) {
            if (!warnedSearch) {
              warnedSearch = true
              console.warn(`[jarvis] busca do Google indisponível (${why}). Seguindo sem busca.`)
            }
            searchWorks = false
          } else break
          res = await send(searchWorks)
          why = ''
        }

        if (!res.ok) {
          why = why || (await errorText(res))
          console.error(`[jarvis] Gemini recusou (${res.status}): ${why}`)
          history.pop() // a pergunta não foi respondida
          yield { type: 'result', subtype: 'error_gemini', errors: [why] }
          continue
        }

        for await (const delta of sseTexts(res)) {
          if (!tFirst) tFirst = Date.now()
          full += delta
          yield {
            type: 'stream_event',
            event: { type: 'content_block_delta', delta: { type: 'text_delta', text: delta } },
          }
        }

        if (full) {
          history.push({ role: 'model', parts: [{ text: full }] })
          saveMemory(history)
        } else history.pop()
        if (TIMING) {
          console.log(
            `[jarvis] gemini: primeiro trecho em ${tFirst ? tFirst - t0 : '—'} ms, resposta completa em ${Date.now() - t0} ms`,
          )
        }
        yield { type: 'result', subtype: 'success', result: full, total_cost_usd: 0 }
      } catch (err) {
        if (signal.aborted) {
          // Barge-in: guarda o que foi dito e fecha o turno normalmente.
          if (full) history.push({ role: 'model', parts: [{ text: full }] })
          else history.pop()
          yield { type: 'result', subtype: 'success', result: full, total_cost_usd: 0 }
          continue
        }
        console.error('[jarvis] erro no Gemini:', err)
        history.pop()
        yield { type: 'result', subtype: 'error_gemini', errors: [String(err?.message ?? err)] }
      } finally {
        controller = null
      }
    }
  }

  const it = run()
  return {
    [Symbol.asyncIterator]: () => it,
    interrupt: async () => controller?.abort(),
    close: () => {
      closed = true
      controller?.abort()
    },
  }
}
