-- AlterTable
ALTER TABLE "inv_item_file" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "inv_item_file" ADD COLUMN "is_cover" BOOLEAN NOT NULL DEFAULT false;
