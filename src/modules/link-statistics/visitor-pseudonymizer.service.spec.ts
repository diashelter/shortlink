import { createHmac } from 'crypto';
import { VisitorPseudonymizer } from './visitor-pseudonymizer.service';

describe('VisitorPseudonymizer', () => {
  const secret = 'unit-test-link-stats-pseudonym-secret';
  const pseudonymizer = new VisitorPseudonymizer(secret);

  const linkId = '11111111-1111-4111-8111-111111111111';
  const otherLinkId = '22222222-2222-4222-8222-222222222222';
  const occurredOn = '2026-07-14';
  const otherDay = '2026-07-15';
  const sampleIp = '203.0.113.10';
  const otherIp = '203.0.113.11';
  const sampleUserAgent = 'Mozilla/5.0 UnitTestBrowser/1.0';

  it('returns a stable hex digest for the same inputs', () => {
    const first = pseudonymizer.create(
      linkId,
      occurredOn,
      sampleIp,
      sampleUserAgent,
    );
    const second = pseudonymizer.create(
      linkId,
      occurredOn,
      sampleIp,
      sampleUserAgent,
    );

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(second);
  });

  it('changes the pseudonym across Links', () => {
    const forLink = pseudonymizer.create(
      linkId,
      occurredOn,
      sampleIp,
      sampleUserAgent,
    );
    const forOtherLink = pseudonymizer.create(
      otherLinkId,
      occurredOn,
      sampleIp,
      sampleUserAgent,
    );

    expect(forLink === forOtherLink).toBe(false);
  });

  it('changes the pseudonym across UTC days', () => {
    const forDay = pseudonymizer.create(
      linkId,
      occurredOn,
      sampleIp,
      sampleUserAgent,
    );
    const forOtherDay = pseudonymizer.create(
      linkId,
      otherDay,
      sampleIp,
      sampleUserAgent,
    );

    expect(forDay === forOtherDay).toBe(false);
  });

  it('changes the pseudonym when IP or user-agent differs', () => {
    const baseline = pseudonymizer.create(
      linkId,
      occurredOn,
      sampleIp,
      sampleUserAgent,
    );
    const differentIp = pseudonymizer.create(
      linkId,
      occurredOn,
      otherIp,
      sampleUserAgent,
    );
    const differentUa = pseudonymizer.create(
      linkId,
      occurredOn,
      sampleIp,
      'Mozilla/5.0 OtherBrowser/2.0',
    );

    expect(baseline === differentIp).toBe(false);
    expect(baseline === differentUa).toBe(false);
  });

  it('does not expose raw inputs in the digest', () => {
    const digest = pseudonymizer.create(
      linkId,
      occurredOn,
      sampleIp,
      sampleUserAgent,
    );

    const leaked =
      digest.includes(sampleIp) ||
      digest.includes(sampleUserAgent) ||
      digest.includes(linkId) ||
      digest.includes(occurredOn);

    expect(leaked).toBe(false);
  });

  it('HMACs linkId, UTC date, IP and user-agent with the dedicated secret', () => {
    const digest = pseudonymizer.create(
      linkId,
      occurredOn,
      sampleIp,
      sampleUserAgent,
    );
    const expected = createHmac('sha256', secret)
      .update(`${linkId}|${occurredOn}|${sampleIp}|${sampleUserAgent}`)
      .digest('hex');

    expect(digest).toBe(expected);
  });
});
