# J.A.R.V.I.S. — versão em português (Gemini + Fish Audio)

Assistente de voz no navegador com interface holográfica estilo Iron Man. Você fala, ele ouve, pensa e responde em voz alta, em português do Brasil.

Esta é uma **adaptação** de um projeto open source. O trabalho original, a interface e a arquitetura são de **[adewaskar/jarvis](https://github.com/adewaskar/jarvis)** (licença MIT). Meu trabalho aqui foi adaptar o cérebro, o idioma, a voz e a personalidade, descritos abaixo.

## O que muda em relação ao original

| Parte | Original | Esta versão |
|---|---|---|
| Cérebro | Claude Code (precisa de assinatura ou créditos) | **Gemini**, pela API do Google (`JARVIS_BRAIN=gemini`) |
| Idioma | Inglês britânico | **Português do Brasil** (fala, voz e prompt) |
| Voz | Navegador ou ElevenLabs | Navegador ou **Fish Audio**, tocando em **streaming** |
| Personalidade | Fixa no código, em inglês | **Arquivo de texto editável** (`bridge/personalidade.txt`), relido a cada resposta |
| Palavra de ativação | "Hey Jarvis" | "Eaí Jarvis" (e "Jarvis" sozinho) |
| Memória | Só durante a sessão | Últimas mensagens guardadas **no seu computador** |
| Falhas do Google | — | Tentativas automáticas e modelo reserva em picos de demanda (erro 503) |

O modo original com Claude Code continua existindo: sem `JARVIS_BRAIN=gemini`, o bridge se comporta como antes.

### O que esta versão **não** faz

No modo Gemini o Jarvis só **conversa** (e pesquisa no Google, se você ligar a busca). Não controla o computador, o celular, o navegador nem arquivos, e não abre painéis nem usa servidores MCP. Isso é do modo original com Claude Code.

---

## Requisitos

- **Node.js 20 ou mais novo**
- **Google Chrome ou Microsoft Edge**, numa janela normal (painéis de preview de editores bloqueiam o microfone)
- Uma **chave da API do Gemini** (https://aistudio.google.com/apikey)
- Opcional: uma **chave do Fish Audio** (https://fish.audio/app/api-keys) e o ID de uma voz da biblioteca

Os limites e preços das camadas gratuitas do Gemini e do Fish mudam sem aviso. Confira nas páginas deles antes de depender de qualquer um.

---

## Instalação

```bash
git clone https://github.com/NiicolasPereira/Jarvis.git
cd SEU_REPO
npm install
```

Crie um arquivo `.env` na raiz do projeto (ele já está no `.gitignore`, **nunca o envie para o GitHub**):

```
JARVIS_BRAIN=gemini
GEMINI_API_KEY=cole_sua_chave
GEMINI_MODEL=id_de_um_modelo_flash

# opcional: voz do Fish Audio
FISH_API_KEY=
FISH_VOICE_ID=
```

Use o ID de um modelo Flash que a sua chave enxerga. Para listar:

```bash
curl -s -H "x-goog-api-key: SUA_CHAVE" "https://generativelanguage.googleapis.com/v1beta/models"
```

## Como rodar

Dois terminais, ambos na pasta do projeto:

```bash
npm run bridge     # o cérebro
```

```bash
npm run dev        # a interface
```

Abra http://localhost:5173 no Chrome ou Edge, clique em **INITIALISE**, permita o microfone e diga **"Eaí Jarvis"**. A tecla **Espaço** fala sem a palavra de ativação, **V** troca a voz do navegador e **D** abre o diagnóstico.

---

## Configuração

Tudo vai no `.env` (variáveis digitadas no terminal têm prioridade). Reinicie o bridge depois de mudar.

| Variável | Para que serve |
|---|---|
| `JARVIS_BRAIN` | `gemini` ou `claude` (padrão: `claude`) |
| `GEMINI_API_KEY` | Chave da API do Gemini |
| `GEMINI_MODEL` | ID do modelo principal |
| `GEMINI_FALLBACK_MODEL` | Modelo reserva, usado se o principal ficar sobrecarregado |
| `GEMINI_THINKING` | Nível de "pensamento": `minimal`, `low` (padrão), `medium`, `high` ou `off`. Menos pensamento responde mais rápido |
| `GEMINI_SEARCH` | `1` liga a busca do Google (pode exigir faturamento ativo na sua conta do Google) |
| `FISH_API_KEY` / `FISH_VOICE_ID` | Voz via Fish Audio |
| `FISH_MODEL` | Padrão `s2.1-pro-free` (gratuito, sem garantia de latência) |
| `FISH_LATENCY` | `balanced` (padrão), `low` ou `normal` |
| `JARVIS_MEMORY` | `0` desliga a memória entre sessões |
| `JARVIS_TIMING` | `0` esconde os tempos de resposta no terminal |
| `JARVIS_TZ` | Fuso horário, ex.: `America/Sao_Paulo` |

### Personalidade

Edite `bridge/personalidade.txt`. O bridge relê o arquivo a cada fala, então a mudança vale na **próxima resposta**, sem reiniciar. Se o arquivo estiver vazio ou sumir, ele usa um prompt básico embutido.

### Memória

As últimas mensagens ficam em `bridge/memoria.json`, **só no seu computador** (o arquivo está no `.gitignore`). Para apagar o que ele lembra, apague o arquivo.

---

## Medindo a velocidade

Cada resposta imprime no terminal do bridge:

```
[jarvis] gemini: primeiro trecho em ... ms, resposta completa em ... ms
[jarvis] voz Fish: ... ms até começar, ... ms no total (... caracteres)
```

Dicas que funcionaram nos meus testes:

- A voz só começa quando a **frase inteira** está pronta, e o tempo da síntese cresce com o tamanho da frase. Frases curtas (a personalidade já pede isso) respondem mais rápido.
- Modelos diferentes do Gemini têm tempos bem diferentes, e variam ao longo do dia. Meça o seu antes de escolher.

---

## Segurança e privacidade

- **Nunca envie o `.env`** nem cole chaves em chats, prints ou vídeos. Se uma chave vazar, apague-a no painel do serviço e gere outra.
- O áudio do microfone é transcrito pelo reconhecimento de fala do navegador (no Chrome, isso passa pelos servidores do Google). O texto das perguntas vai para a API do Gemini, e o texto das respostas para o Fish Audio, se você usar essa voz.
- O bridge só aceita conexões locais por padrão.

## Direitos e licença

- O código segue a licença **MIT**. O arquivo `LICENSE` com o nome do autor original deve ser mantido.
- A música de abertura em `public/audio/` acompanha o projeto original **só para demonstração**. Se você for publicar vídeos ou usar comercialmente, resolva os direitos dela ou apague o arquivo.
- Use uma voz que você tenha **direito de usar**. Não clone a voz de pessoas reais sem autorização.

## Créditos

- Projeto original, interface e arquitetura: **[adewaskar/jarvis](https://github.com/adewaskar/jarvis)** (MIT)
- Adaptação para português, Gemini, Fish Audio, streaming de voz e personalidade: **Nicolas Pereira**

Dúvidas e sugestões: abra uma issue ou me chame no [LinkedIn](COLOQUE_SEU_LINK).
