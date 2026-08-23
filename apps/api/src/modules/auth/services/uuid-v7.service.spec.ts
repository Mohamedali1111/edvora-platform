import { UuidV7Service } from './uuid-v7.service';

describe('UuidV7Service', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('generates RFC 9562 UUIDv7-shaped identifiers', () => {
    const id = new UuidV7Service().create();

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('stores the Unix timestamp milliseconds in the first 48 bits', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_777_777_777_777);

    const id = new UuidV7Service().create();
    const encodedTimestamp = id.replaceAll('-', '').slice(0, 12);

    expect(Number.parseInt(encodedTimestamp, 16)).toBe(1_777_777_777_777);
  });
});
