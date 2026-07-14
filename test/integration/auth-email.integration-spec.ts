import { getQueueToken } from '@nestjs/bullmq';
import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { DatabaseModule } from '../../src/database.module';
import { EmailProcessor } from '../../src/email.processor';
import { MailModule } from '../../src/mail.module';
import { AccountEntity } from '../../src/modules/auth/account.entity';
import { AccountRole } from '../../src/modules/auth/account-role.enum';
import { AccountStatus } from '../../src/modules/auth/account-status.enum';
import {
  AuthEmailService,
  SEND_PASSWORD_RESET_JOB,
  SEND_VERIFICATION_CODE_JOB,
} from '../../src/modules/auth/auth-email.service';
import { AuthIssuancePurpose } from '../../src/modules/auth/auth-state.service';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { AuthStateService } from '../../src/modules/auth/auth-state.service';
import { PasswordResetTokenEntity } from '../../src/modules/auth/password-reset-token.entity';
import { QueueAuthEmailService } from '../../src/modules/auth/queue-auth-email.service';
import { AUTH_EMAIL_QUEUE, RedisModule } from '../../src/redis.module';

const BCRYPT_HASH =
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

const MAILPIT_API = `http://${process.env.MAILPIT_HOST ?? 'mailpit'}:8025/api/v1`;

type MailpitMessageSummary = {
  ID: string;
  To: Array<{ Address: string }>;
  Subject: string;
  Snippet: string;
};

type MailpitMessagesResponse = {
  messages: MailpitMessageSummary[];
};

type MailpitMessageDetail = {
  ID: string;
  Subject: string;
  Text: string;
  HTML: string;
  To: Array<{ Address: string }>;
};

async function deleteAllMailpitMessages(): Promise<void> {
  const response = await fetch(`${MAILPIT_API}/messages`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(`Mailpit delete failed: ${response.status}`);
  }
}

async function waitForMailpitMessage(
  predicate: (message: MailpitMessageSummary) => boolean,
  timeoutMs = 15_000,
): Promise<MailpitMessageSummary> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await fetch(`${MAILPIT_API}/messages`);
    if (!response.ok) {
      throw new Error(`Mailpit list failed: ${response.status}`);
    }

    const body = (await response.json()) as MailpitMessagesResponse;
    const match = body.messages?.find(predicate);
    if (match) {
      return match;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error('Timed out waiting for Mailpit message');
}

async function getMailpitMessage(id: string): Promise<MailpitMessageDetail> {
  const response = await fetch(`${MAILPIT_API}/message/${id}`);
  if (!response.ok) {
    throw new Error(`Mailpit message fetch failed: ${response.status}`);
  }
  return (await response.json()) as MailpitMessageDetail;
}

describe('Auth email queue and processor (integration)', () => {
  let moduleRef: TestingModule;
  let app: INestApplicationContext;
  let authEmail: AuthEmailService;
  let authState: AuthStateService;
  let accounts: Repository<AccountEntity>;
  let resetTokens: Repository<PasswordResetTokenEntity>;
  let queue: Queue;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, RedisModule, MailModule, AuthModule],
      providers: [EmailProcessor],
    }).compile();

    app = moduleRef;
    await app.init();

    authEmail = moduleRef.get(AuthEmailService);
    authState = moduleRef.get(AuthStateService);
    accounts = moduleRef.get(getRepositoryToken(AccountEntity));
    resetTokens = moduleRef.get(getRepositoryToken(PasswordResetTokenEntity));
    queue = moduleRef.get<Queue>(getQueueToken(AUTH_EMAIL_QUEUE));
  });

  afterAll(async () => {
    await queue?.close();
    await app?.close();
  });

  beforeEach(async () => {
    await deleteAllMailpitMessages();
    await accounts.manager.query(
      'TRUNCATE TABLE "session_refresh_tokens", "auth_sessions", "password_reset_tokens", "auth_audit_events", "users" CASCADE',
    );
  });

  async function createAccount(email: string): Promise<AccountEntity> {
    return accounts.save(
      accounts.create({
        email,
        status: AccountStatus.PENDING,
        role: AccountRole.USER,
        passwordHash: BCRYPT_HASH,
      }),
    );
  }

  it('binds AuthEmailService to QueueAuthEmailService without BullMQ types in the interface', () => {
    expect(authEmail).toBeInstanceOf(QueueAuthEmailService);
    expect(authEmail).toBeInstanceOf(AuthEmailService);
  });

  it('enqueues verification jobs with only ids, purpose and issuanceId', async () => {
    const userId = randomUUID();
    const issuanceId = randomUUID();
    const addSpy = jest.spyOn(queue, 'add');

    try {
      await authEmail.enqueueVerificationCode({
        userId,
        purpose: AuthIssuancePurpose.ACTIVATION,
        issuanceId,
      });

      expect(addSpy).toHaveBeenCalledWith(
        SEND_VERIFICATION_CODE_JOB,
        {
          userId,
          purpose: AuthIssuancePurpose.ACTIVATION,
          issuanceId,
        },
      );

      const [, payload] = addSpy.mock.calls[0];
      expect(JSON.stringify(payload)).not.toMatch(/code|token|secret/i);
      expect(Object.keys(payload as object).sort()).toEqual(
        ['issuanceId', 'purpose', 'userId'].sort(),
      );
    } finally {
      addSpy.mockRestore();
    }
  });

  it('processes activation job and delivers email via Mailpit', async () => {
    const account = await createAccount(`activation-${randomUUID()}@example.com`);
    const issuanceId = randomUUID();

    await authState.setIssuance(
      AuthIssuancePurpose.ACTIVATION,
      account.id,
      issuanceId,
    );

    await authEmail.enqueueVerificationCode({
      userId: account.id,
      purpose: AuthIssuancePurpose.ACTIVATION,
      issuanceId,
    });

    const summary = await waitForMailpitMessage(
      (message) =>
        message.To.some((to) => to.Address === account.email) &&
        /activat|verif/i.test(message.Subject),
    );

    const detail = await getMailpitMessage(summary.ID);
    expect(detail.Text).toMatch(/\b\d{6}\b/);

    const codeMatch = detail.Text.match(/\b(\d{6})\b/);
    expect(codeMatch).not.toBeNull();

    const consumed = await authState.consumeActivationCode(
      account.id,
      codeMatch![1],
    );
    expect(consumed).toEqual({ status: 'consumed' });
  });

  it('processes login job and delivers email via Mailpit', async () => {
    const account = await createAccount(`login-${randomUUID()}@example.com`);
    const challengeId = randomUUID();
    const issuanceId = randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await authState.createLoginChallenge(
      account.id,
      challengeId,
      '000000',
      expiresAt,
    );
    await authState.setIssuance(
      AuthIssuancePurpose.LOGIN,
      challengeId,
      issuanceId,
    );

    await authEmail.enqueueVerificationCode({
      challengeId,
      purpose: AuthIssuancePurpose.LOGIN,
      issuanceId,
    });

    const summary = await waitForMailpitMessage(
      (message) =>
        message.To.some((to) => to.Address === account.email) &&
        /login/i.test(message.Subject),
    );

    const detail = await getMailpitMessage(summary.ID);
    const codeMatch = detail.Text.match(/\b(\d{6})\b/);
    expect(codeMatch).not.toBeNull();

    const consumed = await authState.consumeLoginChallenge(
      challengeId,
      codeMatch![1],
    );
    expect(consumed).toEqual({ status: 'consumed', userId: account.id });
  });

  it('processes password reset job with fragment token URL', async () => {
    const account = await createAccount(`reset-${randomUUID()}@example.com`);
    await accounts.update(account.id, { status: AccountStatus.ACTIVE });
    const issuanceId = randomUUID();

    await authState.setIssuance(
      AuthIssuancePurpose.RESET,
      account.id,
      issuanceId,
    );

    await authEmail.enqueuePasswordReset({
      userId: account.id,
      issuanceId,
    });

    const summary = await waitForMailpitMessage(
      (message) =>
        message.To.some((to) => to.Address === account.email) &&
        /reset|password/i.test(message.Subject),
    );

    const detail = await getMailpitMessage(summary.ID);
    expect(detail.Text).toMatch(/#token=/);
    expect(detail.Text).not.toMatch(/\?token=/);

    const tokenMatch = detail.Text.match(/#token=([A-Za-z0-9_-]+)/);
    expect(tokenMatch).not.toBeNull();

    const stored = await resetTokens.find({ where: { userId: account.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0].tokenHash).not.toBe(tokenMatch![1]);
    expect(stored[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);

    const jobs = await queue.getJobs(['waiting', 'active', 'delayed', 'completed', 'failed']);
    const resetJob = jobs.find(
      (candidate) =>
        candidate.name === SEND_PASSWORD_RESET_JOB &&
        candidate.data?.issuanceId === issuanceId,
    );
    if (resetJob) {
      expect(JSON.stringify(resetJob.data)).not.toMatch(
        new RegExp(tokenMatch![1]),
      );
      expect(Object.keys(resetJob.data).sort()).toEqual(
        ['issuanceId', 'purpose', 'userId'].sort(),
      );
    }
  });

  it('discards stale issuance without sending email or rotating secrets', async () => {
    const account = await createAccount(`stale-${randomUUID()}@example.com`);
    const currentIssuanceId = randomUUID();
    const staleIssuanceId = randomUUID();

    await authState.setIssuance(
      AuthIssuancePurpose.ACTIVATION,
      account.id,
      currentIssuanceId,
    );
    await authState.setActivationCode(
      account.id,
      '111111',
      new Date(Date.now() + 60_000),
    );

    await authEmail.enqueueVerificationCode({
      userId: account.id,
      purpose: AuthIssuancePurpose.ACTIVATION,
      issuanceId: staleIssuanceId,
    });

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const pending = await queue.getJobs(['waiting', 'active', 'delayed']);
      const stillQueued = pending.some(
        (job) => job.data?.issuanceId === staleIssuanceId,
      );
      if (!stillQueued) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const response = await fetch(`${MAILPIT_API}/messages`);
    const body = (await response.json()) as MailpitMessagesResponse;
    const leaked = body.messages?.some((message) =>
      message.To.some((to) => to.Address === account.email),
    );
    expect(leaked).toBeFalsy();

    await expect(
      authState.consumeActivationCode(account.id, '111111'),
    ).resolves.toEqual({ status: 'consumed' });
  });

  it('retries current issuance by generating a new secret that invalidates the previous', async () => {
    const account = await createAccount(`retry-${randomUUID()}@example.com`);
    const issuanceId = randomUUID();

    await authState.setIssuance(
      AuthIssuancePurpose.ACTIVATION,
      account.id,
      issuanceId,
    );

    await authEmail.enqueueVerificationCode({
      userId: account.id,
      purpose: AuthIssuancePurpose.ACTIVATION,
      issuanceId,
    });

    const firstSummary = await waitForMailpitMessage(
      (message) => message.To.some((to) => to.Address === account.email),
    );
    const firstDetail = await getMailpitMessage(firstSummary.ID);
    const firstCode = firstDetail.Text.match(/\b(\d{6})\b/)![1];

    await deleteAllMailpitMessages();

    await authEmail.enqueueVerificationCode({
      userId: account.id,
      purpose: AuthIssuancePurpose.ACTIVATION,
      issuanceId,
    });

    const secondSummary = await waitForMailpitMessage(
      (message) => message.To.some((to) => to.Address === account.email),
    );
    const secondDetail = await getMailpitMessage(secondSummary.ID);
    const secondCode = secondDetail.Text.match(/\b(\d{6})\b/)![1];

    expect(secondCode).not.toBe(firstCode);

    await expect(
      authState.consumeActivationCode(account.id, firstCode),
    ).resolves.toEqual({ status: 'invalid', attempts: 1 });

    await expect(
      authState.consumeActivationCode(account.id, secondCode),
    ).resolves.toEqual({ status: 'consumed' });
  });
});
