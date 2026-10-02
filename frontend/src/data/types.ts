/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  /** 业务编号字段：登记按它去重，多处入口共用同一份编号数据 */
  uniqueField?: string
  /** 为 true 时状态只能沿 statuses 顺序前进，不允许回到前面的环节 */
  sequentialFlow?: boolean
  /** 进入这些状态后记录锁定：字段不再改动，沿用当时的结论 */
  lockStatuses?: string[]
  /** 进入锁定状态时，把本模块的结论字段回写到关联台账 */
  writeBack?: {
    module: string
    /** [本模块字段, 台账字段]，任一组相等即视为关联记录 */
    links: [string, string][]
    /** 回写到台账的字段名 */
    field: string
  }
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type CreateResult = ActionResult & {
  /** false 表示编号已存在，按已有记录处理，没有新增 */
  created: boolean
  id?: number
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
