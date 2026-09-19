function formatDate(value) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function serializePayment(payment) {
  return {
    id: payment.id,
    invoiceId: payment.invoiceId,
    clientId: payment.clientId,
    amount: payment.amount.toString(),
    currency: payment.currency,
    paidAt: formatDate(payment.paidAt),
    method: payment.method,
    note: payment.note,
    active: payment.active,
    deletedAt: payment.deletedAt,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
    ...(payment.client ? { client: payment.client } : {}),
    ...(payment.invoice ? {
      invoice: {
        id: payment.invoice.id,
        number: payment.invoice.number,
        subtotal: payment.invoice.subtotal.toString(),
        currency: payment.invoice.currency,
        status: payment.invoice.status,
      },
    } : {}),
  };
}

module.exports = { serializePayment };
