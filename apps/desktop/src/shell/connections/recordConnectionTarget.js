// Maps the record a screen publishes through useMiraiRecordContext to a
// connection target (spec 2026-10-03-rme3-module-platform-v2 §5 goal 6), and
// tracks whether the screen already renders its own connection slot so the
// shell-level "Conexiones" button only shows where nothing else does.
import { useEffect, useSyncExternalStore } from 'react'

const TARGETS = {
  'runly.inventory:item': 'inventory_item',
  'runly.contacts:contact': 'contact',
  'runly.hr:employee': 'hr_employee',
  'runly.projects:project': 'project',
}

export function recordConnectionTarget(moduleKey, record) {
  if (!moduleKey || !record?.recordId || !record.recordType) return null
  const targetType = TARGETS[`${moduleKey}:${record.recordType}`]
  return targetType ? { targetType, targetId: String(record.recordId) } : null
}

let mountedSlots = 0
const listeners = new Set()
const emit = () => listeners.forEach((l) => l())

// Called by in-screen ConnectionSections; hides the shell button while mounted.
export function useRegisterConnectionSlot(enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined
    mountedSlots += 1
    emit()
    return () => { mountedSlots -= 1; emit() }
  }, [enabled])
}

export function useHasConnectionSlot() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l) },
    () => mountedSlots > 0,
    () => false,
  )
}
