import { resolveRequestId } from '../../../../src/modules/express';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it.each(['abc-123', 'trace.id_01', 'A'.repeat(64)])('accepts a safe caller id: %s', (id) => {
    expect(resolveRequestId(id)).toBe(id);
  });

  it('uses the first value when the header is repeated', () => {
    expect(resolveRequestId(['first-id', 'second-id'])).toBe('first-id');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['too long', 'A'.repeat(65)],
    ['log injection (newline)', 'abc\n{"level":"fatal"}'],
    ['spaces', 'abc def'],
    ['quotes', `abc"'`],
  ])('generates a fresh UUID when the caller id is %s', (_case, id) => {
    expect(resolveRequestId(id)).toMatch(UUID);
  });
});
