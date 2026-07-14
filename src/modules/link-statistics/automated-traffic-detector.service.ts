import { Injectable } from '@nestjs/common';

/**
 * Versioned static signatures for known crawlers, link previews and uptime monitors.
 * Bump when the list changes so exclusions remain explicit and reviewable.
 */
export const AUTOMATED_TRAFFIC_SIGNATURES_VERSION = 1;

const AUTOMATED_USER_AGENT_SIGNATURES: readonly string[] = [
  // Google
  'Googlebot',
  'Google-InspectionTool',
  'Storebot-Google',
  'GoogleOther',
  'APIs-Google',
  'AdsBot-Google',
  // Bing
  'bingbot',
  'BingPreview',
  // Facebook / Meta
  'facebookexternalhit',
  'Facebot',
  'meta-externalagent',
  // Twitter / X
  'Twitterbot',
  // Slack
  'Slackbot',
  'Slack-ImgProxy',
  // Discord
  'Discordbot',
  // LinkedIn
  'LinkedInBot',
  // Uptime monitors
  'UptimeRobot',
  'Pingdom',
  'StatusCake',
  'Site24x7',
  'Uptime-Kuma',
  'Better Stack',
  'BetterUptime',
];

@Injectable()
export class AutomatedTrafficDetector {
  isAutomated(userAgent: string): boolean {
    const normalized = userAgent?.trim() ?? '';
    if (normalized.length === 0) {
      return false;
    }

    const lower = normalized.toLowerCase();
    return AUTOMATED_USER_AGENT_SIGNATURES.some((signature) =>
      lower.includes(signature.toLowerCase()),
    );
  }
}
