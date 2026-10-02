<template>
  <div v-if="open" class="modal-mask" @click.self="emit('close')">
    <div class="modal-card">
      <header class="modal-head">
        <h3>{{ title }}</h3>
        <button class="link" type="button" @click="emit('close')">关闭</button>
      </header>
      <form class="modal-body" @submit.prevent="submit">
        <label v-for="field in fields" :key="field" class="form-item">
          <span>{{ field }}<em v-if="required.includes(field)">*</em></span>
          <input
            v-model="form[field]"
            :disabled="readonly.includes(field)"
            :placeholder="`请填写${field}`"
          />
        </label>
        <p v-if="hint" class="form-hint">{{ hint }}</p>
        <footer class="modal-foot">
          <button class="btn" type="button" @click="emit('close')">取消</button>
          <button class="btn primary" type="submit">{{ submitText }}</button>
        </footer>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue'

import { blankSherdForm, type SherdForm } from '@/data/sherd-domain'

// 陶片拼对页、出土物登记页的拼对入口共用这个弹窗与同一份拼对编号数据。
const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    submitText: string
    fields: (keyof SherdForm)[]
    required?: (keyof SherdForm)[]
    readonly?: (keyof SherdForm)[]
    initial?: SherdForm | null
    hint?: string
  }>(),
  { required: () => [], readonly: () => [], initial: null, hint: '' },
)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submit', form: SherdForm): void
}>()

const form = reactive<SherdForm>(blankSherdForm())

watch(
  () => [props.open, props.initial],
  () => {
    const base = props.initial ?? blankSherdForm()
    Object.assign(form, blankSherdForm(), base)
  },
  { immediate: true, deep: true },
)

function submit() {
  const required = props.required ?? []
  const missing = required.find((field) => !String(form[field] ?? '').trim())
  if (missing) {
    return
  }
  emit('submit', { ...form })
}
</script>
