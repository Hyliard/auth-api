const prisma = require('./prisma');
const { Prisma } = require('@prisma/client');
const { createHash } = require('node:crypto');
const { AppError } = require('../utils/errors');

function avatarVersion(filename) {
  return createHash('sha256').update(filename).digest('hex').slice(0, 16);
}

function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    avatarUrl: user.avatarFilename
      ? `/api/users/me/avatar?v=${avatarVersion(user.avatarFilename)}`
      : null,
  };
}

async function createUser({ name, email, passwordHash }) {
  try {
    return await prisma.user.create({ data: { name, email, passwordHash } });
  } catch (err) {
    // This operation writes User only. Match the email constraint, not every P2002.
    if (err.code === 'P2002' && Array.isArray(err.meta?.target)
        && err.meta.target.length === 1 && err.meta.target[0] === 'email') {
      throw new AppError('Ya existe un usuario registrado con ese email', 409);
    }
    throw err;
  }
}

function findUserByEmail(email) {
  return prisma.user.findUnique({ where: { email } });
}

function findUserById(id) {
  return prisma.user.findUnique({ where: { id } });
}

async function lockCredentials(tx, userId, expectedPasswordHash) {
  // Parameterized SQL: credential writers and session creators share this row lock.
  // READ COMMITTED returns the current hash after a preceding writer commits.
  const users = await tx.$queryRaw`
    SELECT "passwordHash" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE
  `;
  if (users.length !== 1 || users[0].passwordHash !== expectedPasswordHash) {
    throw new AppError('Las credenciales cambiaron. Inicia sesion nuevamente.', 401);
  }
}

function createLoginSession({ userId, expectedPasswordHash, deviceName, lastLoginAt }) {
  return prisma.$transaction(async (tx) => {
    await lockCredentials(tx, userId, expectedPasswordHash);
    const device = await tx.device.create({ data: { userId, deviceName, lastLoginAt } });
    const session = await tx.session.create({ data: { userId, deviceId: device.deviceId } });
    return { device, session };
  }, { isolationLevel: 'ReadCommitted' });
}

function changePasswordAndRevokeSessions(userId, expectedPasswordHash, passwordHash) {
  return prisma.$transaction(async (tx) => {
    await lockCredentials(tx, userId, expectedPasswordHash);
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await tx.session.updateMany({ where: { userId }, data: { revoked: true } });
  }, { isolationLevel: 'ReadCommitted' });
}

function findSessionById(sessionId) {
  return prisma.session.findUnique({ where: { sessionId } });
}

function findDeviceById(deviceId) {
  return prisma.device.findUnique({ where: { deviceId } });
}

function getDevicesByUser(userId) {
  return prisma.device.findMany({ where: { userId } });
}

function revokeSession(sessionId) {
  return prisma.session.updateMany({ where: { sessionId }, data: { revoked: true } });
}

function revokeSessionsByUser(userId) {
  return prisma.session.updateMany({ where: { userId }, data: { revoked: true } });
}

function revokeSessionsByDevice(deviceId) {
  return prisma.session.updateMany({ where: { deviceId }, data: { revoked: true } });
}

function deleteDevice(deviceId) {
  return prisma.device.delete({ where: { deviceId } });
}

function deleteUser(id) {
  return prisma.$transaction(async (tx) => {
    await tx.invoiceWorkLog.deleteMany({
      where: { OR: [{ invoice: { userId: id } }, { workLog: { userId: id } }] },
    });
    return tx.user.delete({ where: { id } });
  });
}

function replaceUserAvatar(userId, avatarFilename) {
  return prisma.$transaction(async (tx) => {
    const users = await tx.$queryRaw`
      SELECT "avatarFilename" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE
    `;
    if (users.length !== 1) return null;
    const user = await tx.user.update({ where: { id: userId }, data: { avatarFilename } });
    return { user, previousAvatarFilename: users[0].avatarFilename };
  }, { isolationLevel: 'ReadCommitted' });
}

function createClient({ userId, name, email, company }) {
  return prisma.client.create({
    data: {
      userId,
      name,
      email,
      company,
    },
  });
}

function getClientsByUser(userId, includeInactive = false) {
  return prisma.client.findMany({
    where: {
      userId,
      ...(includeInactive ? {} : { active: true }),
    },
    orderBy: { createdAt: 'desc' },
  });
}

function findClientById(userId, clientId) {
  return prisma.client.findFirst({ where: { id: clientId, userId } });
}

async function updateClient(userId, clientId, data) {
  const result = await prisma.client.updateMany({
    where: { id: clientId, userId },
    data,
  });

  if (result.count === 0) {
    return null;
  }

  return findClientById(userId, clientId);
}

const contractClientSelect = { id: true, name: true, company: true };

function createContract({ userId, clientId, name, hourlyRate, currency, overtimeRate, startDate, endDate }) {
  return prisma.contract.create({
    data: { userId, clientId, name, hourlyRate, currency, overtimeRate, startDate, endDate },
    include: { client: { select: contractClientSelect } },
  });
}

function getContractsByUser(userId, { includeInactive = false, clientId } = {}) {
  return prisma.contract.findMany({
    where: {
      userId,
      ...(includeInactive ? {} : { active: true }),
      ...(clientId ? { clientId } : {}),
    },
    include: { client: { select: contractClientSelect } },
    orderBy: { createdAt: 'desc' },
  });
}

function findContractById(userId, contractId) {
  return prisma.contract.findFirst({
    where: { id: contractId, userId },
    include: { client: { select: contractClientSelect } },
  });
}

async function updateContract(userId, contractId, data) {
  const result = await prisma.contract.updateMany({
    where: { id: contractId, userId },
    data,
  });
  if (result.count === 0) return null;
  return findContractById(userId, contractId);
}

const workLogContractSelect = {
  id: true,
  name: true,
  hourlyRate: true,
  currency: true,
  client: { select: contractClientSelect },
};

function createWorkLog({ userId, contractId, workDate, hours, isOvertime, note }) {
  return prisma.workLog.create({
    data: {
      userId,
      contractId,
      workDate,
      hours,
      ...(isOvertime !== undefined ? { isOvertime } : {}),
      ...(note !== undefined ? { note } : {}),
    },
    include: { contract: { select: workLogContractSelect } },
  });
}

function getWorkLogsByUser(userId, {
  includeInactive = false, contractId, from, to, isOvertime,
} = {}) {
  return prisma.workLog.findMany({
    where: {
      userId,
      ...(includeInactive ? {} : { active: true }),
      ...(contractId ? { contractId } : {}),
      ...((from || to) ? {
        workDate: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        },
      } : {}),
      ...(isOvertime !== undefined ? { isOvertime } : {}),
    },
    include: { contract: { select: workLogContractSelect } },
    orderBy: [{ workDate: 'desc' }, { createdAt: 'desc' }],
  });
}

function findWorkLogById(userId, workLogId) {
  return prisma.workLog.findFirst({
    where: { id: workLogId, userId },
    include: { contract: { select: workLogContractSelect } },
  });
}

async function updateWorkLog(userId, workLogId, data) {
  const result = await prisma.workLog.updateMany({
    where: { id: workLogId, userId },
    data,
  });
  if (result.count === 0) return null;
  return findWorkLogById(userId, workLogId);
}

const invoiceInclude = {
  client: { select: contractClientSelect },
  contract: { select: { id: true, name: true } },
  workLogs: {
    include: {
      workLog: {
        select: {
          id: true, contractId: true, workDate: true, hours: true,
          isOvertime: true, note: true, active: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
  payments: { where: { active: true }, orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }] },
};

const paymentInclude = {
  client: { select: contractClientSelect },
  invoice: { select: { id: true, number: true, subtotal: true, currency: true, status: true } },
};

function findInvoiceByIdWith(client, userId, invoiceId) {
  return client.invoice.findFirst({ where: { id: invoiceId, userId }, include: invoiceInclude });
}

function findPaymentByIdWith(client, userId, paymentId) {
  return client.payment.findFirst({ where: { id: paymentId, userId }, include: paymentInclude });
}

function findInvoiceWorkLogs(userId, workLogIds) {
  if (!workLogIds.length) return Promise.resolve([]);
  return prisma.workLog.findMany({
    where: { userId, id: { in: workLogIds } },
    include: {
      contract: { select: { id: true, clientId: true, currency: true, active: true } },
      invoiceLink: { select: { invoiceId: true } },
    },
  });
}

async function createInvoice({ userId, workLogIds = [], ...data }) {
  try {
    return await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({ data: { userId, ...data } });
      if (workLogIds.length) {
        await tx.invoiceWorkLog.createMany({
          data: workLogIds.map((workLogId) => ({ invoiceId: invoice.id, workLogId })),
        });
      }
      return findInvoiceByIdWith(tx, userId, invoice.id);
    });
  } catch (err) {
    if (err.code === 'P2002') throw new AppError('Uno o mas WorkLogs ya fueron facturados', 409);
    throw err;
  }
}

function getInvoicesByUser(userId, {
  includeInactive = false, clientId, contractId, status, from, to,
} = {}) {
  return prisma.invoice.findMany({
    where: {
      userId,
      ...(includeInactive ? {} : { active: true }),
      ...(clientId ? { clientId } : {}),
      ...(contractId ? { contractId } : {}),
      ...(status ? { status } : {}),
      ...((from || to) ? { issuedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    },
    include: invoiceInclude,
    orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
  });
}

function findInvoiceById(userId, invoiceId) {
  return findInvoiceByIdWith(prisma, userId, invoiceId);
}

async function lockInvoice(tx, userId, invoiceId) {
  const rows = await tx.$queryRaw`
    SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId}::uuid AND "userId" = ${userId}::uuid FOR UPDATE
  `;
  if (rows.length !== 1) throw new AppError('Invoice no encontrada', 404);
}

async function activePaymentTotal(tx, invoiceId, excludedPaymentId) {
  const result = await tx.payment.aggregate({
    where: {
      invoiceId,
      active: true,
      ...(excludedPaymentId ? { id: { not: excludedPaymentId } } : {}),
    },
    _sum: { amount: true },
  });
  return result._sum.amount || new Prisma.Decimal(0);
}

function synchronizedInvoiceStatus(currentStatus, paidAmount, subtotal) {
  if (currentStatus === 'DRAFT' || currentStatus === 'CANCELLED') return currentStatus;
  return paidAmount.eq(subtotal) ? 'PAID' : 'PENDING';
}

async function updateInvoice(userId, invoiceId, { workLogIds, ...data }) {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockInvoice(tx, userId, invoiceId);
      const current = await tx.invoice.findUnique({ where: { id: invoiceId } });
      const allPayments = await tx.payment.count({ where: { invoiceId } });
      const paidAmount = await activePaymentTotal(tx, invoiceId);
      const finalSubtotal = data.subtotal || current.subtotal;
      if (data.currency && data.currency !== current.currency && allPayments > 0) {
        throw new AppError('No se puede cambiar la moneda de una invoice con payments', 409);
      }
      if (finalSubtotal.lt(paidAmount)) {
        throw new AppError('El subtotal no puede ser menor que el monto ya pagado', 409);
      }
      if (data.status === 'PAID' && !paidAmount.eq(finalSubtotal)) {
        throw new AppError('La invoice solo puede marcarse PAID cuando esta completamente pagada', 409);
      }

      const requestedStatus = data.status || current.status;
      const finalStatus = synchronizedInvoiceStatus(requestedStatus, paidAmount, finalSubtotal);
      const updateData = {
        ...data,
        status: finalStatus,
        ...(data.active === true ? { deletedAt: null } : {}),
        ...(data.active === false && current.active ? { deletedAt: new Date() } : {}),
      };
      await tx.invoice.update({ where: { id: invoiceId }, data: updateData });
      if (workLogIds !== undefined) {
        await tx.invoiceWorkLog.deleteMany({ where: { invoiceId } });
        if (workLogIds.length) {
          await tx.invoiceWorkLog.createMany({
            data: workLogIds.map((workLogId) => ({ invoiceId, workLogId })),
          });
        }
      }
      return findInvoiceByIdWith(tx, userId, invoiceId);
    });
  } catch (err) {
    if (err.code === 'P2002') throw new AppError('Uno o mas WorkLogs ya fueron facturados', 409);
    throw err;
  }
}

function archiveInvoice(userId, invoiceId) {
  return prisma.$transaction(async (tx) => {
    await lockInvoice(tx, userId, invoiceId);
    const current = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (current.active) {
      await tx.invoice.update({ where: { id: invoiceId }, data: { active: false, deletedAt: new Date() } });
    }
    return findInvoiceByIdWith(tx, userId, invoiceId);
  });
}

async function syncInvoiceStatus(tx, invoice) {
  const paidAmount = await activePaymentTotal(tx, invoice.id);
  const status = synchronizedInvoiceStatus(invoice.status, paidAmount, invoice.subtotal);
  if (status !== invoice.status) await tx.invoice.update({ where: { id: invoice.id }, data: { status } });
}

function createPayment({ userId, invoiceId, amount, currency, paidAt, method, note }) {
  return prisma.$transaction(async (tx) => {
    await lockInvoice(tx, userId, invoiceId);
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice.active) throw new AppError('No se puede registrar un payment en una invoice archivada', 409);
    if (invoice.status === 'CANCELLED') throw new AppError('No se puede registrar un payment en una invoice cancelada', 409);
    if (currency !== invoice.currency) throw new AppError('La moneda del payment no coincide con la invoice', 409);
    const paidAmount = await activePaymentTotal(tx, invoiceId);
    if (paidAmount.plus(amount).gt(invoice.subtotal)) throw new AppError('El payment supera el saldo pendiente de la invoice', 409);
    const payment = await tx.payment.create({
      data: { userId, invoiceId, clientId: invoice.clientId, amount, currency, paidAt, method, note },
    });
    await syncInvoiceStatus(tx, invoice);
    return findPaymentByIdWith(tx, userId, payment.id);
  });
}

function getPaymentsByUser(userId, {
  includeInactive = false, invoiceId, clientId, from, to,
} = {}) {
  return prisma.payment.findMany({
    where: {
      userId,
      ...(includeInactive ? {} : { active: true }),
      ...(invoiceId ? { invoiceId } : {}),
      ...(clientId ? { clientId } : {}),
      ...((from || to) ? { paidAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    },
    include: paymentInclude,
    orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
  });
}

function findPaymentById(userId, paymentId) {
  return findPaymentByIdWith(prisma, userId, paymentId);
}

function updatePayment(userId, paymentId, data) {
  return prisma.$transaction(async (tx) => {
    let current = await tx.payment.findFirst({ where: { id: paymentId, userId } });
    if (!current) throw new AppError('Payment no encontrado', 404);
    await lockInvoice(tx, userId, current.invoiceId);
    current = await tx.payment.findFirst({ where: { id: paymentId, userId } });
    if (!current) throw new AppError('Payment no encontrado', 404);
    const invoice = await tx.invoice.findUnique({ where: { id: current.invoiceId } });
    const finalActive = data.active ?? current.active;
    const finalAmount = data.amount || current.amount;
    if (invoice.status === 'CANCELLED' && finalActive && (!current.active || data.amount)) {
      throw new AppError('No se puede reactivar o modificar un payment activo en una invoice cancelada', 409);
    }
    if (finalActive) {
      const otherPaid = await activePaymentTotal(tx, invoice.id, paymentId);
      if (otherPaid.plus(finalAmount).gt(invoice.subtotal)) throw new AppError('El payment supera el saldo pendiente de la invoice', 409);
    }
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        ...data,
        ...(data.active === true ? { deletedAt: null } : {}),
        ...(data.active === false && current.active ? { deletedAt: new Date() } : {}),
      },
    });
    await syncInvoiceStatus(tx, invoice);
    return findPaymentByIdWith(tx, userId, paymentId);
  });
}

function archivePayment(userId, paymentId) {
  return prisma.$transaction(async (tx) => {
    let current = await tx.payment.findFirst({ where: { id: paymentId, userId } });
    if (!current) throw new AppError('Payment no encontrado', 404);
    await lockInvoice(tx, userId, current.invoiceId);
    current = await tx.payment.findFirst({ where: { id: paymentId, userId } });
    if (!current) throw new AppError('Payment no encontrado', 404);
    const invoice = await tx.invoice.findUnique({ where: { id: current.invoiceId } });
    if (current.active) {
      await tx.payment.update({ where: { id: paymentId }, data: { active: false, deletedAt: new Date() } });
      await syncInvoiceStatus(tx, invoice);
    }
    return findPaymentByIdWith(tx, userId, paymentId);
  });
}

module.exports = {
  toPublicUser,
  createUser,
  findUserByEmail,
  findUserById,
  changePasswordAndRevokeSessions,
  createLoginSession,
  findSessionById,
  findDeviceById,
  getDevicesByUser,
  revokeSession,
  revokeSessionsByUser,
  revokeSessionsByDevice,
  deleteDevice,
  deleteUser,
  replaceUserAvatar,
  createClient,
  getClientsByUser,
  findClientById,
  updateClient,
  createContract,
  getContractsByUser,
  findContractById,
  updateContract,
  createWorkLog,
  getWorkLogsByUser,
  findWorkLogById,
  updateWorkLog,
  findInvoiceWorkLogs,
  createInvoice,
  getInvoicesByUser,
  findInvoiceById,
  updateInvoice,
  archiveInvoice,
  createPayment,
  getPaymentsByUser,
  findPaymentById,
  updatePayment,
  archivePayment,
};
