// Faz o navegador começar a tocar a voz do bridge enquanto o áudio ainda chega
// (em vez de esperar o áudio inteiro). Altera só src/lib/tts.ts.
//
//   node aplicar-streaming.mjs             aplica (faz backup em tts.ts.bak)
//   node aplicar-streaming.mjs --desfazer  volta ao arquivo original
//
// Escape sem desfazer: no console do navegador (F12),
//   localStorage.setItem('jarvis.stream', '0'); location.reload()
// volta ao modo antigo. Para ligar de novo: localStorage.removeItem('jarvis.stream')
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const alvo = join(root, 'src/lib/tts.ts')
const backup = alvo + '.bak'

if (process.argv.includes('--desfazer')) {
  if (!existsSync(backup)) {
    console.log('Não há backup (tts.ts.bak). Nada a desfazer.')
    process.exit(1)
  }
  copyFileSync(backup, alvo)
  console.log('Desfeito: tts.ts voltou ao original.')
  process.exit(0)
}

let s = readFileSync(alvo, 'utf8')
if (s.includes('streamBridgeAudio')) {
  console.log('Já aplicado. Nada a fazer.')
  process.exit(0)
}
const eol = s.includes('\r\n') ? '\r\n' : '\n'
const L = (t) => t.replace(/\r?\n/g, eol)

const trocas = [
  // 1) speakOne: se o streaming falhar antes de sair som, refaz a frase pelo caminho antigo.
  {
    de: L(`      if (url) {
        await playUrl(url, item.text)
        return
      }
`),
    para: L(`      if (url) {
        const soundsBefore = diag.started
        await playUrl(url, item.text)
        // O streaming quebrou antes de sair som: refaz esta frase pelo caminho
        // antigo (streamBroken já está ligado, então vem como arquivo inteiro).
        if (diag.started === soundsBefore && streamBroken && !cancelled) {
          const again = await fetchCloudAudio(item.text).catch(() => null)
          if (again && !cancelled) await playUrl(again, item.text)
        }
        return
      }
`),
  },
  // 2) fetchCloudAudio: tenta o streaming primeiro.
  {
    de: L(`  if (BACKEND === 'bridge') {
    try {
      const res = await fetch(\`\${BRIDGE_HTTP_URL}/tts\`, {`),
    para: L(`  if (BACKEND === 'bridge') {
    // undefined = streaming indisponível (usa o arquivo inteiro);
    // null = o bridge recusou (não adianta pedir de novo).
    let streamed: string | null | undefined
    try {
      streamed = await streamBridgeAudio(text)
    } catch {
      streamed = undefined
    }
    if (streamed) return streamed
    try {
      if (streamed === null) throw new Error('bridge refused')
      const res = await fetch(\`\${BRIDGE_HTTP_URL}/tts\`, {`),
  },
  // 3) playUrl: erro do elemento numa URL de streaming = streaming quebrado.
  {
    de: L(`        diag.failures++
        diag.lastError = 'audio-element'
        finish()`),
    para: L(`        diag.failures++
        diag.lastError = 'audio-element'
        if (streamUrls.has(url)) streamBroken = true
        finish()`),
  },
  // 4) playUrl: play() rejeitado numa URL de streaming.
  {
    de: L(`        diag.lastError = String((err as Error)?.name ?? 'play-rejected')
        finish()`),
    para: L(`        diag.lastError = String((err as Error)?.name ?? 'play-rejected')
        if (streamUrls.has(url)) streamBroken = true
        finish()`),
  },
]

for (const t of trocas) {
  const n = s.split(t.de).length - 1
  if (n !== 1) {
    console.log(`FALHOU: trecho esperado apareceu ${n} vez(es). Nada foi alterado. Me mande esta mensagem.`)
    console.log(t.de.slice(0, 120))
    process.exit(1)
  }
}
for (const t of trocas) s = s.split(t.de).join(t.para)

s += L(`
// ---------------------------------------------------------------------------
// Voz do bridge em streaming
// ---------------------------------------------------------------------------

/** Ligado quando o streaming falha de verdade; dali em diante, arquivo inteiro. */
let streamBroken = false
/** URLs criadas por streamBridgeAudio, para reconhecer falhas delas em playUrl. */
const streamUrls = new Set<string>()

const appendChunk = (sb: SourceBuffer, chunk: Uint8Array) =>
  new Promise<void>((resolve, reject) => {
    const ok = () => {
      sb.removeEventListener('error', bad)
      resolve()
    }
    const bad = () => {
      sb.removeEventListener('updateend', ok)
      reject(new Error('append-error'))
    }
    sb.addEventListener('updateend', ok, { once: true })
    sb.addEventListener('error', bad, { once: true })
    sb.appendBuffer(
      chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer,
    )
  })

/**
 * Pede a voz ao bridge e devolve uma URL tocável assim que a resposta COMEÇA,
 * sem esperar o áudio inteiro. O áudio é empurrado para um MediaSource enquanto
 * chega. Devolve undefined se o navegador não suporta (usa o caminho antigo) e
 * null se o bridge recusou o pedido.
 */
async function streamBridgeAudio(text: string): Promise<string | null | undefined> {
  if (streamBroken) return undefined
  try {
    if (localStorage.getItem('jarvis.stream') === '0') return undefined
  } catch {
    /* sem localStorage: segue */
  }
  if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported('audio/mpeg')) {
    return undefined
  }

  const res = await fetch(\`\${BRIDGE_HTTP_URL}/tts\`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok || !res.body) return null

  const ms = new MediaSource()
  const reader = res.body.getReader()
  // O MediaSource só abre quando a URL é ligada a um <audio> (em playUrl).
  ms.addEventListener(
    'sourceopen',
    () => {
      void (async () => {
        try {
          const sb = ms.addSourceBuffer('audio/mpeg')
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            if (ms.readyState !== 'open') {
              void reader.cancel() // frase cancelada: para de baixar
              return
            }
            await appendChunk(sb, value)
          }
          if (ms.readyState === 'open') ms.endOfStream()
        } catch (err) {
          void reader.cancel().catch(() => {})
          if ((err as Error)?.message === 'append-error') {
            streamBroken = true
            console.warn('[jarvis] voz em streaming falhou — voltando ao áudio inteiro')
          }
        }
      })()
    },
    { once: true },
  )
  const mediaUrl = URL.createObjectURL(ms)
  streamUrls.add(mediaUrl)
  return mediaUrl
}
`)
if (!existsSync(backup)) copyFileSync(alvo, backup)
writeFileSync(alvo, s, 'utf8')
console.log('Aplicado em src/lib/tts.ts (backup em tts.ts.bak). A página recarrega sozinha; senão, Ctrl+F5.')
