<template>
  <section class="page" data-module="sherd">
    <header class="page-head">
      <div>
        <h2>陶片拼对管理</h2>
        <p class="page-desc">维护拼对记录，围绕拼对编号、所属单位、陶系、纹饰做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="toggleCreate">登记拼对记录</button>
        <button class="btn" type="button" @click="exportRows">导出陶片拼对清单</button>
      </div>
    </header>

    <form v-if="showCreate" class="create-panel" @submit.prevent="submitCreate">
      <label v-for="field in createFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input
          v-model="createForm[field]"
          :placeholder="field === uniqueField ? '必填，重复编号按已有记录处理' : `填写${field}`"
        />
      </label>
      <button class="btn primary" type="submit">提交登记</button>
      <button class="btn ghost" type="button" @click="toggleCreate">取消</button>
    </form>

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
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <input
              v-if="editingId === Number(row.id) && editableColumns.includes(column)"
              v-model="editForm[column]"
              class="cell-input"
            />
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="editingId === Number(row.id)">
              <button class="link" type="button" @click="saveEdit(row)">保存</button>
              <button class="link" type="button" @click="cancelEdit">取消</button>
            </template>
            <template v-else>
              <button
                v-for="action in rowActions(row)"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
              <button v-if="!isLocked(row)" class="link" type="button" @click="startEdit(row)">
                编辑
              </button>
              <span v-else class="locked-tag">已锁定</span>
            </template>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无陶片拼对数据，可先登记拼对记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条陶片拼对记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  availableActions,
  createEntry,
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  updateEntry,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('sherd')
const columns = ["拼对编号", "所属单位", "陶系", "纹饰", "可辨器型", "拼合片数", "拼对结论", "拼对状态"]
const statuses = ["待拼对", "拼对中", "已复原", "已放弃"]
const uniqueField = meta.uniqueField ?? '拼对编号'
const createFields = ["拼对编号", "所属单位", "陶系", "纹饰", "可辨器型", "拼合片数", "拼对结论"]
const editableColumns = ["陶系", "纹饰", "可辨器型", "拼合片数", "拼对结论"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const showCreate = ref(false)
const createForm = ref<Record<string, string>>({})
const editingId = ref<number | null>(null)
const editForm = ref<Record<string, string>>({})

function countByStatus(status: string) {
  return rows.value.filter((row) => String(row.status) === status).length
}

const stats = computed(() => [
  { label: "待拼对记录", value: countByStatus("待拼对") },
  { label: "拼对中记录", value: countByStatus("拼对中") },
  { label: "已复原器物", value: countByStatus("已复原") },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({ status, count: countByStatus(status) })),
)

function clearMessages() {
  errorMessage.value = ''
  noticeMessage.value = ''
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function toggleCreate() {
  clearMessages()
  showCreate.value = !showCreate.value
  if (!showCreate.value) {
    createForm.value = {}
  }
}

function submitCreate() {
  clearMessages()
  const result = createEntry(meta.key, { ...createForm.value })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  if (result.created) {
    showCreate.value = false
    createForm.value = {}
  }
  reload()
}

function isLocked(row: EntryRow) {
  return (meta.lockStatuses ?? []).includes(String(row.status))
}

function rowActions(row: EntryRow) {
  return availableActions(meta.key, row)
}

function startEdit(row: EntryRow) {
  clearMessages()
  editingId.value = Number(row.id)
  const form: Record<string, string> = {}
  for (const column of editableColumns) {
    form[column] = String(row[column] ?? '')
  }
  editForm.value = form
}

function cancelEdit() {
  editingId.value = null
  editForm.value = {}
}

function saveEdit(row: EntryRow) {
  clearMessages()
  const result = updateEntry(meta.key, Number(row.id), { ...editForm.value })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  cancelEdit()
  reload()
}

function runAction(action: string, row: EntryRow) {
  clearMessages()
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '陶片拼对列表读取失败'
  }
}

onMounted(reload)
</script>
