<template>
  <section class="page" data-module="sherd">
    <header class="page-head">
      <div>
        <h2>陶片拼对管理</h2>
        <p class="page-desc">维护拼对记录，围绕拼对编号、所属单位、陶系、纹饰做登记、筛选与状态流转；拼对编号全局唯一，环节只能顺次前进。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记拼对记录</button>
        <button class="btn" type="button" @click="exportRows">导出陶片拼对清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item">已复原拼合片数合计：{{ restoredPieces }}</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前环节</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ isBlankCell(row[column]) ? '—' : row[column] }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="rowActions(row).length">
              <button
                v-for="item in rowActions(row)"
                :key="item"
                class="link"
                type="button"
                @click="handleAction(item, row)"
              >
                {{ item }}
              </button>
            </template>
            <span v-else class="muted-text">历史结论保留</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无陶片拼对数据，可先登记拼对记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条陶片拼对记录（同一拼对编号只保留一条，已复原结论沿用历史）</span>
      <span v-if="notice" :class="noticeOk ? 'ok-text' : 'error-text'">{{ notice }}</span>
    </footer>

    <SherdFormModal
      :open="modalOpen"
      :title="modalTitle"
      :submit-text="modalSubmitText"
      :fields="modalFields"
      :required="modalRequired"
      :readonly="modalReadonly"
      :initial="modalInitial"
      :hint="modalHint"
      @close="modalOpen = false"
      @submit="submitModal"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  abandonSherd,
  blankSherdForm,
  confirmRestore,
  listSherd,
  registerSherd,
  restoredPiecesTotal,
  rowToSherdForm,
  sherdStatusCount,
  submitSherd,
  updateSherd,
  type SherdForm,
} from '@/data/sherd-domain'
import { downloadEntries, moduleMeta } from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import SherdFormModal from '@/components/SherdFormModal.vue'

const meta = moduleMeta('sherd')
// 拼对状态即环节状态（status），不再单独展示一份可能不一致的字段。
const columns = ['拼对编号', '所属单位', '关联器物编号', '陶系', '纹饰', '可辨器型', '拼合片数', '拼对结论']
const statuses = ['待拼对', '拼对中', '已复原', '已放弃']
const allFields: (keyof SherdForm)[] = ['拼对编号', '所属单位', '关联器物编号', '陶系', '纹饰', '可辨器型', '拼合片数', '拼对结论']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const notice = ref('')
const noticeOk = ref(true)
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const statusSummary = computed(() =>
  statuses.map((status) => ({ status, count: sherdStatusCount()[status] ?? 0 })),
)
const restoredPieces = computed(() => restoredPiecesTotal())
const stats = computed(() => {
  const count = sherdStatusCount()
  return [
    { label: '待拼对记录', value: count['待拼对'] },
    { label: '拼对中记录', value: count['拼对中'] },
    { label: '已复原器物', value: count['已复原'] },
  ]
})

// 环节只能顺次前进：待拼对→拼对中→已复原，在途可终止为已放弃；终态不再提供动作。
function rowActions(row: EntryRow): string[] {
  switch (String(row.status)) {
    case '待拼对':
      return ['提交拼对', '终止拼对', '编辑资料']
    case '拼对中':
      return ['确认复原', '终止拼对', '编辑资料']
    default:
      return []
  }
}

function isBlankCell(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === ''
}

function showNotice(message: string, ok = true) {
  notice.value = message
  noticeOk.value = ok
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

// ---- 登记 / 编辑 / 确认复原 共用一个弹窗 ----
type ModalMode = 'create' | 'edit' | 'restore'
const modalOpen = ref(false)
const modalMode = ref<ModalMode>('create')
const modalInitial = ref<SherdForm>(blankSherdForm())
const activeRow = ref<EntryRow | null>(null)

const modalTitle = computed(() =>
  modalMode.value === 'create'
    ? '登记拼对记录'
    : modalMode.value === 'edit'
      ? `编辑拼对资料（${String(activeRow.value?.['拼对编号'] ?? '')}）`
      : `确认复原（${String(activeRow.value?.['拼对编号'] ?? '')}）`,
)
const modalSubmitText = computed(() =>
  modalMode.value === 'create' ? '提交登记' : modalMode.value === 'edit' ? '保存资料' : '确认复原',
)
const modalFields = computed<(keyof SherdForm)[]>(() =>
  modalMode.value === 'restore'
    ? ['拼合片数', '拼对结论']
    : allFields,
)
const modalRequired = computed<(keyof SherdForm)[]>(() =>
  modalMode.value === 'restore' ? ['拼合片数'] : ['拼对编号'],
)
const modalReadonly = computed<(keyof SherdForm)[]>(() =>
  modalMode.value === 'edit' ? ['拼对编号'] : [],
)
const modalHint = computed(() =>
  modalMode.value === 'create'
    ? '拼对编号重复提交时按已有记录处理：不新增、不改环节，仅补全空缺资料。'
    : modalMode.value === 'restore'
      ? '确认复原只生效一次；片数与结论落库并回写出土物台账，之后不可改判。'
      : '已复原、已放弃的历史拼对不再开放编辑。',
)

function openCreate() {
  modalMode.value = 'create'
  activeRow.value = null
  modalInitial.value = blankSherdForm()
  modalOpen.value = true
}

function openEdit(row: EntryRow) {
  modalMode.value = 'edit'
  activeRow.value = row
  modalInitial.value = rowToSherdForm(row)
  modalOpen.value = true
}

function openRestore(row: EntryRow) {
  modalMode.value = 'restore'
  activeRow.value = row
  modalInitial.value = rowToSherdForm(row)
  modalOpen.value = true
}

function submitModal(form: SherdForm) {
  if (modalMode.value === 'create') {
    const result = registerSherd(form)
    showNotice(result.message, result.ok)
  } else if (modalMode.value === 'edit' && activeRow.value) {
    // 编号在编辑时只读，随原记录一起回传，保证陶系、纹饰等改动直接落库。
    const result = updateSherd(Number(activeRow.value.id), form)
    showNotice(result.message, result.ok)
  } else if (modalMode.value === 'restore' && activeRow.value) {
    const result = confirmRestore(Number(activeRow.value.id), {
      拼合片数: form.拼合片数,
      拼对结论: form.拼对结论,
    })
    showNotice(result.message, result.ok)
  }
  if (modalMode.value !== 'restore' || noticeOk.value) {
    modalOpen.value = false
  }
  reload()
}

function handleAction(action: string, row: EntryRow) {
  notice.value = ''
  if (action === '编辑资料') {
    openEdit(row)
    return
  }
  if (action === '确认复原') {
    openRestore(row)
    return
  }
  let result
  if (action === '提交拼对') {
    result = submitSherd(Number(row.id))
  } else if (action === '终止拼对') {
    if (!window.confirm(`确认终止拼对 ${String(row['拼对编号'])}？终止后环节为「已放弃」，不可回到前面。`)) {
      return
    }
    result = abandonSherd(Number(row.id))
  } else {
    result = { ok: false, message: `未登记的动作：${action}` }
  }
  showNotice(result.message, result.ok)
  reload()
}

function reload() {
  notice.value = ''
  try {
    rows.value = listSherd(filters.value)
    total.value = rows.value.length
  } catch (error) {
    showNotice(error instanceof Error ? error.message : '陶片拼对列表读取失败', false)
  }
}

onMounted(reload)
</script>
