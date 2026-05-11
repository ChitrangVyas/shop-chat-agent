-- Create table for shop-level app settings
CREATE TABLE "ShopConfig" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopDomain" TEXT NOT NULL,
  "claudeApiKey" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Enforce one settings row per shop
CREATE UNIQUE INDEX "ShopConfig_shopDomain_key" ON "ShopConfig"("shopDomain");
CREATE INDEX "ShopConfig_shopDomain_idx" ON "ShopConfig"("shopDomain");
