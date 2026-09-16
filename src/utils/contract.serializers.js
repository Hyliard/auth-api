function serializeDate(value) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function serializeContract(contract) {
  return {
    id: contract.id,
    clientId: contract.clientId,
    name: contract.name,
    hourlyRate: contract.hourlyRate.toString(),
    currency: contract.currency,
    overtimeRate: contract.overtimeRate?.toString() ?? null,
    active: contract.active,
    startDate: serializeDate(contract.startDate),
    endDate: serializeDate(contract.endDate),
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt,
    client: contract.client,
  };
}

module.exports = { serializeContract };
