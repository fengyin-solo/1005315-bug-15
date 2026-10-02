import { MODULE_BY_KEY } from '@/data/modules'
import { listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, CreateResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

function statusIndex(meta: ModuleMeta, status: string): number {
  return meta.statuses.indexOf(status)
}

// 纯数字的输入按数字落库（如拼合片数），其余按字符串，避免同一字段两种类型。
function coerceValue(value: string | number): string | number {
  if (typeof value === 'number') {
    return value
  }
  const text = value.trim()
  return /^\d+$/.test(text) ? Number(text) : text
}

function settledStatuses(meta: ModuleMeta): string[] {
  return meta.lockStatuses ?? [meta.statuses[meta.statuses.length - 1]]
}

// 同一业务编号只留一条：重复提交的记录按已有记录处理，保留环节走得更远的
// 那条（沿用历史上的结论），其余视为重复数据清掉，清单里不再重复显示。
function normalizeRows(meta: ModuleMeta, rows: EntryRow[]): { rows: EntryRow[]; changed: boolean } {
  const field = meta.uniqueField
  if (!field) {
    return { rows, changed: false }
  }
  const kept = new Map<string, EntryRow>()
  const result: EntryRow[] = []
  let changed = false
  for (const row of rows) {
    const number = String(row[field] ?? '').trim()
    const existing = number === '' ? undefined : kept.get(number)
    if (!existing) {
      if (number !== '') {
        kept.set(number, row)
      }
      result.push(row)
      continue
    }
    changed = true
    if (statusIndex(meta, String(row.status)) > statusIndex(meta, String(existing.status))) {
      kept.set(number, row)
      result[result.indexOf(existing)] = row
    }
  }
  return { rows: result, changed }
}

// 读入口统一走这里：先按业务编号去重再返回，多处入口看到的都是同一份编号数据。
function loadRows(key: string): EntryRow[] {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const normalized = normalizeRows(meta, rows)
  if (normalized.changed) {
    saveRows(key, normalized.rows)
  }
  return normalized.rows
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(loadRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    if (meta.sequentialFlow) {
      // 幂等：同一动作重复提交按已有记录处理，不改环节也不新增
      return { ok: true, message: `${meta.entity}已处于「${target}」，本次按已有记录处理，未重复变更` }
    }
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  if (meta.sequentialFlow) {
    const currentIdx = statusIndex(meta, current)
    const targetIdx = statusIndex(meta, target)
    if (targetIdx < 0) {
      return { ok: false, message: `「${target}」不在${meta.entity}的流转环节里` }
    }
    if (targetIdx <= currentIdx) {
      return { ok: false, message: `${meta.entity}只能顺次流转，不能从「${current}」回到「${target}」` }
    }
  }
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: !settledStatuses(meta).includes(target),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  writeBackIfSettled(meta, updated, target)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 登记：同一业务编号重复提交时按已有记录处理，不改环节也不新增。
export function createEntry(key: string, fields: Record<string, string | number>): CreateResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const uniqueField = meta.uniqueField
  const number = uniqueField ? String(fields[uniqueField] ?? '').trim() : ''
  if (uniqueField && number === '') {
    return { ok: false, created: false, message: `${uniqueField}不能为空` }
  }
  if (uniqueField) {
    const existing = rows.find((row) => String(row[uniqueField] ?? '').trim() === number)
    if (existing) {
      return {
        ok: true,
        created: false,
        id: Number(existing.id),
        message: `${uniqueField}「${number}」已存在（当前「${existing.status}」），按已有记录处理，未新增`,
      }
    }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const initial = meta.statuses[0] ?? ''
  const row: EntryRow = {
    id,
    status: initial,
    pending: !settledStatuses(meta).includes(initial),
    abnormal: false,
  }
  for (const field of meta.fields) {
    const value = fields[field]
    row[field] = value === undefined || value === null ? '' : coerceValue(value)
  }
  saveRows(key, [...rows, row])
  return {
    ok: true,
    created: true,
    id,
    message: `${meta.entity}已登记${number ? `，编号「${number}」` : ''}，当前状态「${initial}」`,
  }
}

// 更新字段：写穿到本地库；进入锁定状态（已复原/已放弃）的记录按当时的结论保留，不再改动。
export function updateEntry(key: string, id: number, fields: Record<string, string | number>): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = rows[index]
  if (settledStatuses(meta).includes(String(current.status))) {
    return { ok: false, message: `${meta.entity}已${current.status}，按当时的结论保留，不能再改动` }
  }
  const uniqueField = meta.uniqueField
  if (uniqueField && uniqueField in fields) {
    const number = String(fields[uniqueField] ?? '').trim()
    const clash = number !== '' && rows.some((row, i) => i !== index && String(row[uniqueField] ?? '').trim() === number)
    if (clash) {
      return { ok: false, message: `${uniqueField}「${number}」已被另一条${meta.entity}使用` }
    }
  }
  const updated: EntryRow = { ...current }
  for (const field of meta.fields) {
    if (!(field in fields)) {
      continue
    }
    const value = fields[field]
    updated[field] = value === undefined || value === null ? '' : coerceValue(value)
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已更新并落库` }
}

// 顺次流转的模块只暴露还能往前走的动作，页面上就不会出现往回走的入口。
export function availableActions(key: string, row: EntryRow): string[] {
  const meta = moduleMeta(key)
  if (!meta.sequentialFlow) {
    return meta.actions
  }
  const currentIdx = statusIndex(meta, String(row.status))
  return meta.actions.filter((action) => statusIndex(meta, meta.actionTargets[action] ?? '') > currentIdx)
}

// 处置结论回写：进入锁定状态时，把结论写进关联台账（出土物登记）的同一份编号数据上。
function writeBackIfSettled(meta: ModuleMeta, row: EntryRow, target: string): void {
  const rule = meta.writeBack
  if (!rule || !settledStatuses(meta).includes(target)) {
    return
  }
  const conclusion = String(row[rule.field] ?? '').trim() || target
  const ledger = listRows(rule.module)
  let touched = false
  const nextLedger = ledger.map((entry) => {
    const linked = rule.links.some(([from, to]) => {
      const left = String(row[from] ?? '').trim()
      return left !== '' && left === String(entry[to] ?? '').trim()
    })
    if (!linked) {
      return entry
    }
    touched = true
    return { ...entry, [rule.field]: conclusion }
  })
  if (touched) {
    saveRows(rule.module, nextLedger)
  }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of loadRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = loadRows(meta.key)
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
