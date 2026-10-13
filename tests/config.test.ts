import { describe, it, expect } from 'vitest';
import { loadBaseSettings, loadSettings, withCredential } from '../src/config.js';

describe('configuration — the gateway is the only upstream', () => {
  it('defaults the gateway to the production gateway host', () => {
    const settings = loadBaseSettings({});

    expect(settings.gatewayUrl).toBe('https://visibilio-api-gateway-prod.vercel.app');
    expect(settings.timeoutMs).toBe(30_000);
  });

  it('reads VISIBILIO_GATEWAY_URL, VISIBILIO_FRONTEND_URL and VISIBILIO_TIMEOUT_MS', () => {
    const settings = loadBaseSettings({
      VISIBILIO_GATEWAY_URL: 'https://gw.example.test',
      VISIBILIO_FRONTEND_URL: 'https://app.example.test',
      VISIBILIO_TIMEOUT_MS: '5000',
    });

    expect(settings).toMatchObject({
      gatewayUrl: 'https://gw.example.test',
      frontendUrl: 'https://app.example.test',
      timeoutMs: 5000,
    });
  });

  it('has no backend URL or internal API key setting any more', () => {
    const settings = loadBaseSettings({
      VISIBILIO_BACKEND_URL: 'https://backend.example.test',
      VISIBILIO_INTERNAL_API_KEY: 'internal',
    });

    expect(settings).not.toHaveProperty('backendUrl');
    expect(settings).not.toHaveProperty('internalApiKey');
  });

  it('stdio mode requires VISIBILIO_API_KEY and accepts vsk_ and vat_ credentials', () => {
    expect(loadSettings({ VISIBILIO_API_KEY: 'vsk_abc' }).credential).toBe('vsk_abc');
    expect(loadSettings({ VISIBILIO_API_KEY: 'vat_abc' }).credential).toBe('vat_abc');
    expect(() => loadSettings({})).toThrow(/VISIBILIO_API_KEY/);
    expect(() => loadSettings({ VISIBILIO_API_KEY: 'sk-other' })).toThrow(/vsk_ or vat_/);
  });

  it('withCredential builds per-request settings for the HTTP server', () => {
    const base = loadBaseSettings({ VISIBILIO_GATEWAY_URL: 'https://gw.example.test' });

    expect(withCredential(base, 'vat_token')).toMatchObject({
      gatewayUrl: 'https://gw.example.test',
      credential: 'vat_token',
    });
    expect(() => withCredential(base, 'nope')).toThrow(/vsk_ or vat_/);
  });
});
