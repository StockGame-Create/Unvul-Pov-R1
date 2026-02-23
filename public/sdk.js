/**
 * unvul-pov SDK v0.1.0
 * https://unvul-pov.dev/sdk.js
 *
 * Usage:
 * <script src="https://unvul-pov.dev/sdk.js" api-key="upov_xxx"></script>
 * <img src="unvul://f/암호화데이터" />
 */

(async function () {
  'use strict';

  // ─── Config ─────────────────────────────────────────────
  const SCHEME = 'unvul://f/';
  const SALT = 'unvul-pov-salt';

  const scriptTag = document.currentScript;
  const apiKey = scriptTag?.getAttribute('api-key');

  if (!apiKey) {
    console.error('[unvul-pov] api-key 속성이 없습니다.');
    return;
  }

  if (!apiKey.startsWith('upov_')) {
    console.error('[unvul-pov] 유효하지 않은 API Key 형식입니다.');
    return;
  }

  console.log('[unvul-pov] SDK 초기화됨');

  // ─── Crypto ─────────────────────────────────────────────
  async function deriveKey(secret) {
    const enc = new TextEncoder();
    const km = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'PBKDF2' }, false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode(SALT), iterations: 10000, hash: 'SHA-256' },
      km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
    );
  }

  async function decrypt(b64, secret) {
    const key = await deriveKey(secret);
    const bin = Uint8Array.from(
      atob(b64.replace(/-/g, '+').replace(/_/g, '/')),
      c => c.charCodeAt(0)
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bin.slice(0, 12) },
      key,
      bin.slice(12)
    );
    return JSON.parse(new TextDecoder().decode(decrypted));
  }

  // ─── Key 캐시 (페이지당 한 번만 파생) ──────────────────
  let _cachedKey = null;
  async function getCachedKey() {
    if (!_cachedKey) _cachedKey = await deriveKey(apiKey);
    return _cachedKey;
  }

  // ─── 단일 URL 복호화 ─────────────────────────────────
  async function resolveUrl(unvulUrl) {
    if (!unvulUrl.startsWith(SCHEME)) return null;
    const encoded = unvulUrl.slice(SCHEME.length);
    try {
      const meta = await decrypt(encoded, apiKey);
      // meta.url = 실제 Drive/S3/Dropbox URL
      if (!meta.url) {
        console.warn('[unvul-pov] 메타데이터에 url 필드가 없습니다:', meta);
        return null;
      }
      return meta;
    } catch (e) {
      console.error('[unvul-pov] 복호화 실패 — API Key를 확인하세요', e);
      return null;
    }
  }

  // ─── 엘리먼트 교체 ──────────────────────────────────
  async function processElement(el) {
    const attr = el.tagName === 'VIDEO' || el.tagName === 'SOURCE' ? 'src' : 'src';
    const raw = el.getAttribute('src') || el.getAttribute('data-unvul');

    if (!raw || !raw.startsWith(SCHEME)) return;

    // 로딩 상태
    el.setAttribute('data-unvul-status', 'loading');

    const meta = await resolveUrl(raw);

    if (!meta) {
      el.setAttribute('data-unvul-status', 'error');
      el.setAttribute('data-unvul-error', 'decrypt-failed');
      return;
    }

    // 실제 URL로 교체
    el.setAttribute('src', meta.url);
    el.setAttribute('data-unvul-status', 'resolved');
    el.setAttribute('data-unvul-name', meta.name || '');
    el.setAttribute('data-unvul-type', meta.type || '');
    el.setAttribute('data-unvul-size', meta.size || '');
    el.removeAttribute('data-unvul');

    console.log(`[unvul-pov] ✓ ${meta.name} → ${meta.url}`);
  }

  // ─── 페이지 전체 스캔 ────────────────────────────────
  async function scanPage() {
    // img, video, source, a 태그에서 unvul:// 감지
    const selectors = [
      'img[src^="unvul://"]',
      'video[src^="unvul://"]',
      'source[src^="unvul://"]',
      'a[href^="unvul://"]',
      '[data-unvul]'
    ];

    const elements = document.querySelectorAll(selectors.join(','));

    if (elements.length === 0) {
      console.log('[unvul-pov] unvul:// 엘리먼트 없음');
      return;
    }

    console.log(`[unvul-pov] ${elements.length}개 엘리먼트 처리 중...`);

    await Promise.all(Array.from(elements).map(el => {
      if (el.tagName === 'A') {
        // <a> 태그는 href 처리
        return resolveUrl(el.getAttribute('href')).then(meta => {
          if (meta) {
            el.setAttribute('href', meta.url);
            el.setAttribute('data-unvul-status', 'resolved');
          }
        });
      }
      return processElement(el);
    }));

    console.log('[unvul-pov] ✓ 스캔 완료');
  }

  // ─── MutationObserver (동적 추가 엘리먼트 감지) ──────
  function observeDom() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;

          // 새로 추가된 노드 자체가 unvul인 경우
          const src = node.getAttribute?.('src') || node.getAttribute?.('href') || '';
          if (src.startsWith(SCHEME)) processElement(node);

          // 새로 추가된 노드의 자식 중 unvul인 경우
          const children = node.querySelectorAll?.([
            'img[src^="unvul://"]',
            'video[src^="unvul://"]',
            'source[src^="unvul://"]',
            'a[href^="unvul://"]',
            '[data-unvul]'
          ].join(','));
          if (children?.length) {
            children.forEach(el => processElement(el));
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    console.log('[unvul-pov] DOM 감시 시작');
  }

  // ─── 공개 API ────────────────────────────────────────
  window.unvul = {
    // 수동으로 URL 복호화
    resolve: async (unvulUrl) => {
      const meta = await resolveUrl(unvulUrl);
      return meta;
    },

    // 특정 엘리먼트 수동 처리
    process: async (el) => {
      await processElement(el);
    },

    // 페이지 전체 재스캔
    scan: scanPage,

    // URL 생성 헬퍼 (암호화)
    encode: async (meta) => {
      const enc = new TextEncoder();
      const key = await deriveKey(apiKey);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        enc.encode(JSON.stringify(meta))
      );
      const combined = new Uint8Array(12 + ct.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(ct), 12);
      return SCHEME + btoa(String.fromCharCode(...combined))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    },

    version: '0.1.0'
  };

  // ─── 초기화 ──────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      scanPage();
      observeDom();
    });
  } else {
    await scanPage();
    observeDom();
  }

})();
