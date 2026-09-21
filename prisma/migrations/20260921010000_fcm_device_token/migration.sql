-- CreateTable
CREATE TABLE "fcm_device_token" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "company_id" UUID,
    "token" TEXT NOT NULL,
    "device_label" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fcm_device_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fcm_device_token_token_key" ON "fcm_device_token" ("token");

-- CreateIndex
CREATE INDEX "fcm_device_token_user_id_enabled_idx" ON "fcm_device_token" ("user_id", "enabled");

-- AddForeignKey
ALTER TABLE "fcm_device_token" ADD CONSTRAINT "fcm_device_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
