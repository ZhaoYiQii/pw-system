import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { NotificationsController } from "./notifications.controller.js";
import { NOTIFY_DB_CLIENT } from "./tokens.js";


@Module({
  controllers: [NotificationsController],
  providers: [
    {
      provide: NOTIFY_DB_CLIENT,
      useFactory: () => {
        const url = process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL;
        if (!url) throw new Error("db url missing");
        return createDatabaseClient(url);
      }
    }
  ]
})
export class NotificationsModule {}