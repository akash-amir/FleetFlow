-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "deliveryFee" DROP NOT NULL;
ALTER TABLE "Order" ADD COLUMN     "createdByCustomerUserId" INTEGER;

-- AlterTable
ALTER TABLE "CustomerUserToken" ADD COLUMN     "invalidatedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdByCustomerUserId_fkey" FOREIGN KEY ("createdByCustomerUserId") REFERENCES "CustomerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
