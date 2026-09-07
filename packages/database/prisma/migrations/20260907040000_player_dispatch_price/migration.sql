-- Block1：陪玩基础小时价（分/小时），用于游戏派单计价。
ALTER TABLE "player_profiles"
  ADD COLUMN "base_price_per_hour_fen" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "player_profiles"
  ADD CONSTRAINT "player_profiles_base_price_non_negative"
  CHECK ("base_price_per_hour_fen" >= 0);
