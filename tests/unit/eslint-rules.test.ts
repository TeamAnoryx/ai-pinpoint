import { RuleTester } from 'eslint';
import noHostSelectors from '../../eslint-rules/no-host-selectors-outside-adapters.js';
import noMagicTimeouts from '../../eslint-rules/no-magic-timeouts.js';

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });

// RuleTester registers its own describe/it blocks, so run() is called at module level.
tester.run('no-host-selectors-outside-adapters', noHostSelectors, {
  valid: ["const sel = '.message';", "const key = 'pp:v1:settings';", 'const t = `thread:${id}`;'],
  invalid: [
    { code: "const h = 'gemini.google.com';", errors: [{ messageId: 'hostString' }] },
    { code: "const h = 'https://chatgpt.com/c/';", errors: [{ messageId: 'hostString' }] },
    { code: "const h = 'chat.openai.com';", errors: [{ messageId: 'hostString' }] },
    { code: "const h = 'claude.ai';", errors: [{ messageId: 'hostString' }] },
    { code: "q('[data-message-id]');", errors: [{ messageId: 'hostString' }] },
    { code: 'q(\'[data-testid="turn"]\');', errors: [{ messageId: 'hostString' }] },
    { code: 'const u = `https://claude.ai/${p}`;', errors: [{ messageId: 'hostString' }] },
  ],
});

tester.run('no-magic-timeouts', noMagicTimeouts, {
  valid: [
    'setTimeout(fn, MUTATION_DEBOUNCE_MS);',
    'setTimeout(fn, 0);',
    'setTimeout(fn, 99);',
    'setTimeout(fn);',
    'other(fn, 5000);',
  ],
  invalid: [
    { code: 'setTimeout(fn, 100);', errors: [{ messageId: 'magicTimeout' }] },
    { code: 'setInterval(fn, 250);', errors: [{ messageId: 'magicTimeout' }] },
    { code: 'window.setTimeout(fn, 8000);', errors: [{ messageId: 'magicTimeout' }] },
    { code: 'globalThis.setInterval(fn, 1500);', errors: [{ messageId: 'magicTimeout' }] },
  ],
});
