# Triminó

Dominó triangular multijogador (2 a 4 pessoas) com áudio e vídeo entre os participantes.
Roda na Cloudflare: um Worker com Durable Objects e D1 serve o site, o cliente web e o WebSocket das mesas. Há também um app Android nativo, e todos falam o mesmo protocolo.

```
shared/   regras do jogo, geometria da grade triangular e tipos do protocolo e da API (TypeScript)
server/   Cloudflare Worker: API, login, mesas (Durable Objects), contas e estatísticas (D1)
web/      site (landing, varanda) e cliente do jogo (Vite + TypeScript)
android/  app Android (Kotlin + Jetpack Compose + WebRTC nativo)
scripts/  smoke test do protocolo
```

### Na Cloudflare

| Peça | Recurso | Para quê |
| --- | --- | --- |
| `server/src/worker.ts` | Worker | API (`/api/*`), login com Google (`/auth/*`), WebSocket (`/ws?sala=CODIGO`); o resto vai para os assets (`web/dist`) |
| `server/src/mesa.ts` | Durable Object `Mesa` | uma instância por mesa: partida em memória, WebSockets, sinalização WebRTC |
| `server/migrations/` | D1 `trimino` | contas, sessões, lista de mesas da varanda, partidas e estatísticas |

## Como rodar

```bash
npm install
npm run db:migrate        # cria as tabelas no D1 local (uma vez, e a cada migração nova)
npm run dev:server        # wrangler dev em http://localhost:8787
npm run dev:web           # site em http://localhost:5173 (proxy de /api, /auth e /ws para o wrangler)
```

Abra `http://localhost:5173`, entre como convidado e crie uma mesa na varanda. Para jogar contra si mesmo, abra a mesa numa janela anônima.

As variáveis do dev ficam em `server/.dev.vars` (veja `server/.dev.vars.example`). Sem `.dev.vars`, o wrangler lê o `server/.env`.

### Publicar

```bash
cd server
npx wrangler d1 create trimino                    # uma vez: copie o database_id para o wrangler.jsonc
npx wrangler secret put GOOGLE_CLIENT_ID          # opcional: login com Google
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put PUBLIC_URL                # ex.: https://trimino.exemplo.com
npx wrangler secret put DEEPSEEK_API_KEY          # opcional: jogadores IA
cd .. && npm run deploy                           # compila o site, aplica as migrações no D1 e publica
```

**Login com Google:** crie um "ID do cliente OAuth" do tipo aplicativo da Web no Google Cloud Console e cadastre `<PUBLIC_URL>/auth/google/callback` como URI de redirecionamento. Sem `GOOGLE_CLIENT_ID`, o botão do Google não aparece.

**Android:** abra a pasta `android/` no Android Studio ou rode `./gradlew assembleDebug`.
No lobby do app, informe o endereço do servidor:
- `ws://10.0.2.2:8787/ws` no emulador;
- `ws://<IP-da-máquina>:8787/ws` num aparelho na mesma rede (rode `npx wrangler dev --ip 0.0.0.0`);
- `wss://<seu-domínio>/ws` em produção.

O app entra como convidado e ainda não tem a varanda nem os pedidos de videoconferência dos espectadores.

### Testes

```bash
npm test                  # regras do jogo (vitest)
npm run typecheck
npm run smoke             # partida completa e espectadores contra o wrangler dev (TRIMINO_WS=ws://host:porta/ws para outro)
npm run fixtures          # regenera os exemplos de estado usados no teste de protocolo do Android
cd android && ./gradlew testDebugUnitTest
```

## Site, contas e varanda

- **Landing page** (`/`): apresenta o jogo e tem o login. Dá para criar conta com e-mail e senha, entrar com o Google ou jogar como **convidado**, só com um nome.
- **Contas:** senha guardada com PBKDF2-SHA256 (100 mil iterações, sal aleatório). A sessão fica num cookie `HttpOnly` de 30 dias, e o D1 guarda só o hash do token. Se alguém entra com o Google usando um e-mail verificado que já tem conta, as duas formas de login passam a abrir a mesma conta.
- **Varanda** (`/varanda`): lista as mesas abertas, quem está sentado em cada uma, a pontuação, os lugares livres e quantos estão assistindo. Dali dá para **sentar**, **assistir** ou **armar uma mesa** (com nome, e privada se quiser; mesa privada não aparece na lista, só entra quem tem o link). A lista atualiza a cada 4 segundos.
- **Link da mesa:** `/mesa/CODIGO`. Quem abre sem ter entrado passa antes pela landing (com a aba de convidado já aberta) e depois cai direto na mesa. Os links antigos `?sala=CODIGO` continuam funcionando.
- **WhatsApp:** o botão do WhatsApp no topo da mesa e na tela de espera abre o WhatsApp com o convite e o link da mesa prontos.

## Espectadores

- Quem entra por **Assistir**, ou chega com a mesa cheia ou com a partida em andamento, fica como espectador: vê o tabuleiro e o placar, mas não as mãos.
- Todos na mesa veem a lista de espectadores no botão 👁 do topo.
- Espectadores ficam **fora da videoconferência**: não veem nem ouvem os jogadores, e o servidor não repassa sinalização WebRTC para eles.
- Para entrar na conversa, o espectador toca em **✋ Pedir para entrar na conversa**. O anfitrião recebe um aviso, a lista de espectadores se abre, e ele escolhe **Permitir** ou **Recusar**. Depois de liberado, o espectador pode sair quando quiser, e o anfitrião pode tirá-lo da conversa.
- Fora de partida, o espectador pode tocar em **Sentar à mesa** se houver lugar.

## Estatísticas e ranking

Quando uma partida termina, o resultado vai para o D1: a tabela `matches` guarda a partida e `match_players` guarda o resultado de cada jogador (pontos, colocação, vitória, desistência). Só entram partidas com pelo menos um jogador com conta. Convidados e robôs ficam registrados só pelo nome, sem conta.

- `GET /api/me` traz o usuário e as estatísticas dele: partidas, vitórias, desistências, pontos somados, melhor placar, rodadas e a data do último jogo. A varanda mostra esses números.
- `GET /api/ranking` traz os 50 primeiros, ordenados por vitórias e, no empate, por pontos. A varanda mostra os 10 primeiros.

## Regras implementadas

- 56 peças: cada combinação de 0 a 5 aparece uma vez, em sentido horário.
- Cada jogador recebe 9 peças em partidas de 2 jogadores e 7 peças com 3 ou 4.
- **Sorteio antes da primeira rodada:** cada jogador escolhe uma pedra virada para baixo, e quem tirar a maior começa. A maior é a de maior soma; no empate, vale a peça de números mais altos. Nas rodadas seguintes, começa quem tem menos pontos (no empate, o primeiro deles na ordem da vez).
- A abertura pode ser feita com qualquer peça da mão.
- **Sem dicas:** o jogo mostra todos os espaços livres encostados no jogo, mas não indica quais peças encaixam. Se a peça não servir, o servidor recusa a jogada.
- A peça precisa encostar por uma aresta, e os cantos que ela divide com as vizinhas por aresta têm que bater. O canto que encosta numa peça só pela ponta (a ponte) vale com qualquer número, como jogamos em casa.
- Pontuação:
  - jogada comum: a soma dos pontos da pedra, menos 5 por pedra comprada naquela vez;
  - ponte: 40 + a soma da pedra (menos as compras da vez);
  - mandala (a peça fecha o "círculo" de seis peças em volta de um ponto): 50 + a soma da pedra (menos as compras da vez);
  - a abertura vale só a soma dos pontos da pedra, sem bônus (abrir com 0-0-0 vale 0).
- Penalidades:
  - dá para comprar até 3 pedras por vez; cada uma desconta 5, cobrados junto com a jogada (ou ao passar);
  - passar custa −10, e só é permitido depois de 3 compras ou com o monte vazio.
- Fim da rodada:
  - **batida:** quem coloca a última pedra da mão "bate" e ganha +25 na hora. Depois, cada adversário joga uma última vez, na ordem da vez. As pedras que sobram na mão de cada um descontam a soma delas dele e vão para quem bateu. No fim, a mesa mostra as mãos de todos e as contas, passo a passo;
  - se o jogo travar, quem tem menos pontos na mão ganha a diferença.
- A partida vai até 400 pontos.
- **Sair/desistir:** o botão **Sair** tira o jogador da partida. As peças dele voltam ao monte, a vez passa adiante e os outros continuam jogando. Se sobrar um só jogador, ele vence.

## Jogadores IA

Na tela de espera, o anfitrião (quem criou a sala) pode clicar em **+ Adicionar IA** para completar a mesa com robôs, até 4 lugares no total. Cada robô tem um ✕ para remover. Eles entram nesta ordem: **Ricardo (IA)**, **Ilana (IA)** e **Henrique (IA)**. Todo jogador IA tem "(IA)" no nome, e humanos não podem usar essa marca.

- Com robô na mesa, o botão **🪙 Tokens** no topo mostra quantos tokens cada jogada de IA gastou (entrada, saída e raciocínio), o tempo de cada chamada e os totais da partida. Jogadas em que o modelo não foi chamado (jogada única, sem chave ou com falha) aparecem com 0 tokens e o motivo.
- O servidor calcula as jogadas válidas do robô e a pontuação de cada uma. O modelo da DeepSeek escolhe entre elas, equilibrando pontos agora com livrar-se de peças pesadas. A regra "sem dicas" vale só para os humanos.
- Configuração: no dev, preencha `DEEPSEEK_API_KEY` no `server/.dev.vars` (veja `server/.dev.vars.example`); em produção, use `npx wrangler secret put DEEPSEEK_API_KEY`. O modelo padrão é o `deepseek-flash` (DeepSeek V4.1 Flash) e pode ser trocado com `DEEPSEEK_MODEL`. A chave fica só no servidor e nunca é enviada ao navegador.
- Sem chave, ou quando a API falha ou demora mais de 10 s, o robô joga a jogada de maior pontuação. A partida nunca trava esperando a IA.
- Os robôs só jogam enquanto houver algum humano conectado na sala.

## Áudio e vídeo

O áudio e o vídeo usam WebRTC em malha P2P: cada participante conecta direto nos outros, e o servidor só repassa a sinalização.
Quem entra na sala envia a oferta para quem já estava. Assim web e Android interoperam sem regras de "quem oferta" (glare).

O padrão é STUN do Google. Atrás de NAT restritivo (redes móveis, corporativas) é preciso um servidor TURN, por exemplo o coturn:

```bash
npx wrangler secret put TURN_URLS          # ex.: turn:turn.exemplo.com:3478
npx wrangler secret put TURN_USERNAME
npx wrangler secret put TURN_CREDENTIAL
```

Variáveis: `STUN_URLS`, `TURN_URLS`, `TURN_USERNAME` e `TURN_CREDENTIAL` (no dev, no `server/.dev.vars`). A Cloudflare também oferece um serviço de TURN (Cloudflare Realtime).

**HTTPS:** o navegador só libera câmera e microfone em `localhost` ou HTTPS. Publicado na Cloudflare, o site já sai com HTTPS; no app, use `wss://`.

## Protocolo

Mensagens JSON via WebSocket. Os tipos estão definidos em `shared/src/protocol.ts` e espelhados em `android/.../net/Protocol.kt`.
O servidor envia para cada jogador o estado completo, incluindo a lista de jogadas válidas com os números já posicionados. Por isso os clientes não precisam conhecer as regras.
