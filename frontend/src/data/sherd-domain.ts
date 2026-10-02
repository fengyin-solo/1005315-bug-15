import { listRows, saveRows } from './local-store'
import type { ActionResult, EntryRow } from './types'

// 陶片拼对领域服务：拼对编号全局唯一、状态只能顺次流转、动作幂等，处置结论回写出土物台账。
// 陶片拼对页与出土物登记页等多处入口都走这里，保证大家共用同一份拼对编号数据。

export const SHERD_KEY = 'sherd'
export const FIND_KEY = 'find'

export const SHERD_STATUSES = ['待拼对', '拼对中', '已复原', '已放弃'] as const
const TERMINAL_STATUSES = new Set<string>(['已复原', '已放弃'])

// 同一条拼对编号残留多份记录时按推进进度选主：已复原代表历史结论，优先级最高，不允许被覆盖。
const STATUS_PROGRESS: Record<string, number> = {
  待拼对: 1,
  拼对中: 2,
  已放弃: 3,
  已复原: 4,
}

const TEXT_FIELDS = ['所属单位', '关联器物编号', '陶系', '纹饰', '可辨器型'] as const

export type SherdForm = {
  拼对编号: string
  所属单位: string
  关联器物编号: string
  陶系: string
  纹饰: string
  可辨器型: string
  拼合片数: string
  拼对结论: string
}

export type SherdActionResult = ActionResult & { duplicated?: boolean }

export function blankSherdForm(): SherdForm {
  return { 拼对编号: '', 所属单位: '', 关联器物编号: '', 陶系: '', 纹饰: '', 可辨器型: '', 拼合片数: '', 拼对结论: '' }
}

export function rowToSherdForm(row: EntryRow): SherdForm {
  return {
    拼对编号: String(row['拼对编号'] ?? ''),
    所属单位: String(row['所属单位'] ?? ''),
    关联器物编号: String(row['关联器物编号'] ?? ''),
    陶系: String(row['陶系'] ?? ''),
    纹饰: String(row['纹饰'] ?? ''),
    可辨器型: String(row['可辨器型'] ?? ''),
    拼合片数: String(row['拼合片数'] ?? ''),
    拼对结论: String(row['拼对结论'] ?? ''),
  }
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === '' || String(value) === '—'
}

function trimForm(input: SherdForm): SherdForm {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, String(value ?? '').trim()])) as SherdForm
}

function piecesValue(raw: string): string | number {
  return /^\d+$/.test(raw) ? Number(raw) : raw
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

// 统一收口拼对行的落库形态：页面状态字段（拼对状态）与环节状态保持一致，终态不再待处理。
function shapeRow(row: EntryRow): EntryRow {
  const status = (SHERD_STATUSES as readonly string[]).includes(String(row.status))
    ? String(row.status)
    : '待拼对'
  return {
    ...row,
    status,
    pending: !TERMINAL_STATUSES.has(status),
    abnormal: false,
    拼对状态: status,
  }
}

export function listSherd(filters: Record<string, string> = {}): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  const rows = listRows(SHERD_KEY)
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function sherdStatusCount(): Record<string, number> {
  const rows = listRows(SHERD_KEY)
  const count = (status: string) => rows.filter((row) => String(row.status) === status).length
  return {
    待拼对: count('待拼对'),
    拼对中: count('拼对中'),
    已复原: count('已复原'),
    已放弃: count('已放弃'),
  }
}

// 拼合片数只统计已复原器物，避免重复残行把数字对不上。
export function restoredPiecesTotal(): number {
  return listRows(SHERD_KEY)
    .filter((row) => String(row.status) === '已复原')
    .reduce((sum, row) => sum + (Number.parseInt(String(row['拼合片数'] ?? ''), 10) || 0), 0)
}

// 处置结论回写到出土物台账：按关联器物编号或拼对编号认领台账行；终态台账缺失时补登一条。
function syncLedger(sherd: EntryRow): void {
  const code = String(sherd['拼对编号'] ?? '').trim()
  if (!code) {
    return
  }
  const refCode = String(sherd['关联器物编号'] ?? '').trim()
  const status = String(sherd.status)
  const disposition =
    status === '已复原'
      ? `已复原（${isBlank(sherd['拼合片数']) ? '片数未登记' : `${sherd['拼合片数']}片`}，结论：${isBlank(sherd['拼对结论']) ? '可复原' : sherd['拼对结论']}）`
      : status === '已放弃'
        ? `已放弃（${isBlank(sherd['拼对结论']) ? '终止拼对' : sherd['拼对结论']}）`
        : null

  const finds = [...listRows(FIND_KEY)]
  let index = refCode ? finds.findIndex((row) => String(row['器物编号'] ?? '').trim() === refCode) : -1
  if (index < 0) {
    index = finds.findIndex((row) => String(row['拼对编号'] ?? '').trim() === code)
  }

  if (index >= 0) {
    const current = finds[index]
    const next: EntryRow = { ...current, 拼对编号: code }
    if (disposition) {
      next['拼对处置'] = disposition
    }
    finds[index] = next
    saveRows(FIND_KEY, finds)
    return
  }

  // 没有可认领的台账行：只有终态结论才补登，在途拼对不凭空增加出土物。
  if (disposition && refCode) {
    finds.push({
      id: nextId(finds),
      status: '已登记',
      pending: false,
      abnormal: false,
      器物编号: refCode,
      出土探方: '',
      出土层位: '',
      器物类别: '陶片',
      质地: '',
      完残程度: '',
      最大尺寸: '',
      拼对编号: code,
      拼对处置: disposition,
      登记状态: '已登记',
    })
    saveRows(FIND_KEY, finds)
  }
}

function saveSherd(rows: EntryRow[]): void {
  saveRows(SHERD_KEY, rows.map(shapeRow))
}

// 启动时归一化历史数据：同一拼对编号只保留一条，已复原的结论沿用，页面状态与环节对齐。
export function normalizeSherdRecords(): { removed: number } {
  const rows = listRows(SHERD_KEY)
  const groups = new Map<string, EntryRow[]>()
  const order: string[] = []
  rows.forEach((row, rowIndex) => {
    const code = String(row['拼对编号'] ?? '').trim()
    const key = code || `__缺编号-${rowIndex}`
    if (!groups.has(key)) {
      groups.set(key, [])
      order.push(key)
    }
    groups.get(key)!.push(row)
  })

  let removed = 0
  const merged: EntryRow[] = []
  for (const key of order) {
    const group = groups.get(key)!
    if (group.length > 1) {
      removed += group.length - 1
    }
    const canon = [...group].sort((a, b) => {
      const delta =
        (STATUS_PROGRESS[String(b.status)] ?? 0) - (STATUS_PROGRESS[String(a.status)] ?? 0)
      return delta !== 0 ? delta : Number(a.id) - Number(b.id)
    })[0]

    const next = shapeRow({ ...canon })
    const fillIfBlank = (field: string) => {
      if (isBlank(next[field])) {
        const hit = group.find((row) => !isBlank(row[field]))
        if (hit) {
          next[field] = hit[field] as string | number | boolean
        }
      }
    }
    TEXT_FIELDS.forEach(fillIfBlank)
    // 已复原主记录若片数/结论残空，只从同编号其他残行补全，绝不换成别的环节的值。
    fillIfBlank('拼合片数')
    fillIfBlank('拼对结论')
    merged.push(next)
  }

  if (removed > 0 || rows.some((row, i) => row !== merged[i])) {
    saveSherd(merged)
  }
  // 归一化后的结论统一回写一次台账（值不变即幂等）。
  listRows(SHERD_KEY).forEach(syncLedger)
  return { removed }
}

function findSherdIndex(rows: EntryRow[], id: number): number {
  return rows.findIndex((row) => Number(row.id) === Number(id))
}

// 登记拼对：同一拼对编号重复提交时按已有记录处理——不新增、不改环节，只补全空缺资料。
export function registerSherd(rawInput: SherdForm): SherdActionResult {
  const input = trimForm(rawInput)
  if (!input.拼对编号) {
    return { ok: false, message: '拼对编号为必填项' }
  }
  const rows = [...listRows(SHERD_KEY)]
  const existing = rows.find(
    (row) => String(row['拼对编号'] ?? '').trim() === input.拼对编号,
  )
  if (existing) {
    const index = rows.indexOf(existing)
    const next: EntryRow = { ...existing }
    TEXT_FIELDS.forEach((field) => {
      if (isBlank(next[field]) && input[field]) {
        next[field] = input[field]
      }
    })
    if (isBlank(next['拼合片数']) && input.拼合片数) {
      next['拼合片数'] = piecesValue(input.拼合片数)
    }
    if (isBlank(next['拼对结论']) && input.拼对结论) {
      next['拼对结论'] = input.拼对结论
    }
    rows[index] = shapeRow(next) // 环节状态保持原值，只做形态对齐
    saveRows(SHERD_KEY, rows)
    syncLedger(rows[index])
    return {
      ok: true,
      duplicated: true,
      message: `拼对编号 ${input.拼对编号} 已登记（当前「${rows[index].status}」），按已有记录处理，未重复建档、未改动环节`,
    }
  }

  const row: EntryRow = shapeRow({
    id: nextId(rows),
    status: '待拼对',
    pending: true,
    abnormal: false,
    拼对编号: input.拼对编号,
    所属单位: input.所属单位,
    关联器物编号: input.关联器物编号,
    陶系: input.陶系,
    纹饰: input.纹饰,
    可辨器型: input.可辨器型,
    拼合片数: piecesValue(input.拼合片数),
    拼对结论: input.拼对结论,
  })
  rows.push(row)
  saveRows(SHERD_KEY, rows)
  syncLedger(row)
  return { ok: true, message: `拼对记录 ${input.拼对编号} 已登记，进入「待拼对」` }
}

// 在途编辑：陶系、纹饰等资料直接落库；已复原/已放弃为历史结论，不再改动。
export function updateSherd(id: number, rawInput: SherdForm): ActionResult {
  const input = trimForm(rawInput)
  const rows = [...listRows(SHERD_KEY)]
  const index = findSherdIndex(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的拼对记录` }
  }
  const current = rows[index]
  if (TERMINAL_STATUSES.has(String(current.status))) {
    return { ok: false, message: `「${current.status}」为历史拼对结论，只保留不修改` }
  }
  const next = shapeRow({
    ...current,
    所属单位: input.所属单位,
    关联器物编号: input.关联器物编号,
    陶系: input.陶系,
    纹饰: input.纹饰,
    可辨器型: input.可辨器型,
    拼合片数: piecesValue(input.拼合片数),
    拼对结论: input.拼对结论,
  })
  rows[index] = next
  saveRows(SHERD_KEY, rows)
  syncLedger(next)
  return { ok: true, message: `拼对记录 ${current['拼对编号']} 的资料已保存` }
}

// 提交拼对：待拼对 → 拼对中；重复提交幂等处理，终态不允许回退。
export function submitSherd(id: number): SherdActionResult {
  const rows = [...listRows(SHERD_KEY)]
  const index = findSherdIndex(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的拼对记录` }
  }
  const current = rows[index]
  const status = String(current.status)
  if (status === '拼对中') {
    return {
      ok: true,
      duplicated: true,
      message: `拼对记录 ${current['拼对编号']} 已在「拼对中」，重复提交不重复处理`,
    }
  }
  if (status === '已复原' || status === '已放弃') {
    return { ok: false, message: `拼对记录已「${status}」，环节只能顺次前进，不能回到拼对中` }
  }
  const next = shapeRow({ ...current, status: '拼对中' })
  rows[index] = next
  saveRows(SHERD_KEY, rows)
  return { ok: true, message: `拼对记录 ${current['拼对编号']} 已提交，进入「拼对中」` }
}

// 确认复原：拼对中 → 已复原，只生效一次；再次确认按已有结论幂等返回，不改不增。
export function confirmRestore(
  id: number,
  patch: { 拼合片数: string; 拼对结论: string },
): SherdActionResult {
  const pieces = String(patch.拼合片数 ?? '').trim()
  const conclusion = String(patch.拼对结论 ?? '').trim()
  const rows = [...listRows(SHERD_KEY)]
  const index = findSherdIndex(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的拼对记录` }
  }
  const current = rows[index]
  const status = String(current.status)
  if (status === '已复原') {
    return {
      ok: true,
      duplicated: true,
      message: `拼对记录 ${current['拼对编号']} 已复原，历史复原结论保留，确认复原只生效一次`,
    }
  }
  if (status === '已放弃') {
    return { ok: false, message: '已放弃的拼对不能再确认复原，请重新登记拼对编号' }
  }
  if (status === '待拼对') {
    return { ok: false, message: '请先提交拼对进入「拼对中」，再确认复原' }
  }
  if (!/^\d+$/.test(pieces) || Number(pieces) <= 0) {
    return { ok: false, message: '请填写大于 0 的拼合片数（整数）' }
  }
  const next = shapeRow({
    ...current,
    status: '已复原',
    拼合片数: Number(pieces),
    拼对结论: conclusion || '可复原',
  })
  rows[index] = next
  saveRows(SHERD_KEY, rows)
  syncLedger(next)
  return { ok: true, message: `拼对记录 ${current['拼对编号']} 已复原，结论已回写出土物台账` }
}

// 终止拼对：待拼对/拼对中 → 已放弃；已放弃幂等；已复原是历史结论，不允许改判。
export function abandonSherd(id: number, reason = ''): SherdActionResult {
  const note = reason.trim()
  const rows = [...listRows(SHERD_KEY)]
  const index = findSherdIndex(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的拼对记录` }
  }
  const current = rows[index]
  const status = String(current.status)
  if (status === '已放弃') {
    return { ok: true, duplicated: true, message: `拼对记录 ${current['拼对编号']} 已放弃，重复操作不重复处理` }
  }
  if (status === '已复原') {
    return { ok: false, message: `拼对记录已复原，历史复原结论沿用保留，不能改为已放弃` }
  }
  const next = shapeRow({ ...current, status: '已放弃', 拼对结论: note || '终止拼对' })
  rows[index] = next
  saveRows(SHERD_KEY, rows)
  syncLedger(next)
  return { ok: true, message: `拼对记录 ${current['拼对编号']} 已终止，环节「已放弃」` }
}
