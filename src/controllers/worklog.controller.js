const { AppError } = require('../utils/errors');
const { validateUuid } = require('../utils/validators');
const {
  validateWorkLogCreate,
  validateWorkLogPatch,
  validateWorkLogFilters,
} = require('../utils/worklog.validators');
const { serializeWorkLog } = require('../utils/worklog.serializers');
const store = require('../store/db.store');

async function requireOwnedContract(userId, contractId, requireActive = false) {
  const contract = await store.findContractById(userId, contractId);
  if (!contract) throw new AppError('Contrato no encontrado', 404);
  if (requireActive && !contract.active) {
    throw new AppError('No se puede usar un contrato archivado', 409);
  }
  return contract;
}

async function createWorkLog(req, res, next) {
  try {
    const data = validateWorkLogCreate(req.body);
    await requireOwnedContract(req.auth.userId, data.contractId, true);
    const workLog = await store.createWorkLog({ userId: req.auth.userId, ...data });
    res.status(201).json({ workLog: serializeWorkLog(workLog) });
  } catch (err) { next(err); }
}

async function listWorkLogs(req, res, next) {
  try {
    const filters = validateWorkLogFilters(req.query);
    if (filters.contractId) await requireOwnedContract(req.auth.userId, filters.contractId);
    const workLogs = await store.getWorkLogsByUser(req.auth.userId, filters);
    res.status(200).json({ workLogs: workLogs.map(serializeWorkLog) });
  } catch (err) { next(err); }
}

async function getWorkLog(req, res, next) {
  try {
    const workLogId = validateUuid(req.params.workLogId, 'workLogId');
    const workLog = await store.findWorkLogById(req.auth.userId, workLogId);
    if (!workLog) throw new AppError('Registro de trabajo no encontrado', 404);
    res.status(200).json({ workLog: serializeWorkLog(workLog) });
  } catch (err) { next(err); }
}

async function updateWorkLog(req, res, next) {
  try {
    const workLogId = validateUuid(req.params.workLogId, 'workLogId');
    const existing = await store.findWorkLogById(req.auth.userId, workLogId);
    if (!existing) throw new AppError('Registro de trabajo no encontrado', 404);
    const data = validateWorkLogPatch(req.body);
    if (Object.prototype.hasOwnProperty.call(data, 'contractId')) {
      await requireOwnedContract(req.auth.userId, data.contractId, true);
    }
    if (data.active === true) data.deletedAt = null;
    if (data.active === false && existing.active) data.deletedAt = new Date();
    const workLog = await store.updateWorkLog(req.auth.userId, workLogId, data);
    if (!workLog) throw new AppError('Registro de trabajo no encontrado', 404);
    res.status(200).json({ workLog: serializeWorkLog(workLog) });
  } catch (err) { next(err); }
}

async function archiveWorkLog(req, res, next) {
  try {
    const workLogId = validateUuid(req.params.workLogId, 'workLogId');
    const existing = await store.findWorkLogById(req.auth.userId, workLogId);
    if (!existing) throw new AppError('Registro de trabajo no encontrado', 404);
    const workLog = existing.active
      ? await store.updateWorkLog(req.auth.userId, workLogId, { active: false, deletedAt: new Date() })
      : existing;
    res.status(200).json({ workLog: serializeWorkLog(workLog) });
  } catch (err) { next(err); }
}

module.exports = { createWorkLog, listWorkLogs, getWorkLog, updateWorkLog, archiveWorkLog };
