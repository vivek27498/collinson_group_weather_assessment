import { withPoolSize } from '../../../../src/modules/database';

describe('withPoolSize', () => {
  const base = 'mysql://app:secret@db:3306/weather?allowPublicKeyRetrieval=true';

  it('adds connectionLimit to the URL, keeping existing options', () => {
    const url = new URL(withPoolSize(base, 20));

    expect(url.searchParams.get('connectionLimit')).toBe('20');
    expect(url.searchParams.get('allowPublicKeyRetrieval')).toBe('true');
  });

  it('leaves an explicit connectionLimit in the URL alone', () => {
    const explicit = `${base}&connectionLimit=5`;

    expect(new URL(withPoolSize(explicit, 20)).searchParams.get('connectionLimit')).toBe('5');
  });

  it('returns the URL unchanged when no pool size is given', () => {
    expect(withPoolSize(base, undefined)).toBe(base);
  });
});
