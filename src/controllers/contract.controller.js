const { AppError } = require('../utils/errors');
const { validateUuid } = require('../utils/validators');
const {
  validateContractCreate,
  validateContractPatch,
  validateDateRange,
  validateIncludeInactive,
} = require('../utils/contract.validators');
const { serializeContract } = require('../utils/contract.serializers');
const store = require('../store/db.store');

async function requireOwnedClient(userId, clientId, requireActive = false) {
  const client = await store.findClientById(userId, clientId);
  if (!client) {
    throw new AppError('Cliente no encontrado', 404);
  }
  if (requireActive && !client.active) {
    throw new AppError('No se puede usar un cliente archivado', 409);
  }
  return client;
}

async function createContract(req, res, next) {
  try {
    const data = validateContractCreate(req.body);
    await requireOwnedClient(req.auth.userId, data.clientId, true);
    const contract = await store.createContract({ userId: req.auth.userId, ...data });
    res.status(201).json({ contract: serializeContract(contract) });
  } catch (err) {
    next(err);
  }
}

async function listContracts(req, res, next) {
  try {
    const includeInactive = validateIncludeInactive(req.query.includeInactive);
    let clientId;
    if (req.query.clientId !== undefined) {
      clientId = validateUuid(req.query.clientId, 'clientId');
      await requireOwnedClient(req.auth.userId, clientId);
    }
    const contracts = await store.getContractsByUser(req.auth.userId, { includeInactive, clientId });
    res.status(200).json({ contracts: contracts.map(serializeContract) });
  } catch (err) {
    next(err);
  }
}

async function getContract(req, res, next) {
  try {
    const contractId = validateUuid(req.params.contractId, 'contractId');
    const contract = await store.findContractById(req.auth.userId, contractId);
    if (!contract) {
      throw new AppError('Contrato no encontrado', 404);
    }
    res.status(200).json({ contract: serializeContract(contract) });
  } catch (err) {
    next(err);
  }
}

async function updateContract(req, res, next) {
  try {
    const contractId = validateUuid(req.params.contractId, 'contractId');
    const contract = await store.findContractById(req.auth.userId, contractId);
    if (!contract) {
      throw new AppError('Contrato no encontrado', 404);
    }

    const data = validateContractPatch(req.body);
    if (Object.prototype.hasOwnProperty.call(data, 'clientId')) {
      await requireOwnedClient(req.auth.userId, data.clientId, true);
    }
    const finalStartDate = Object.prototype.hasOwnProperty.call(data, 'startDate')
      ? data.startDate : contract.startDate;
    const finalEndDate = Object.prototype.hasOwnProperty.call(data, 'endDate')
      ? data.endDate : contract.endDate;
    validateDateRange(finalStartDate, finalEndDate);

    const updated = await store.updateContract(req.auth.userId, contractId, data);
    if (!updated) {
      throw new AppError('Contrato no encontrado', 404);
    }
    res.status(200).json({ contract: serializeContract(updated) });
  } catch (err) {
    next(err);
  }
}

async function archiveContract(req, res, next) {
  try {
    const contractId = validateUuid(req.params.contractId, 'contractId');
    const contract = await store.updateContract(req.auth.userId, contractId, { active: false });
    if (!contract) {
      throw new AppError('Contrato no encontrado', 404);
    }
    res.status(200).json({ contract: serializeContract(contract) });
  } catch (err) {
    next(err);
  }
}

module.exports = { createContract, listContracts, getContract, updateContract, archiveContract };
