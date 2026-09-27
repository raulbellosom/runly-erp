export function columnKey(value) {
  return value == null ? '__NULL__' : `${typeof value}:${String(value)}`
}

export function moveKanbanRecord(board, recordId, groupBy, value) {
  if (!board?.records) return board
  return {
    ...board,
    records: board.records.map((record) => record.id === recordId ? { ...record, [groupBy]: value } : record),
  }
}

export function recordsForColumn(records, groupBy, value) {
  const key = columnKey(value)
  return (records ?? []).filter((record) => columnKey(record[groupBy]) === key)
}
