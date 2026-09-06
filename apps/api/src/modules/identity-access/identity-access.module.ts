import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { createDatabaseClient } from "@pw/database";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { AuthService } from "./application/auth.service.js";
import { PrismaAuthRepository } from "./infrastructure/auth.repository.js";
import { TokenService } from "./infrastructure/tokens.js";
import { AuthController } from "./interface/auth.controller.js";
import { MeController } from "./interface/me.controller.js";
import { RateLimitService } from "../../common/auth/rate-limit.service.js";

export const AUTH_PLATFORM_CLIENT = "AUTH_PLATFORM_CLIENT";
export const AUTH_RUNTIME_CLIENT = "AUTH_RUNTIME_CLIENT";

@Module({
  controllers: [AuthController, MeController],
  providers: [
    {
      provide: AUTH_PLATFORM_CLIENT,
      useFactory: () => {
        const url = process.env.PLATFORM_DATABASE_URL;
        if (!url) throw new Error("PLATFORM_DATABASE_URL is not configured");
        return createDatabaseClient(url);
      }
    },
    {
      provide: AUTH_RUNTIME_CLIENT,
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("DATABASE_URL (runtime) is not configured");
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
      useFactory: (
        client: ReturnType<typeof createDatabaseClient>,
        runtimeClient: ReturnType<typeof createDatabaseClient>
      ) => new PrismaAuthRepository(client, runtimeClient),
      inject: [AUTH_PLATFORM_CLIENT, AUTH_RUNTIME_CLIENT]
    },
    {
      provide: AuthService,
      useFactory: (repo: PrismaAuthRepository, tokens: TokenService) => new AuthService(repo, tokens),
      inject: [PrismaAuthRepository, TokenService]
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard
    },
    RateLimitService
  ],
  exports: [AuthService, RateLimitService]
})
export class IdentityAccessModule {}