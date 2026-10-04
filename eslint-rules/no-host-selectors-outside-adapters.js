/**
 * CLAUDE.md R2 / ARCHITECTURE.md §3: host names, host origins, and host DOM selectors may only
 * appear inside src/content/adapters/**. Scope is set in eslint.config.js.
 */
const HOST_NAME = /gemini|chatgpt|openai|claude\.ai/i;
const HOST_SELECTOR = /\[(data-message-id|data-testid)/;

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow host-specific strings and selectors outside adapters' },
    schema: [],
    messages: {
      hostString:
        'Host-specific string "{{ text }}" outside src/content/adapters/** (CLAUDE.md R2). Move it into an adapter.',
    },
  },
  create(context) {
    /** @param {import('estree').Node} node @param {string} value */
    const check = (node, value) => {
      if (HOST_NAME.test(value) || HOST_SELECTOR.test(value)) {
        context.report({ node, messageId: 'hostString', data: { text: value.slice(0, 60) } });
      }
    };
    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};
