/**
 * 보이스가드 고정확도 인식 서버 (Cloudflare Worker)
 *
 * 브라우저 ↔ 이 Worker ↔ Gemini 실시간 전사(Live API) 를 WebSocket으로 이어 줍니다.
 * Gemini API 키는 Worker 안에만 있고 브라우저에는 절대 노출되지 않습니다.
 *
 * 설정할 환경 변수 (Worker → Settings → Variables and Secrets)
 *   GEMINI_API_KEY   (Secret)  : Google AI Studio에서 발급한 API 키
 *   ALLOWED_ORIGINS  (Text, 선택): 접속을 허용할 사이트 주소, 쉼표로 구분
 *                               예) https://아이디.github.io,http://localhost:8080
 *                               비워 두면 어느 사이트에서나 접속 가능(남이 키를 쓸 수 있으니 비추천)
 */
const UPSTREAM = 'https://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const MODEL = 'models/gemini-3.5-transcribe-live';   // 이 모델만 쓰도록 고정 (키 악용 방지)
// UPSTREAM_URL 환경 변수는 테스트용 (보통은 설정하지 않음)
const MAX_SESSION_MS = 15 * 60 * 1000;               // 연결 하나당 최대 15분

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
    const originOk = !allowed.length || allowed.includes(origin);

    if (request.headers.get('Upgrade') !== 'websocket') {
      // 주소창에서 직접 열면 동작 여부만 알려 줌
      const key = env.GEMINI_API_KEY ? 'API 키 설정됨' : 'API 키 없음 (GEMINI_API_KEY를 설정하세요)';
      return new Response(`voiceguard stt proxy: ok\n${key}\n허용 주소: ${allowed.length ? allowed.join(', ') : '전체 허용'}`, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
    if (!originOk) return new Response('origin not allowed: ' + origin, { status: 403 });
    if (!env.GEMINI_API_KEY) return new Response('GEMINI_API_KEY is not set', { status: 500 });

    // Gemini 쪽 WebSocket 열기
    const up = await fetch((env.UPSTREAM_URL || UPSTREAM) + '?key=' + encodeURIComponent(env.GEMINI_API_KEY), { headers: { Upgrade: 'websocket' } });
    const upstream = up.webSocket;
    if (!upstream) return new Response('upstream refused: ' + up.status, { status: 502 });
    upstream.accept();

    // 브라우저 쪽 WebSocket
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();

    let first = true;
    const closeBoth = (code, reason) => {
      const c = code && code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000;
      try { server.close(c, (reason || '').slice(0, 120)); } catch (e) {}
      try { upstream.close(c, (reason || '').slice(0, 120)); } catch (e) {}
    };
    const timer = setTimeout(() => closeBoth(1000, 'session time limit'), MAX_SESSION_MS);

    server.addEventListener('message', (ev) => {
      let data = ev.data;
      if (first) {
        first = false;
        // 첫 메시지(setup)의 모델과 출력 형식을 강제로 고정
        try {
          const msg = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
          if (!msg.setup) { closeBoth(1008, 'first message must be setup'); return; }
          msg.setup.model = MODEL;
          msg.setup.generationConfig = { responseModalities: ['TEXT'] };
          delete msg.setup.tools; delete msg.setup.systemInstruction;
          data = JSON.stringify(msg);
        } catch (e) { closeBoth(1007, 'invalid setup'); return; }
      }
      try { upstream.send(data); } catch (e) { closeBoth(1011, 'upstream send failed'); }
    });
    upstream.addEventListener('message', (ev) => { try { server.send(ev.data); } catch (e) {} });
    server.addEventListener('close', (ev) => { clearTimeout(timer); closeBoth(ev.code, ev.reason); });
    upstream.addEventListener('close', (ev) => { clearTimeout(timer); closeBoth(ev.code, ev.reason); });
    server.addEventListener('error', () => closeBoth(1011, 'client error'));
    upstream.addEventListener('error', () => closeBoth(1011, 'upstream error'));

    return new Response(null, { status: 101, webSocket: client });
  },
};
