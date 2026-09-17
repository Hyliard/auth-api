function serializeWorkLog(workLog) {
  return {
    id: workLog.id,
    contractId: workLog.contractId,
    workDate: workLog.workDate.toISOString().slice(0, 10),
    hours: workLog.hours.toString(),
    isOvertime: workLog.isOvertime,
    note: workLog.note,
    active: workLog.active,
    deletedAt: workLog.deletedAt,
    createdAt: workLog.createdAt,
    updatedAt: workLog.updatedAt,
    contract: {
      ...workLog.contract,
      hourlyRate: workLog.contract.hourlyRate.toString(),
    },
  };
}

module.exports = { serializeWorkLog };
