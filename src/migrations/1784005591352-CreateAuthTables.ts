import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAuthTables1784005591352 implements MigrationInterface {
    name = 'CreateAuthTables1784005591352'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "auth_audit_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid, "type" character varying(32) NOT NULL, "sessionId" uuid, "ipHash" character varying(128), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "metadata" jsonb, CONSTRAINT "PK_4ce7e89f8c00d8b6a81408713f9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_auth_audit_events_user_id" ON "auth_audit_events" ("userId") `);
        await queryRunner.query(`CREATE TABLE "password_reset_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "tokenHash" character varying(128) NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "usedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_d16bebd73e844c48bca50ff8d3d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_password_reset_tokens_user_id" ON "password_reset_tokens" ("userId") `);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying(320) NOT NULL, "status" character varying(16) NOT NULL, "role" character varying(16) NOT NULL, "passwordHash" character varying(60) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email") `);
        await queryRunner.query(`CREATE TABLE "auth_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "refreshTokenHash" character varying(128) NOT NULL, "csrfTokenHash" character varying(128) NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "revokedAt" TIMESTAMP WITH TIME ZONE, "revocationReason" character varying(32), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "lastRotatedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_641507381f32580e8479efc36cd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_auth_sessions_user_active" ON "auth_sessions" ("userId") WHERE "revokedAt" IS NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_auth_sessions_user_id" ON "auth_sessions" ("userId") `);
        await queryRunner.query(`CREATE TABLE "session_refresh_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "sessionId" uuid NOT NULL, "tokenHash" character varying(128) NOT NULL, "issuedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "usedAt" TIMESTAMP WITH TIME ZONE, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_c25bb23cefd8e77e04f9a1283ef" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_b42ff12c5e4def8c548fb161f8" ON "session_refresh_tokens" ("tokenHash") `);
        await queryRunner.query(`ALTER TABLE "auth_audit_events" ADD CONSTRAINT "FK_344e93546353176fcd839bd25a2" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "FK_d6a19d4b4f6c62dcd29daa497e2" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "auth_sessions" ADD CONSTRAINT "FK_925b24d7fc2f9324ce972aee025" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "session_refresh_tokens" ADD CONSTRAINT "FK_b7a5f598e03d861a529e1062c92" FOREIGN KEY ("sessionId") REFERENCES "auth_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "session_refresh_tokens" DROP CONSTRAINT "FK_b7a5f598e03d861a529e1062c92"`);
        await queryRunner.query(`ALTER TABLE "auth_sessions" DROP CONSTRAINT "FK_925b24d7fc2f9324ce972aee025"`);
        await queryRunner.query(`ALTER TABLE "password_reset_tokens" DROP CONSTRAINT "FK_d6a19d4b4f6c62dcd29daa497e2"`);
        await queryRunner.query(`ALTER TABLE "auth_audit_events" DROP CONSTRAINT "FK_344e93546353176fcd839bd25a2"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b42ff12c5e4def8c548fb161f8"`);
        await queryRunner.query(`DROP TABLE "session_refresh_tokens"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_auth_sessions_user_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_auth_sessions_user_active"`);
        await queryRunner.query(`DROP TABLE "auth_sessions"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_password_reset_tokens_user_id"`);
        await queryRunner.query(`DROP TABLE "password_reset_tokens"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_auth_audit_events_user_id"`);
        await queryRunner.query(`DROP TABLE "auth_audit_events"`);
    }

}
