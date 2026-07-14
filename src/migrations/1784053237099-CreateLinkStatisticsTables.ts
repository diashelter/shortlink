import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateLinkStatisticsTables1784053237099 implements MigrationInterface {
    name = 'CreateLinkStatisticsTables1784053237099'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "link_statistics_days" ("linkId" uuid NOT NULL, "occurredOn" date NOT NULL, "finalizedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_4e1b2db644e7bd231cebfc1c977" PRIMARY KEY ("linkId", "occurredOn"))`);
        await queryRunner.query(`CREATE TABLE "link_monthly_aggregates" ("linkId" uuid NOT NULL, "occurredMonth" character varying(7) NOT NULL, "accessCount" integer NOT NULL, "dailyUniqueVisitorCount" integer NOT NULL, CONSTRAINT "PK_5e35caf2b100487fa5401686605" PRIMARY KEY ("linkId", "occurredMonth"))`);
        await queryRunner.query(`CREATE TABLE "link_daily_visitors" ("linkId" uuid NOT NULL, "occurredOn" date NOT NULL, "visitorPseudonym" character varying(64) NOT NULL, "country" character varying(7) NOT NULL, CONSTRAINT "PK_4f4feecda7bcb6932b9239239b8" PRIMARY KEY ("linkId", "occurredOn", "visitorPseudonym"))`);
        await queryRunner.query(`CREATE TABLE "link_daily_aggregates" ("linkId" uuid NOT NULL, "occurredOn" date NOT NULL, "country" character varying(7) NOT NULL, "accessCount" integer NOT NULL, "uniqueVisitorCount" integer NOT NULL, CONSTRAINT "PK_2473ed3c5cdd51ec734c60cbb6f" PRIMARY KEY ("linkId", "occurredOn", "country"))`);
        await queryRunner.query(`CREATE TABLE "link_access_events" ("id" uuid NOT NULL, "linkId" uuid NOT NULL, "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL, "occurredOn" date NOT NULL, "country" character varying(7) NOT NULL, "visitorPseudonym" character varying(64) NOT NULL, CONSTRAINT "PK_72d581db424be18e518d8b99faa" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "link_statistics_days" ADD CONSTRAINT "FK_1167cd436a88853c9d4a412c409" FOREIGN KEY ("linkId") REFERENCES "links"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "link_monthly_aggregates" ADD CONSTRAINT "FK_9c645cb8c119a57d9337852f3b5" FOREIGN KEY ("linkId") REFERENCES "links"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "link_daily_visitors" ADD CONSTRAINT "FK_376f356b6439896fcb92e19052e" FOREIGN KEY ("linkId") REFERENCES "links"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "link_daily_aggregates" ADD CONSTRAINT "FK_e44bf11b4ac3c220d86f528c9a6" FOREIGN KEY ("linkId") REFERENCES "links"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "link_access_events" ADD CONSTRAINT "FK_c33b83fdf5c7442fbcb2dc0175f" FOREIGN KEY ("linkId") REFERENCES "links"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "link_access_events" DROP CONSTRAINT "FK_c33b83fdf5c7442fbcb2dc0175f"`);
        await queryRunner.query(`ALTER TABLE "link_daily_aggregates" DROP CONSTRAINT "FK_e44bf11b4ac3c220d86f528c9a6"`);
        await queryRunner.query(`ALTER TABLE "link_daily_visitors" DROP CONSTRAINT "FK_376f356b6439896fcb92e19052e"`);
        await queryRunner.query(`ALTER TABLE "link_monthly_aggregates" DROP CONSTRAINT "FK_9c645cb8c119a57d9337852f3b5"`);
        await queryRunner.query(`ALTER TABLE "link_statistics_days" DROP CONSTRAINT "FK_1167cd436a88853c9d4a412c409"`);
        await queryRunner.query(`DROP TABLE "link_access_events"`);
        await queryRunner.query(`DROP TABLE "link_daily_aggregates"`);
        await queryRunner.query(`DROP TABLE "link_daily_visitors"`);
        await queryRunner.query(`DROP TABLE "link_monthly_aggregates"`);
        await queryRunner.query(`DROP TABLE "link_statistics_days"`);
    }

}
