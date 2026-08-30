import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import {
  AccountStatus,
  PlatformRole,
  QuestionType,
  TenantMembershipRole,
  TenantMembershipStatus,
  TenantStatus,
} from '../../../.generated/prisma/client';
import type { DatabaseRuntimeConfig } from '../../infrastructure/database/database.config';
import { DATABASE_RUNTIME_CONFIG } from '../../infrastructure/database/database.constants';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ApiExceptionFilter } from '../../infrastructure/http/api-exception.filter';
import { AuthModule } from '../auth/auth.module';
import { AUTH_RUNTIME_CONFIG } from '../auth/auth.constants';
import { AUTH_HTTP_CONFIG } from '../auth/http/auth-http.constants';
import { AccessTokenService } from '../auth/services/access-token.service';
import { RefreshSessionService } from '../auth/services/refresh-session.service';
import { UuidV7Service } from '../auth/services/uuid-v7.service';
import { testAuthConfig } from '../auth/test-helpers';
import { TenancyModule } from '../tenancy/tenancy.module';
import { QuizzesModule } from './quizzes.module';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const maybeDescribe = testDatabaseUrl ? describe : describe.skip;
const trustedOrigin = 'http://localhost:3000';

maybeDescribe('instructor quiz HTTP PostgreSQL integration', () => {
  let app: INestApplication;
  let server: App;
  let prisma: PrismaService;
  let accessTokens: AccessTokenService;
  let refreshSessions: RefreshSessionService;
  let uuid: UuidV7Service;

  beforeEach(async () => {
    const databaseConfig: DatabaseRuntimeConfig = {
      databaseUrl: testDatabaseUrl as string,
      pool: {
        maxConnections: 6,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 10_000,
      },
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule, TenancyModule, QuizzesModule],
    })
      .overrideProvider(DATABASE_RUNTIME_CONFIG)
      .useValue(databaseConfig)
      .overrideProvider(AUTH_RUNTIME_CONFIG)
      .useValue(testAuthConfig)
      .overrideProvider(AUTH_HTTP_CONFIG)
      .useValue({
        trustedWebOrigins: [trustedOrigin],
        cookies: {
          refreshTokenName: 'edvora_refresh',
          sessionIdName: 'edvora_session',
          path: '/auth',
          httpOnly: true,
          secure: false,
          sameSite: 'lax',
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: true,
      }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    server = app.getHttpServer() as App;

    prisma = moduleRef.get(PrismaService);
    accessTokens = moduleRef.get(AccessTokenService);
    refreshSessions = moduleRef.get(RefreshSessionService);
    uuid = moduleRef.get(UuidV7Service);

    await clearQuizData();
  });

  afterEach(async () => {
    // Same cross-suite cleanliness discipline as the Course module's postgres tests: this file
    // creates Question/QuestionOption rows with `onDelete: Restrict` foreign keys back to Quiz,
    // so leftover rows would break other *.postgres-test.ts files' unconditional cleanup calls.
    await clearQuizData();
    await app?.close();
  });

  it('creates a Quiz, lists it, reads detail, and updates safe metadata', async () => {
    const { token, tenantId } = await createInstructorTenant('create');

    const created = await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: '  Algebra Quiz  ',
        description: '  Covers chapter 1  ',
        passingScorePercent: 70,
        attemptLimit: 3,
      })
      .expect(HttpStatus.CREATED);
    const body = responseBody<{ quizId: string; tenantId: string }>(created);
    expect(body.tenantId).toBe(tenantId);
    expect(created.body).toMatchObject({
      title: 'Algebra Quiz',
      description: 'Covers chapter 1',
      status: 'DRAFT',
      passingScorePercent: '70',
      attemptLimit: 3,
      revealAnswersPolicy: 'NEVER',
    });

    const quizId = body.quizId;

    const list = await request(server)
      .get(`/instructor/tenants/${tenantId}/quizzes`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(responseBody<{ items: Array<{ quizId: string }> }>(list).items.map((item) => item.quizId)).toEqual([
      quizId,
    ]);

    await request(server)
      .get(`/instructor/tenants/${tenantId}/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body: detail }) => expect(detail).toMatchObject({ quizId, title: 'Algebra Quiz' }));

    const updated = await request(server)
      .patch(`/instructor/tenants/${tenantId}/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated title', passingScorePercent: 80 })
      .expect(HttpStatus.OK);
    expect(updated.body).toMatchObject({ title: 'Updated title', passingScorePercent: '80' });

    const rejectedFields = await request(server)
      .patch(`/instructor/tenants/${tenantId}/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'PUBLISHED', tenantId: uuid.create() })
      .expect(HttpStatus.BAD_REQUEST);
    expect(rejectedFields.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('denies cross-tenant Quiz access and Quiz A + Question B substitution without mutation', async () => {
    const { token, tenantId } = await createInstructorTenant('tenant-a');
    const { token: otherToken, tenantId: otherTenantId, instructorId: otherInstructorId } = await createInstructorTenant('tenant-b');

    const quizId = await createQuizDirect(tenantId, 'Tenant A quiz');
    const otherQuizId = await createQuizDirect(otherTenantId, 'Tenant B quiz');
    const quizC = await createQuizDirect(tenantId, 'Tenant A sibling quiz');
    const questionUnderC = await createQuestionDirect(tenantId, quizC, QuestionType.TRUE_FALSE, 1);

    // Cross-tenant instructor cannot read/mutate a quiz outside their own tenant.
    await request(server)
      .get(`/instructor/tenants/${otherTenantId}/quizzes/${otherQuizId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.FORBIDDEN);

    // Same tenant, but the quizId in the URL doesn't own this question (sibling quiz) — 404,
    // not a leak of "exists under a different quiz."
    const substitution = await request(server)
      .patch(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionUnderC}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ prompt: 'Hijacked prompt' })
      .expect(HttpStatus.NOT_FOUND);
    expect(substitution.body).toMatchObject({ error: { code: 'QUESTION_NOT_FOUND' } });

    await expect(prisma.client.question.findUniqueOrThrow({ where: { id: questionUnderC } })).resolves.toMatchObject({
      quizId: quizC,
    });

    // The other tenant's own authorized instructor can still operate on their own quiz.
    await request(server)
      .patch(`/instructor/tenants/${otherTenantId}/quizzes/${otherQuizId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ title: 'Legit update' })
      .expect(HttpStatus.OK);

    void otherInstructorId;
  });

  it('creates a valid MULTIPLE_CHOICE question with options and enforces at most one correct answer', async () => {
    const { token, tenantId } = await createInstructorTenant('mc');
    const quizId = await createQuizDirect(tenantId, 'MC quiz');

    const question = await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'MULTIPLE_CHOICE', prompt: 'What is 2+2?', points: 5 })
      .expect(HttpStatus.CREATED);
    const questionId = responseBody<{ questionId: string }>(question).questionId;
    expect(question.body).toMatchObject({ type: 'MULTIPLE_CHOICE', points: '5', status: 'ACTIVE' });

    const optionA = await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'A', text: '3', isCorrect: false })
      .expect(HttpStatus.CREATED);

    const optionB = await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'B', text: '4', isCorrect: true })
      .expect(HttpStatus.CREATED);
    const optionBId = responseBody<{ optionId: string }>(optionB).optionId;

    // A second option cannot also be marked correct.
    const conflict = await request(server)
      .patch(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options/${responseBody<{ optionId: string }>(optionA).optionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isCorrect: true })
      .expect(HttpStatus.BAD_REQUEST);
    expect(conflict.body).toMatchObject({ error: { code: 'MULTIPLE_CORRECT_OPTIONS_NOT_ALLOWED' } });

    const options = await request(server)
      .get(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    const items = responseBody<{ items: Array<{ optionId: string; isCorrect: boolean }> }>(options).items;
    expect(items.filter((item) => item.isCorrect).map((item) => item.optionId)).toEqual([optionBId]);
  });

  it('creates a valid TRUE_FALSE question limited to exactly two options', async () => {
    const { token, tenantId } = await createInstructorTenant('tf');
    const quizId = await createQuizDirect(tenantId, 'TF quiz');

    const question = await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'TRUE_FALSE', prompt: 'The sky is blue.', points: 1 })
      .expect(HttpStatus.CREATED);
    const questionId = responseBody<{ questionId: string }>(question).questionId;

    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'True', isCorrect: true })
      .expect(HttpStatus.CREATED);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'False', isCorrect: false })
      .expect(HttpStatus.CREATED);

    const overLimit = await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'Maybe', isCorrect: false })
      .expect(HttpStatus.BAD_REQUEST);
    expect(overLimit.body).toMatchObject({ error: { code: 'QUESTION_OPTION_LIMIT_EXCEEDED' } });

    await expect(prisma.client.questionOption.count({ where: { questionId } })).resolves.toBe(2);
  });

  it('rejects Question A + Option B substitution without mutation', async () => {
    const { token, tenantId } = await createInstructorTenant('option-substitution');
    const quizId = await createQuizDirect(tenantId, 'Quiz');
    const questionA = await createQuestionDirect(tenantId, quizId, QuestionType.TRUE_FALSE, 1);
    const questionB = await createQuestionDirect(tenantId, quizId, QuestionType.TRUE_FALSE, 2);
    const optionUnderB = await createQuestionOptionDirect(tenantId, questionB, 'Option under B', 1, false);

    const response = await request(server)
      .patch(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionA}/options/${optionUnderB}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'Hijacked option' })
      .expect(HttpStatus.NOT_FOUND);
    expect(response.body).toMatchObject({ error: { code: 'QUESTION_OPTION_NOT_FOUND' } });

    await expect(prisma.client.questionOption.findUniqueOrThrow({ where: { id: optionUnderB } })).resolves.toMatchObject({
      text: 'Option under B',
      questionId: questionB,
    });
  });

  it('creates Questions and Options in deterministic position order', async () => {
    const { token, tenantId } = await createInstructorTenant('deterministic-order');
    const quizId = await createQuizDirect(tenantId, 'Order quiz');

    const questionIds: string[] = [];
    for (const prompt of ['Q1', 'Q2', 'Q3']) {
      const response = await request(server)
        .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'TRUE_FALSE', prompt, points: 1 })
        .expect(HttpStatus.CREATED);
      questionIds.push(responseBody<{ questionId: string }>(response).questionId);
    }

    const questionList = await request(server)
      .get(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    const questionItems = responseBody<{ items: Array<{ questionId: string; position: number }> }>(
      questionList,
    ).items;
    expect(questionItems.map((item) => item.questionId)).toEqual(questionIds);
    expect(questionItems.map((item) => item.position)).toEqual([1, 2, 3]);

    const firstQuestion = questionIds[0];
    const optionIds: string[] = [];
    for (const text of ['True', 'False']) {
      const response = await request(server)
        .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${firstQuestion}/options`)
        .set('Authorization', `Bearer ${token}`)
        .send({ text })
        .expect(HttpStatus.CREATED);
      optionIds.push(responseBody<{ optionId: string }>(response).optionId);
    }

    const optionList = await request(server)
      .get(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${firstQuestion}/options`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    const optionItems = responseBody<{ items: Array<{ optionId: string; position: number }> }>(optionList).items;
    expect(optionItems.map((item) => item.optionId)).toEqual(optionIds);
    expect(optionItems.map((item) => item.position)).toEqual([1, 2]);
  });

  it('reorders Questions into exactly the requested order and rejects invalid reorder payloads without mutation', async () => {
    const { token, tenantId } = await createInstructorTenant('reorder-questions');
    const quizId = await createQuizDirect(tenantId, 'Reorder quiz');
    const q1 = await createQuestionDirect(tenantId, quizId, QuestionType.TRUE_FALSE, 1);
    const q2 = await createQuestionDirect(tenantId, quizId, QuestionType.TRUE_FALSE, 2);
    const q3 = await createQuestionDirect(tenantId, quizId, QuestionType.TRUE_FALSE, 3);

    const foreignQuiz = await createQuizDirect(tenantId, 'Foreign quiz');
    const foreignQuestion = await createQuestionDirect(tenantId, foreignQuiz, QuestionType.TRUE_FALSE, 1);

    const before = await prisma.client.question.findMany({ where: { quizId }, orderBy: { position: 'asc' } });

    const missingId = await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/reorder`)
      .set('Authorization', `Bearer ${token}`)
      .send({ questionIds: [q1, q2] })
      .expect(HttpStatus.BAD_REQUEST);
    expect(missingId.body).toMatchObject({ error: { code: 'INVALID_QUESTION_REORDER' } });

    const foreignId = await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/reorder`)
      .set('Authorization', `Bearer ${token}`)
      .send({ questionIds: [q1, q2, q3, foreignQuestion] })
      .expect(HttpStatus.BAD_REQUEST);
    expect(foreignId.body).toMatchObject({ error: { code: 'INVALID_QUESTION_REORDER' } });

    const after = await prisma.client.question.findMany({ where: { quizId }, orderBy: { position: 'asc' } });
    expect(after).toEqual(before);
    await expect(prisma.client.question.findUniqueOrThrow({ where: { id: foreignQuestion } })).resolves.toMatchObject({
      quizId: foreignQuiz,
    });

    const reordered = await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/reorder`)
      .set('Authorization', `Bearer ${token}`)
      .send({ questionIds: [q3, q1, q2] })
      .expect(HttpStatus.OK);
    expect(responseBody<{ items: Array<{ questionId: string }> }>(reordered).items.map((item) => item.questionId)).toEqual([
      q3,
      q1,
      q2,
    ]);

    const finalRows = await prisma.client.question.findMany({ where: { quizId }, orderBy: { position: 'asc' } });
    expect(finalRows.map((row) => row.id)).toEqual([q3, q1, q2]);
    expect(new Set(finalRows.map((row) => row.position)).size).toBe(finalRows.length);
  });

  it('reorders Options into exactly the requested order', async () => {
    const { token, tenantId } = await createInstructorTenant('reorder-options');
    const quizId = await createQuizDirect(tenantId, 'Quiz');
    const questionId = await createQuestionDirect(tenantId, quizId, QuestionType.MULTIPLE_CHOICE, 1);
    const o1 = await createQuestionOptionDirect(tenantId, questionId, 'O1', 1, false);
    const o2 = await createQuestionOptionDirect(tenantId, questionId, 'O2', 2, false);
    const o3 = await createQuestionOptionDirect(tenantId, questionId, 'O3', 3, true);

    const reordered = await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options/reorder`)
      .set('Authorization', `Bearer ${token}`)
      .send({ optionIds: [o3, o1, o2] })
      .expect(HttpStatus.OK);
    expect(responseBody<{ items: Array<{ optionId: string }> }>(reordered).items.map((item) => item.optionId)).toEqual([
      o3,
      o1,
      o2,
    ]);

    const finalRows = await prisma.client.questionOption.findMany({ where: { questionId }, orderBy: { position: 'asc' } });
    expect(finalRows.map((row) => row.id)).toEqual([o3, o1, o2]);
    expect(new Set(finalRows.map((row) => row.position)).size).toBe(3);
    // isCorrect must be untouched by a pure position reorder.
    expect(finalRows.find((row) => row.id === o3)?.isCorrect).toBe(true);
  });

  it('does not create duplicate positions under concurrent Question creation', async () => {
    const { token, tenantId } = await createInstructorTenant('concurrency-question');
    const quizId = await createQuizDirect(tenantId, 'Concurrency quiz');

    const responses = await Promise.all([
      request(server)
        .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'TRUE_FALSE', prompt: 'Q A', points: 1 }),
      request(server)
        .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'TRUE_FALSE', prompt: 'Q B', points: 1 }),
      request(server)
        .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'TRUE_FALSE', prompt: 'Q C', points: 1 }),
    ]);

    const statuses: number[] = responses.map((response) => response.status);
    const createdStatus: number = HttpStatus.CREATED;
    const conflictStatus: number = HttpStatus.CONFLICT;
    expect(statuses.every((status) => status === createdStatus || status === conflictStatus)).toBe(true);
    const createdCount = statuses.filter((status) => status === createdStatus).length;
    expect(createdCount).toBeGreaterThanOrEqual(1);

    const questionsInDb = await prisma.client.question.findMany({ where: { quizId } });
    expect(questionsInDb).toHaveLength(createdCount);
    expect(new Set(questionsInDb.map((row) => row.position)).size).toBe(questionsInDb.length);
  });

  it('does not create duplicate positions under concurrent Option creation', async () => {
    const { token, tenantId } = await createInstructorTenant('concurrency-option');
    const quizId = await createQuizDirect(tenantId, 'Quiz');
    const questionId = await createQuestionDirect(tenantId, quizId, QuestionType.MULTIPLE_CHOICE, 1);

    const responses = await Promise.all([
      request(server)
        .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options`)
        .set('Authorization', `Bearer ${token}`)
        .send({ text: 'Option A' }),
      request(server)
        .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options`)
        .set('Authorization', `Bearer ${token}`)
        .send({ text: 'Option B' }),
      request(server)
        .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options`)
        .set('Authorization', `Bearer ${token}`)
        .send({ text: 'Option C' }),
    ]);

    const statuses: number[] = responses.map((response) => response.status);
    const createdStatus: number = HttpStatus.CREATED;
    const conflictStatus: number = HttpStatus.CONFLICT;
    expect(statuses.every((status) => status === createdStatus || status === conflictStatus)).toBe(true);
    const createdCount = statuses.filter((status) => status === createdStatus).length;
    expect(createdCount).toBeGreaterThanOrEqual(1);

    const optionsInDb = await prisma.client.questionOption.findMany({ where: { questionId } });
    expect(optionsInDb).toHaveLength(createdCount);
    expect(new Set(optionsInDb.map((row) => row.position)).size).toBe(optionsInDb.length);
  });

  it('serializes concurrent correct-option creation on a MULTIPLE_CHOICE question: exactly one succeeds', async () => {
    const { token, tenantId } = await createInstructorTenant('concurrency-correct-create');
    const quizId = await createQuizDirect(tenantId, 'Quiz');
    const questionId = await createQuestionDirect(tenantId, quizId, QuestionType.MULTIPLE_CHOICE, 1);

    const [first, second] = await Promise.all([
      request(server)
        .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options`)
        .set('Authorization', `Bearer ${token}`)
        .send({ text: 'Option A', isCorrect: true }),
      request(server)
        .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options`)
        .set('Authorization', `Bearer ${token}`)
        .send({ text: 'Option B', isCorrect: true }),
    ]);

    const responses = [first, second];
    const createdStatus: number = HttpStatus.CREATED;
    const rejectedStatus: number = HttpStatus.BAD_REQUEST;
    const statuses = responses.map((response) => response.status).sort((a, b) => a - b);
    expect(statuses).toEqual([createdStatus, rejectedStatus].sort((a, b) => a - b));

    const rejected = responses.find((response) => response.status === rejectedStatus);
    expect(rejected?.body).toMatchObject({ error: { code: 'MULTIPLE_CORRECT_OPTIONS_NOT_ALLOWED' } });

    // The losing request's option must never have been created — not merely left non-correct.
    const optionsInDb = await prisma.client.questionOption.findMany({ where: { questionId } });
    expect(optionsInDb).toHaveLength(1);
    expect(optionsInDb.filter((row) => row.isCorrect)).toHaveLength(1);
  });

  it('serializes a concurrent TRUE_FALSE third-option race: only one succeeds, final count is exactly two', async () => {
    const { token, tenantId } = await createInstructorTenant('concurrency-tf-limit');
    const quizId = await createQuizDirect(tenantId, 'Quiz');
    const questionId = await createQuestionDirect(tenantId, quizId, QuestionType.TRUE_FALSE, 1);
    await createQuestionOptionDirect(tenantId, questionId, 'True', 1, true);

    const [first, second] = await Promise.all([
      request(server)
        .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options`)
        .set('Authorization', `Bearer ${token}`)
        .send({ text: 'False (attempt 1)' }),
      request(server)
        .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options`)
        .set('Authorization', `Bearer ${token}`)
        .send({ text: 'False (attempt 2)' }),
    ]);

    const responses = [first, second];
    const createdStatus: number = HttpStatus.CREATED;
    const rejectedStatus: number = HttpStatus.BAD_REQUEST;
    const statuses = responses.map((response) => response.status).sort((a, b) => a - b);
    expect(statuses).toEqual([createdStatus, rejectedStatus].sort((a, b) => a - b));

    const rejected = responses.find((response) => response.status === rejectedStatus);
    expect(rejected?.body).toMatchObject({ error: { code: 'QUESTION_OPTION_LIMIT_EXCEEDED' } });

    await expect(prisma.client.questionOption.count({ where: { questionId } })).resolves.toBe(2);
  });

  it('serializes concurrent correct-option updates on two existing options: exactly one wins', async () => {
    const { token, tenantId } = await createInstructorTenant('concurrency-correct-update');
    const quizId = await createQuizDirect(tenantId, 'Quiz');
    const questionId = await createQuestionDirect(tenantId, quizId, QuestionType.MULTIPLE_CHOICE, 1);
    const optionA = await createQuestionOptionDirect(tenantId, questionId, 'Option A', 1, false);
    const optionB = await createQuestionOptionDirect(tenantId, questionId, 'Option B', 2, false);

    const [first, second] = await Promise.all([
      request(server)
        .patch(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options/${optionA}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isCorrect: true }),
      request(server)
        .patch(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options/${optionB}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isCorrect: true }),
    ]);

    const responses = [first, second];
    const okStatus: number = HttpStatus.OK;
    const rejectedStatus: number = HttpStatus.BAD_REQUEST;
    const statuses = responses.map((response) => response.status).sort((a, b) => a - b);
    expect(statuses).toEqual([okStatus, rejectedStatus].sort((a, b) => a - b));

    const rejected = responses.find((response) => response.status === rejectedStatus);
    expect(rejected?.body).toMatchObject({ error: { code: 'MULTIPLE_CORRECT_OPTIONS_NOT_ALLOWED' } });

    const finalOptions = await prisma.client.questionOption.findMany({ where: { questionId } });
    expect(finalOptions.filter((row) => row.isCorrect)).toHaveLength(1);
    expect(finalOptions).toHaveLength(2);
    // The losing option must remain exactly as it was — not left in some intermediate state.
    const loserId = rejected === first ? optionA : optionB;
    expect(finalOptions.find((row) => row.id === loserId)?.isCorrect).toBe(false);
  });

  it('rejects invalid type/correct-answer configuration atomically, leaving no partial state', async () => {
    const { token, tenantId } = await createInstructorTenant('invalid-config');
    const quizId = await createQuizDirect(tenantId, 'Quiz');
    const questionId = await createQuestionDirect(tenantId, quizId, QuestionType.TRUE_FALSE, 1);
    await createQuestionOptionDirect(tenantId, questionId, 'True', 1, true);
    await createQuestionOptionDirect(tenantId, questionId, 'False', 2, false);

    // A third option on a TRUE_FALSE question is rejected atomically — no row created.
    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'Maybe', isCorrect: true })
      .expect(HttpStatus.BAD_REQUEST);
    await expect(prisma.client.questionOption.count({ where: { questionId } })).resolves.toBe(2);

    // Attempting to mark a second option correct is rejected atomically — no row changed.
    const falseOption = await prisma.client.questionOption.findFirstOrThrow({ where: { questionId, text: 'False' } });
    await request(server)
      .patch(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options/${falseOption.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isCorrect: true })
      .expect(HttpStatus.BAD_REQUEST);
    await expect(
      prisma.client.questionOption.findUniqueOrThrow({ where: { id: falseOption.id } }),
    ).resolves.toMatchObject({ isCorrect: false });
    await expect(prisma.client.questionOption.count({ where: { questionId, isCorrect: true } })).resolves.toBe(1);
  });

  it('denies student and platform admin instructor quiz routes', async () => {
    const { tenantId } = await createInstructorTenant('role-guard');
    const studentId = await createUser('quiz-student', PlatformRole.STUDENT);
    const adminId = await createUser('quiz-admin', PlatformRole.PLATFORM_ADMIN);
    const studentToken = await issueAccessToken(studentId, PlatformRole.STUDENT);
    const adminToken = await issueAccessToken(adminId, PlatformRole.PLATFORM_ADMIN);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ title: 'Student quiz' })
      .expect(HttpStatus.FORBIDDEN);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Admin quiz' })
      .expect(HttpStatus.FORBIDDEN);
  });

  async function clearQuizData(): Promise<void> {
    await prisma.client.quizAttemptAnswer.deleteMany();
    await prisma.client.quizAttempt.deleteMany();
    await prisma.client.quizLesson.deleteMany();
    await prisma.client.questionOption.deleteMany();
    await prisma.client.question.deleteMany();
    await prisma.client.quiz.deleteMany();
    await prisma.client.securityEvent.deleteMany();
    await prisma.client.deviceChangeRequest.deleteMany();
    await prisma.client.refreshSession.deleteMany();
    await prisma.client.accountActivationToken.deleteMany();
    await prisma.client.passwordResetToken.deleteMany();
    await prisma.client.authCredential.deleteMany();
    await prisma.client.tenantStudent.deleteMany();
    await prisma.client.tenantMembership.deleteMany();
    await prisma.client.studentDevice.deleteMany();
    await prisma.client.studentProfile.deleteMany();
    await prisma.client.instructorProfile.deleteMany();
    await prisma.client.tenant.deleteMany({
      where: { slug: { startsWith: 'quiz-test-' } },
    });
    await prisma.client.user.deleteMany({
      where: { normalizedEmail: { endsWith: '@example.test' } },
    });
  }

  async function createUser(emailPrefix: string, platformRole: PlatformRole): Promise<string> {
    const id = uuid.create();
    await prisma.client.user.create({
      data: {
        id,
        email: `${emailPrefix}@example.test`,
        normalizedEmail: `${emailPrefix}@example.test`,
        accountStatus: AccountStatus.ACTIVE,
        platformRole,
      },
    });
    return id;
  }

  async function createInstructorTenant(slugSuffix: string): Promise<{
    instructorId: string;
    tenantId: string;
    token: string;
  }> {
    const instructorId = await createUser(`instructor-${slugSuffix}`, PlatformRole.INSTRUCTOR);
    await prisma.client.instructorProfile.create({ data: { id: uuid.create(), userId: instructorId } });
    const tenant = await prisma.client.tenant.create({
      data: {
        id: uuid.create(),
        name: `Quiz Tenant ${slugSuffix}`,
        slug: `quiz-test-${slugSuffix}`,
        status: TenantStatus.ACTIVE,
      },
    });
    await prisma.client.tenantMembership.create({
      data: {
        id: uuid.create(),
        tenantId: tenant.id,
        userId: instructorId,
        role: TenantMembershipRole.OWNER,
        status: TenantMembershipStatus.ACTIVE,
      },
    });
    return {
      instructorId,
      tenantId: tenant.id,
      token: await issueAccessToken(instructorId, PlatformRole.INSTRUCTOR),
    };
  }

  async function createQuizDirect(tenantId: string, title: string): Promise<string> {
    const id = uuid.create();
    await prisma.client.quiz.create({ data: { id, tenantId, title } });
    return id;
  }

  async function createQuestionDirect(
    tenantId: string,
    quizId: string,
    type: QuestionType,
    position: number,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.question.create({
      data: { id, tenantId, quizId, type, prompt: `Prompt ${position}`, position, points: 1 },
    });
    return id;
  }

  async function createQuestionOptionDirect(
    tenantId: string,
    questionId: string,
    text: string,
    position: number,
    isCorrect: boolean,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.questionOption.create({
      data: { id, tenantId, questionId, text, position, isCorrect },
    });
    return id;
  }

  async function issueAccessToken(userId: string, platformRole: PlatformRole): Promise<string> {
    const session = await refreshSessions.createSession({ userId, channel: 'MOBILE' });
    return accessTokens.sign({ userId, sessionId: session.sessionId, platformRole });
  }
});

function responseBody<T>(response: request.Response): T {
  return response.body as T;
}
