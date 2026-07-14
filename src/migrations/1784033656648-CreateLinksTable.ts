import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLinksTable1784033656648 implements MigrationInterface {
  name = 'CreateLinksTable1784033656648';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "links" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "shortCode" character varying(6) NOT NULL, "destinationUrl" character varying(2048) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'ACTIVE', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ecf17f4a741d3c5ba0b4c5ab4b6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_f5e434d70a12e8e6544fdbda8b" ON "links" ("shortCode") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_links_user_active" ON "links" ("userId") WHERE "status" = 'ACTIVE'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_links_user_destination" ON "links" ("userId", "destinationUrl") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_links_user_created_at_id" ON "links" ("userId", "createdAt", "id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "links" ADD CONSTRAINT "FK_56668229b541edc1d0e291b4c3b" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "links" DROP CONSTRAINT "FK_56668229b541edc1d0e291b4c3b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_links_user_created_at_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_links_user_destination"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_links_user_active"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f5e434d70a12e8e6544fdbda8b"`,
    );
    await queryRunner.query(`DROP TABLE "links"`);
  }
}
