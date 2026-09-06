import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { NotificationsController } from "./notifications.controller.js";
import { NOTIFY_DB_CLIENT } from "./tokens.js";
import { CustomersModule } from "../customers/customers.module.js";
import { PlayersModule } from "../players/players.module.js";


@Module({
  imports: [CustomersModule, PlayersModule],
  controllers: [NotificationsController],
  providers: [
    {
      provide: NOTIFY_DB_CLIENT,
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("db url missing");
        return createDatabaseClient(url);
      }
    }
  ]
})
export class NotificationsModule {}
