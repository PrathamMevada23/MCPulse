import { describe, expect, it } from 'vitest';
import { validateSafeRemoteUrl } from '../src/monitoring/ssrf.js';

describe('SSRF guard', () => {
  it('blocks loopback destinations', () => {
    expect(validateSafeRemoteUrl('http://127.0.0.1:8080/mcp').safe).toBe(false);
    expect(validateSafeRemoteUrl('http://localhost:3001/mcp').safe).toBe(false);
    expect(validateSafeRemoteUrl('http://[::1]:3001/mcp').safe).toBe(false);
  });

  it('blocks private network destinations', () => {
    expect(validateSafeRemoteUrl('http://10.0.0.5/mcp').safe).toBe(false);
    expect(validateSafeRemoteUrl('http://172.16.4.5/mcp').safe).toBe(false);
    expect(validateSafeRemoteUrl('http://192.168.1.10/mcp').safe).toBe(false);
  });

  it('blocks the cloud metadata endpoint', () => {
    expect(
      validateSafeRemoteUrl('http://169.254.169.254/latest/meta-data/').safe,
    ).toBe(false);
    expect(
      validateSafeRemoteUrl('http://metadata.google.internal/computeMetadata/v1/')
        .safe,
    ).toBe(false);
  });

  it('blocks internal hostnames', () => {
    expect(validateSafeRemoteUrl('https://db.internal/mcp').safe).toBe(false);
    expect(validateSafeRemoteUrl('https://service.local/mcp').safe).toBe(false);
  });

  it('rejects unsupported protocols and malformed URLs', () => {
    expect(validateSafeRemoteUrl('file:///etc/passwd').safe).toBe(false);
    expect(validateSafeRemoteUrl('not-a-url').safe).toBe(false);
  });

  it('allows public HTTPS endpoints', () => {
    expect(validateSafeRemoteUrl('https://huggingface.co/mcp').safe).toBe(true);
    expect(
      validateSafeRemoteUrl('https://drivemcp.googleapis.com/mcp/v1').safe,
    ).toBe(true);
  });
});
