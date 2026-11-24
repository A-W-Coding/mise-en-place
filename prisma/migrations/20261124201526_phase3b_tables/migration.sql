-- Phase 3b's tables and columns (spec §2.3; plan Step 20). Additive only: nothing
-- is dropped. Recipe.instructions stays until the next migration has moved it into
-- steps and the result has been checked on the Pi (Step 26, spec §7.2).

-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "primaryImageId" TEXT;

-- AlterTable
ALTER TABLE "RecipeIngredient" ADD COLUMN     "sectionId" TEXT;

-- CreateTable
CREATE TABLE "RecipeSection" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,

    CONSTRAINT "RecipeSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Instruction" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "timerSeconds" INTEGER,

    CONSTRAINT "Instruction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Image" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeTag" (
    "recipeId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,

    CONSTRAINT "RecipeTag_pkey" PRIMARY KEY ("recipeId","tagId")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeEquipment" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "optional" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RecipeEquipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecipeSection_recipeId_idx" ON "RecipeSection"("recipeId");

-- CreateIndex
CREATE INDEX "Instruction_sectionId_idx" ON "Instruction"("sectionId");

-- CreateIndex
CREATE INDEX "Image_recipeId_idx" ON "Image"("recipeId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "tag_name_trgm_idx" ON "Tag" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "RecipeTag_tagId_idx" ON "RecipeTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_name_key" ON "Equipment"("name");

-- CreateIndex
CREATE INDEX "equipment_name_trgm_idx" ON "Equipment" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "RecipeEquipment_recipeId_idx" ON "RecipeEquipment"("recipeId");

-- CreateIndex
CREATE INDEX "RecipeEquipment_equipmentId_idx" ON "RecipeEquipment"("equipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_primaryImageId_key" ON "Recipe"("primaryImageId");

-- CreateIndex
CREATE INDEX "RecipeIngredient_sectionId_idx" ON "RecipeIngredient"("sectionId");

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_primaryImageId_fkey" FOREIGN KEY ("primaryImageId") REFERENCES "Image"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeSection" ADD CONSTRAINT "RecipeSection_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instruction" ADD CONSTRAINT "Instruction_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "RecipeSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Image" ADD CONSTRAINT "Image_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeTag" ADD CONSTRAINT "RecipeTag_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeTag" ADD CONSTRAINT "RecipeTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeEquipment" ADD CONSTRAINT "RecipeEquipment_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeEquipment" ADD CONSTRAINT "RecipeEquipment_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "RecipeSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

