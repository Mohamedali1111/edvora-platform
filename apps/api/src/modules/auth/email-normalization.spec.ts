import { normalizeEmailForLookup } from './email-normalization';

describe('normalizeEmailForLookup', () => {
  it('trims surrounding whitespace and lowercases for lookup without provider-specific rules', () => {
    expect(normalizeEmailForLookup('  Student.Name+Course@Example.COM  ')).toBe(
      'student.name+course@example.com',
    );
  });
});
