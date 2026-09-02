import { isResolutionFinishedGenuinelyComplete } from './media-asset.service';
import type { ProviderVideoMetadata } from '../video/video.provider';

// The strict, real-provider-informed readiness predicate for a Bunny webhook status-4 ("a
// resolution finished") event — see the function's own doc comment and docs/MEDIA.md for the full
// real-provider evidence (a genuinely, fully-encoded video in a real Bunny library can permanently
// remain at status 4 and never reach status 3). Pure and DB/network-free, so tested directly here;
// the end-to-end webhook flow (eligibility gating, DB transitions, idempotency) is covered
// separately in media-http.postgres-test.ts.
describe('isResolutionFinishedGenuinelyComplete', () => {
  const complete: ProviderVideoMetadata = {
    durationSeconds: 16,
    status: 4,
    encodeProgress: 100,
    availableResolutions: ['360p', '480p', '720p', '1080p'],
    hasFailureIndication: false,
  };

  it('B: promotes when status 4, encodeProgress 100, a valid duration, and non-empty resolutions all hold', () => {
    expect(isResolutionFinishedGenuinelyComplete(complete)).toBe(true);
  });

  it('B: does not require a specific hardcoded set/count of resolutions — a single resolution is enough once other conditions hold', () => {
    expect(isResolutionFinishedGenuinelyComplete({ ...complete, availableResolutions: ['1080p'] })).toBe(true);
  });

  it('C: does not promote when encodeProgress is below 100 (still processing, even at status 4)', () => {
    expect(isResolutionFinishedGenuinelyComplete({ ...complete, encodeProgress: 60 })).toBe(false);
    expect(isResolutionFinishedGenuinelyComplete({ ...complete, encodeProgress: 99 })).toBe(false);
    expect(isResolutionFinishedGenuinelyComplete({ ...complete, encodeProgress: null })).toBe(false);
  });

  it('D: does not promote when duration is 0, negative, or null/unknown', () => {
    expect(isResolutionFinishedGenuinelyComplete({ ...complete, durationSeconds: 0 })).toBe(false);
    expect(isResolutionFinishedGenuinelyComplete({ ...complete, durationSeconds: -1 })).toBe(false);
    expect(isResolutionFinishedGenuinelyComplete({ ...complete, durationSeconds: null })).toBe(false);
  });

  it('E: does not promote when availableResolutions is null or empty', () => {
    expect(isResolutionFinishedGenuinelyComplete({ ...complete, availableResolutions: null })).toBe(false);
    expect(isResolutionFinishedGenuinelyComplete({ ...complete, availableResolutions: [] })).toBe(false);
  });

  it('does not promote when the freshly-fetched status is not exactly 4 (e.g. reverted/failed/unknown), even if every other field looks complete', () => {
    expect(isResolutionFinishedGenuinelyComplete({ ...complete, status: 5 })).toBe(false);
    expect(isResolutionFinishedGenuinelyComplete({ ...complete, status: null })).toBe(false);
    // A fresh status of 3 ("Finished") does not promote via this predicate either — that case is
    // handled by the pre-existing, unmodified status-3 webhook path, not this one.
    expect(isResolutionFinishedGenuinelyComplete({ ...complete, status: 3 })).toBe(false);
  });

  it('does not promote when the provider metadata carries an explicit failure indication', () => {
    expect(isResolutionFinishedGenuinelyComplete({ ...complete, hasFailureIndication: true })).toBe(false);
  });

  it('promotes when hasFailureIndication is null (provider does not expose the field) — null is "no signal seen", not a block', () => {
    expect(isResolutionFinishedGenuinelyComplete({ ...complete, hasFailureIndication: null })).toBe(true);
  });
});
