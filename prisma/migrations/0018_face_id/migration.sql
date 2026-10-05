-- CreateTable
CREATE TABLE "FaceTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "tag" BYTEA NOT NULL,
    "samples" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FaceTemplate_userId_keyId_key" ON "FaceTemplate"("userId", "keyId");

-- AddForeignKey
ALTER TABLE "FaceTemplate" ADD CONSTRAINT "FaceTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

