-- Optional instance-wide login alias for UserProfile (case-insensitive unique).
ALTER TABLE "user_profile" ADD COLUMN "username" TEXT;
CREATE UNIQUE INDEX "user_profile_username_lower_key" ON "user_profile" (lower("username"));
