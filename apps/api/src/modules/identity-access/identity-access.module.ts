import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { createDatabaseClient } from "@pw/database";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { AuthService } from "./application/auth.service.js";
import { PrismaAuthRepository } from "./infrastructure/auth.repository.js";
import { TokenService } from "./infrastructure/tokens.js";
import { AuthController } from "./interface/auth.controller.js";
import { MeController } from "./interface/me.controller.js";

export const AUTH_DB_CLIENT = "AUTH_DB_CLIENT";

@Module({
  controllers: [AuthController, MeController],
  providers: [
    {
      provide: AUTH_DB_CLIENT,
      useFactory: () => {
        const url = process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL;
        if (!url) throw new Error("PLATFORM_DATABASE_URL/DATABASE_URL is not configured");
        return createDatabaseClient(url);
      }
    },
    {
      provide: TokenService,
      useFactory: () => {
        const secret = process.env.SESSION_SECRET;
        if (!secret) throw new Error("SESSION_SECRET is not configured");
        return new TokenService(secret);
      }
    },
    {
      provide: PrismaAuthRepository,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) => new PrismaAuthRepository(client),
      inject: [AUTH_DB_CLIENT]
    },
    {
      provide: AuthService,
      useFactory: (repo: PrismaAuthRepository, tokens: TokenService) => new AuthService(repo, tokens),
      inject: [PrismaAuthRepository, TokenService]
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard
    }
  ],
  exports: [AuthService]
})
export class IdentityAccessModule {}
