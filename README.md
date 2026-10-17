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
npm run smoke             # partida completa contra um servidor rodando
cd android && ./gradlew testDebugUnitTest
```

## Regras implementadas

- 56 peças: cada combinação de 0 a 5 aparece uma vez, em sentido horário.
- Cada jogador recebe 9 peças em partidas de 2 jogadores e 7 peças com 3 ou 4.
- Começa quem tem o triplo mais alto. Se ninguém tiver triplo, começa quem tem a peça de maior soma.
- A peça precisa encostar por uma aresta, e todos os cantos que tocam outras peças têm que bater.
- Pontuação:
  - cada peça vale a soma dos números;
  - ponte: +40;
  - hexágono: +50;
  - abrir com triplo: +10 (abrir com 0-0-0: +40).
- Penalidades:
  - cada compra custa −5, até 3 por vez;
  - passar custa −10, e só é permitido depois de 3 compras ou com o monte vazio.
- Fim da rodada:
  - quem esvazia a mão ganha +25 mais a soma das peças dos adversários;
  - se o jogo travar, quem tem menos pontos na mão ganha a diferença.
- A partida vai até 400 pontos.

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
