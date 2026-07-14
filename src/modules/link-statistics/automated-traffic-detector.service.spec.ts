import { AutomatedTrafficDetector } from './automated-traffic-detector.service';

describe('AutomatedTrafficDetector', () => {
  const detector = new AutomatedTrafficDetector();

  it('treats missing user-agent as eligible (not automated)', () => {
    expect(detector.isAutomated('')).toBe(false);
  });

  it('treats whitespace-only user-agent as eligible', () => {
    expect(detector.isAutomated('   ')).toBe(false);
  });

  it('excludes Google crawler signatures', () => {
    expect(
      detector.isAutomated(
        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      ),
    ).toBe(true);
  });

  it('excludes Bing, Facebook, Twitter/X, Slack, Discord and LinkedIn signatures', () => {
    expect(detector.isAutomated('Mozilla/5.0 bingbot/2.0')).toBe(true);
    expect(detector.isAutomated('facebookexternalhit/1.1')).toBe(true);
    expect(detector.isAutomated('Twitterbot/1.0')).toBe(true);
    expect(detector.isAutomated('Slackbot-LinkExpanding 1.0')).toBe(true);
    expect(detector.isAutomated('Mozilla/5.0 (compatible; Discordbot/2.0)')).toBe(
      true,
    );
    expect(detector.isAutomated('LinkedInBot/1.0')).toBe(true);
  });

  it('excludes known uptime monitor signatures', () => {
    expect(detector.isAutomated('Mozilla/5.0 (compatible; UptimeRobot/2.0)')).toBe(
      true,
    );
    expect(detector.isAutomated('Pingdom.com_bot_version_1.4')).toBe(true);
  });

  it('keeps ordinary browser user-agents eligible', () => {
    expect(
      detector.isAutomated(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      ),
    ).toBe(false);
  });
});
