// Troca a palavra de ativação "Hey Jarvis" por "Eaí Jarvis".
// Uso (na pasta do projeto):  node aplicar-eai.mjs
// Pode rodar mais de uma vez: o que já foi trocado é ignorado.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))

const troca = [
  {
    arquivo: 'src/ui/Hud.tsx',
    de: 'STANDBY — SAY “HEY JARVIS”',
    para: 'STANDBY — DIGA “EAÍ JARVIS”',
  },
  {
    arquivo: 'src/ui/Hud.tsx',
    de: 'say <b>“hey jarvis”</b>',
    para: 'diga <b>“eaí jarvis”</b>',
  },
  {
    arquivo: 'src/ui/Suggestions.tsx',
    de: '“hey jarvis, {EXAMPLES[i]}”',
    para: '“eaí jarvis, {EXAMPLES[i]}”',
  },
  // App.tsx: tira "eaí / e aí / eai, / ei" do começo da frase antes de mandar ao modelo.
  {
    arquivo: 'src/App.tsx',
    de: '(?:hey|hi|ok|okay|yo)?\\\\s*${NAME}',
    para: '(?:e\\\\s?a[ií]|eae|ei|hey|hi|ok|okay|yo)?[,.]?\\\\s*${NAME}',
    todas: true,
  },
]

let falhas = 0
for (const t of troca) {
  const p = join(root, t.arquivo)
  let s
  try {
    s = readFileSync(p, 'utf8')
  } catch {
    console.log(`[ falta ] ${t.arquivo} não encontrado`)
    falhas++
    continue
  }
  const n = s.split(t.de).length - 1
  if (n === 0) {
    const ja = s.includes(t.para)
    console.log(`[ ${ja ? 'já   ' : 'FALHOU'} ] ${t.arquivo}: ${t.de.slice(0, 40)}`)
    if (!ja) falhas++
    continue
  }
  if (n > 1 && !t.todas) {
    console.log(`[FALHOU] ${t.arquivo}: trecho aparece ${n} vezes`)
    falhas++
    continue
  }
  writeFileSync(p, s.split(t.de).join(t.para), 'utf8')
  console.log(`[  ok  ] ${t.arquivo}: ${n} troca(s)`)
}
console.log(falhas ? `\n${falhas} item(ns) não aplicado(s). Me mande esta saída.` : '\nPronto. A página recarrega sozinha; senão, Ctrl+F5.')
