import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import './styles/global.css'
import { normalizeSherdRecords } from './data/sherd-domain'

// 启动先清洗历史拼对残留：同一拼对编号去重合并，已复原结论沿用，处置结论回写出土物台账。
normalizeSherdRecords()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
