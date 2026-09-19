const { Prisma } = require('@prisma/client');
const { serializePayment } = require('./payment.serializers');

function formatDate(value) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function calculateInvoiceAmounts(invoice) {
  const paidAmount = (invoice.payments || [])
    .filter((payment) => payment.active)
    .reduce((total, payment) => total.plus(payment.amount), new Prisma.Decimal(0));
  const difference = invoice.subtotal.minus(paidAmount);
  return {
    paidAmount,
    outstandingAmount: difference.gt(0) ? difference : new Prisma.Decimal(0),
  };
}

function getEffectiveStatus(invoice, outstandingAmount) {
  if (invoice.status === 'DRAFT' || invoice.status === 'CANCELLED') return invoice.status;
  if (outstandingAmount.eq(0)) return 'PAID';
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (invoice.dueDate && invoice.dueDate < todayUtc) return 'OVERDUE';
  return 'PENDING';
}

function serializeWorkLogLink(link) {
  const workLog = link.workLog;
  return {
    id: workLog.id,
    contractId: workLog.contractId,
    workDate: formatDate(workLog.workDate),
    hours: workLog.hours.toString(),
    isOvertime: workLog.isOvertime,
    note: workLog.note,
    active: workLog.active,
  };
}

function serializeInvoice(invoice) {
  const { paidAmount, outstandingAmount } = calculateInvoiceAmounts(invoice);
  return {
    id: invoice.id,
    clientId: invoice.clientId,
    contractId: invoice.contractId,
    number: invoice.number,
    periodFrom: formatDate(invoice.periodFrom),
    periodTo: formatDate(invoice.periodTo),
    currency: invoice.currency,
    subtotal: invoice.subtotal.toString(),
    paidAmount: paidAmount.toString(),
    outstandingAmount: outstandingAmount.toString(),
    status: invoice.status,
    effectiveStatus: getEffectiveStatus(invoice, outstandingAmount),
    issuedAt: formatDate(invoice.issuedAt),
    dueDate: formatDate(invoice.dueDate),
    note: invoice.note,
    active: invoice.active,
    deletedAt: invoice.deletedAt,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
    client: invoice.client,
    contract: invoice.contract,
    workLogs: (invoice.workLogs || []).map(serializeWorkLogLink),
    payments: (invoice.payments || []).filter((payment) => payment.active).map(serializePayment),
  };
}

module.exports = { calculateInvoiceAmounts, getEffectiveStatus, serializeInvoice };
