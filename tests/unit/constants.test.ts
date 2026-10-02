import { META_KEY, SETTINGS_KEY, indexKey, threadKey } from '@shared/constants';

describe('storage keys (DATA_MODEL.md §1)', () => {
  test('follow the pp:v1 key patterns', () => {
    expect(SETTINGS_KEY).toBe('pp:v1:settings');
    expect(META_KEY).toBe('pp:v1:meta');
    expect(threadKey('claude', 'claude:abc')).toBe('pp:v1:thread:claude:claude:abc');
    expect(indexKey('gemini')).toBe('pp:v1:index:gemini');
  });

  test('thread keys share a prefix with their host so prefix scans work', () => {
    expect(threadKey('chatgpt', 'chatgpt:1').startsWith('pp:v1:thread:chatgpt:')).toBe(true);
  });
});
