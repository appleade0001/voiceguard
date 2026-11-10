/* 보이스가드 - 키워드 탐지 로직 (브라우저와 Node 양쪽에서 사용 가능) */
(function (root) {
  'use strict';

  // 기본 예시 키워드 (실제 데이터로 교체하세요) — 키워드,가중치
  const SAMPLE_CSV = [
    '키워드,가중치',
    '검찰,2', '검찰청,2', '수사관,2', '검사,1', '금융감독원,2', '금감원,2', '경찰청,1',
    '사이버수사대,2', '구속영장,3', '출석요구,2', '범죄연루,3', '연루,2', '명의도용,3',
    '대포통장,3', '안전계좌,3', '자산보호,2', '피해자,1', '공범,2', '약식조사,2',
    '계좌이체,2', '이체,1', '송금,1', '현금인출,2', '현금,1', '계좌번호,2',
    '보안카드,3', '오티피,3', 'OTP,3', '인증번호,2', '비밀번호,2', '앱설치,3', '원격,2',
    '저금리,2', '대환대출,2', '대출,1', '기존대출,2', '수수료,1',
    '녹취,1', '비밀유지,3', '아무에게도,2', '가족에게,1',
  ].join('\n');

  // 소문자 + 공백 제거 (STT 띄어쓰기 흔들림 대응)
  const norm = (s) => String(s).toLowerCase().replace(/\s+/g, '');
  const escRe = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // CSV 파싱: "키워드,가중치" 또는 한 줄에 키워드 하나. 첫 줄 머리글은 자동으로 건너뜀
  function parseCsv(text) {
    const seen = new Map();
    String(text).replace(/^﻿/, '').split(/\r?\n/).forEach((line, i) => {
      const cells = line.split(',').map((c) => c.trim().replace(/^"|"$/g, '').trim());
      const word = cells[0];
      if (!word) return;
      const w = parseFloat(cells[1]);
      if (i === 0 && /키워드|keyword|단어|word/i.test(word) && (cells.length < 2 || isNaN(w))) return; // 머리글
      const key = norm(word);
      if (!key) return;
      seen.set(key, { word, weight: isNaN(w) || w <= 0 ? 1 : w });
    });
    return [...seen.values()];
  }

  // 파일 인코딩 자동 판별: UTF-8 우선, 실패하면 엑셀 기본 CSV 인코딩(CP949/EUC-KR)
  function decodeText(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { return new TextDecoder('euc-kr').decode(buf); }
  }

  class Detector {
    constructor(list, opts) {
      this.opts = Object.assign({ suspect: 3, danger: 6, windowSec: 120 }, opts || {});
      this.map = new Map(list.map((k) => [norm(k.word), k]));
      // 긴 키워드 우선 매칭 → "안전계좌"가 "계좌"로 중복 계산되지 않음. 글자 사이 공백 허용
      const alts = [...this.map.keys()].sort((a, b) => b.length - a.length)
        .map((k) => [...k].map(escRe).join('\\s*'));
      this.re = alts.length ? new RegExp(alts.join('|'), 'gi') : null;
      this.events = [];
    }
    reset() { this.events = []; }
    find(text) {
      const out = [];
      if (!this.re) return out;
      this.re.lastIndex = 0;
      for (const m of String(text).matchAll(this.re)) {
        const k = this.map.get(norm(m[0]));
        if (k) out.push({ start: m.index, end: m.index + m[0].length, word: k.word, weight: k.weight });
      }
      return out;
    }
    feed(text, now) {
      now = now == null ? Date.now() : now;
      const matches = this.find(text);
      matches.forEach((m) => this.events.push({ t: now, word: m.word, weight: m.weight }));
      return Object.assign({ matches }, this.state(now));
    }
    state(now) {
      now = now == null ? Date.now() : now;
      const from = now - this.opts.windowSec * 1000;
      this.events = this.events.filter((e) => e.t >= from);
      let score = 0;
      const counts = new Map();
      for (const e of this.events) {
        score += e.weight;
        counts.set(e.word, (counts.get(e.word) || 0) + 1);
      }
      const level = score >= this.opts.danger ? 2 : score >= this.opts.suspect ? 1 : 0;
      return {
        score, level,
        counts: [...counts].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count),
      };
    }
  }

  // 자막에서 탐지된 부분을 <mark>로 강조
  function highlight(text, matches, esc) {
    let html = '', pos = 0;
    for (const m of matches) {
      html += esc(text.slice(pos, m.start)) + '<mark>' + esc(text.slice(m.start, m.end)) + '</mark>';
      pos = m.end;
    }
    return html + esc(text.slice(pos));
  }

  const VG = { SAMPLE_CSV, parseCsv, decodeText, Detector, highlight, norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = VG;
  else root.VG = VG;
})(typeof window !== 'undefined' ? window : globalThis);
