-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'PENDING', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "contractId" UUID,
    "number" TEXT,
    "periodFrom" DATE,
    "periodTo" DATE,
    "currency" TEXT NOT NULL,
    "subtotal" DECIMAL(65,30) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "issuedAt" DATE,
    "dueDate" DATE,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceWorkLog" (
    "invoiceId" UUID NOT NULL,
    "workLogId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceWorkLog_pkey" PRIMARY KEY ("invoiceId","workLogId")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "paidAt" DATE NOT NULL,
    "method" TEXT,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Invoice_userId_idx" ON "Invoice"("userId");
CREATE INDEX "Invoice_clientId_idx" ON "Invoice"("clientId");
CREATE INDEX "Invoice_contractId_idx" ON "Invoice"("contractId");
CREATE INDEX "Invoice_userId_clientId_idx" ON "Invoice"("userId", "clientId");
CREATE INDEX "Invoice_userId_status_idx" ON "Invoice"("userId", "status");
CREATE INDEX "Invoice_userId_dueDate_idx" ON "Invoice"("userId", "dueDate");
CREATE UNIQUE INDEX "InvoiceWorkLog_workLogId_key" ON "InvoiceWorkLog"("workLogId");
CREATE INDEX "InvoiceWorkLog_invoiceId_idx" ON "InvoiceWorkLog"("invoiceId");
CREATE INDEX "InvoiceWorkLog_workLogId_idx" ON "InvoiceWorkLog"("workLogId");
CREATE INDEX "Payment_userId_idx" ON "Payment"("userId");
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");
CREATE INDEX "Payment_clientId_idx" ON "Payment"("clientId");
CREATE INDEX "Payment_userId_paidAt_idx" ON "Payment"("userId", "paidAt");

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceWorkLog" ADD CONSTRAINT "InvoiceWorkLog_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceWorkLog" ADD CONSTRAINT "InvoiceWorkLog_workLogId_fkey" FOREIGN KEY ("workLogId") REFERENCES "WorkLog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
