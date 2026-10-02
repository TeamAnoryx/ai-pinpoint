/**
 * CLAUDE.md R8: timer delays of 100 ms or more must be named constants from
 * src/shared/constants.ts, never inline numeric literals.
 */
const TIMERS = new Set(['setTimeout', 'setInterval']);
const MIN_FLAGGED_MS = 100;

/** @param {import('estree').Node} callee */
function timerName(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
    return callee.property.name;
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow numeric timer delays >= 100 outside constants.ts' },
    schema: [],
    messages: {
      magicTimeout:
        '{{ timer }} delay {{ value }} is a magic number (CLAUDE.md R8). Add a constant to src/shared/constants.ts.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const timer = timerName(node.callee);
        if (!timer || !TIMERS.has(timer)) return;
        const delay = node.arguments[1];
        if (
          delay?.type === 'Literal' &&
          typeof delay.value === 'number' &&
          delay.value >= MIN_FLAGGED_MS
        ) {
          context.report({
            node: delay,
            messageId: 'magicTimeout',
            data: { timer, value: String(delay.value) },
          });
        }
      },
    };
  },
};
