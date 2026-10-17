# Triminó

Dominó triangular multijogador (2 a 4 pessoas) com áudio e vídeo entre os participantes.
Há um servidor Node.js, um cliente web e um app Android nativo, e os três falam o mesmo protocolo.

```
shared/   regras do jogo, geometria da grade triangular e tipos do protocolo (TypeScript)
server/   Node + WebSocket: salas, partida (autoritativa) e sinalização WebRTC
web/      cliente web (Vite + TypeScript, tabuleiro em SVG)
android/  app Android (Kotlin + Jetpack Compose + WebRTC nativo)
scripts/  smoke test do protocolo
```

## Como rodar

```bash
npm install
npm run dev:server        # servidor em http://localhost:8080 (WebSocket em /ws)
npm run dev:web           # cliente em http://localhost:5173 (proxy de /ws para o servidor)
```

Abra duas abas em `http://localhost:5173/?sala=TESTE` para jogar contra si mesmo.

Se a porta 8080 estiver ocupada (por exemplo, pelo Docker), use outra nos dois comandos: `PORT=8787 npm run dev:server` e `PORT=8787 npm run dev:web`.

Em produção, rode `npm run build`. Depois, `npm start` sobe o servidor, que também entrega o cliente compilado em `web/dist`.

**Android:** abra a pasta `android/` no Android Studio ou rode `./gradlew assembleDebug`.
No lobby do app, informe o endereço do servidor:
- `ws://10.0.2.2:8080/ws` no emulador;
- `ws://<IP-da-máquina>:8080/ws` num aparelho na mesma rede.

### Testes

```bash
npm test                  # regras do jogo (vitest)
npm run typecheck
npm run smoke             # partida completa contra um servidor rodando (TRIMINO_WS=ws://localhost:8787/ws para outra porta)
npm run fixtures          # regenera os exemplos de estado usados no teste de protocolo do Android
cd android && ./gradlew testDebugUnitTest
```

## Regras implementadas

- 56 peças: cada combinação de 0 a 5 aparece uma vez, em sentido horário.
- Cada jogador recebe 9 peças em partidas de 2 jogadores e 7 peças com 3 ou 4.
- **Sorteio antes da primeira rodada:** cada jogador escolhe uma pedra virada para baixo, e quem tirar a maior começa. A maior é a de maior soma; no empate, vale a peça de números mais altos. Nas rodadas seguintes, quem começa passa para o próximo jogador.
- A abertura pode ser feita com qualquer peça da mão.
- **Sem dicas:** o jogo mostra todos os espaços livres encostados no jogo, mas não indica quais peças encaixam. Se a peça não servir, o servidor recusa a jogada.
- A peça precisa encostar por uma aresta, e todos os cantos que tocam outras peças têm que bater.
- Pontuação:
  - jogada comum: a soma dos pontos da pedra, menos 5 por pedra comprada naquela vez;
  - ponte: 40 + a soma da pedra (menos as compras da vez);
  - mandala (a peça fecha o "círculo" de seis peças em volta de um ponto): 50 + a soma da pedra (menos as compras da vez);
  - a abertura vale só a soma dos pontos da pedra, sem bônus (abrir com 0-0-0 vale 0).
- Penalidades:
  - dá para comprar até 3 pedras por vez; cada uma desconta 5, cobrados junto com a jogada (ou ao passar);
  - passar custa −10, e só é permitido depois de 3 compras ou com o monte vazio.
- Fim da rodada:
  - quem esvazia a mão ganha +25 mais a soma das peças dos adversários;
  - se o jogo travar, quem tem menos pontos na mão ganha a diferença.
- A partida vai até 400 pontos.
- **Sair/desistir:** o botão **Sair** tira o jogador da partida. As peças dele voltam ao monte, a vez passa adiante e os outros continuam jogando. Se sobrar um só jogador, ele vence.

## Jogadores IA

Na tela de espera, o anfitrião (quem criou a sala) pode clicar em **+ Adicionar IA** para completar a mesa com robôs, até 4 lugares no total. Cada robô tem um ✕ para remover. Eles entram nesta ordem: **Ricardo (IA)**, **Ilana (IA)** e **Henrique (IA)**. Todo jogador IA tem "(IA)" no nome, e humanos não podem usar essa marca.

- O servidor calcula as jogadas válidas do robô e a pontuação de cada uma. O modelo da DeepSeek escolhe entre elas, equilibrando pontos agora com livrar-se de peças pesadas. A regra "sem dicas" vale só para os humanos.
- Configuração: copie `server/.env.example` para `server/.env` e preencha `DEEPSEEK_API_KEY`. O modelo padrão é o `deepseek-flash` (DeepSeek V4.1 Flash) e pode ser trocado com `DEEPSEEK_MODEL`. A chave fica só no servidor e nunca é enviada ao navegador.
- Sem chave, ou quando a API falha ou demora mais de 10 s, o robô joga a jogada de maior pontuação. A partida nunca trava esperando a IA.
- Os robôs só jogam enquanto houver algum humano conectado na sala.

## Áudio e vídeo

O áudio e o vídeo usam WebRTC em malha P2P: cada participante conecta direto nos outros, e o servidor só repassa a sinalização.
Quem entra na sala envia a oferta para quem já estava. Assim web e Android interoperam sem regras de "quem oferta" (glare).

O padrão é STUN do Google. Atrás de NAT restritivo (redes móveis, corporativas) é preciso um servidor TURN, por exemplo o coturn:

```bash
TURN_URLS=turn:turn.exemplo.com:3478 TURN_USERNAME=user TURN_CREDENTIAL=senha npm start
```

Variáveis de ambiente: `PORT` (padrão 8080), `STUN_URLS`, `TURN_URLS`, `TURN_USERNAME` e `TURN_CREDENTIAL`.

**HTTPS:** o navegador só libera câmera e microfone em `localhost` ou HTTPS. Para jogar pela rede, publique atrás de um proxy com TLS (Caddy, nginx, Cloudflare Tunnel) e use `wss://` no app.

## Protocolo

Mensagens JSON via WebSocket. Os tipos estão definidos em `shared/src/protocol.ts` e espelhados em `android/.../net/Protocol.kt`.
O servidor envia para cada jogador o estado completo, incluindo a lista de jogadas válidas com os números já posicionados. Por isso os clientes não precisam conhecer as regras.
