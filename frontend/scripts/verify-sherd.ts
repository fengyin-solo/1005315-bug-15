// 验证陶片拼对流转规则：幂等、顺次、去重、锁定、回写。
// 运行方式见 README 或 package.json（临时脚本，验证后可删）。
import {
  availableActions,
  createEntry,
  listEntries,
  runAction,
  updateEntry,
} from '@/api/local-service'
import { listRows, saveRows } from '@/data/local-store'

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failures += 1
    console.error(`  ✗ ${name} ${detail}`)
  }
}
const sherd = (id: number) => listRows('sherd').find((r) => Number(r.id) === id)!
const findRow = (id: number) => listRows('find').find((r) => Number(r.id) === id)!

// —— 场景1：确认复原只生效一次，重复提交按已有记录处理 ——
console.log('场景1：确认复原幂等')
let r = runAction('sherd', 2, '确认复原')
check('首次确认复原成功', r.ok && sherd(2).status === '已复原')
const pieceCount = sherd(2)['拼合片数']
r = runAction('sherd', 2, '确认复原')
check('重复确认按已有记录处理（ok 且不报错）', r.ok, r.message)
check('重复确认后环节不变', sherd(2).status === '已复原')
check('拼合片数不被重复提交改写', sherd(2)['拼合片数'] === pieceCount)
check('已复原不再 pending', sherd(2).pending === false)

// —— 场景2：只能顺次流转，不允许回到前面 ——
console.log('场景2：顺次流转')
r = runAction('sherd', 2, '提交拼对')
check('已复原不能回到拼对中', !r.ok && sherd(2).status === '已复原', r.message)
check('已复原行只剩终止拼对一个动作', JSON.stringify(availableActions('sherd', sherd(2))) === JSON.stringify(['终止拼对']))
r = runAction('sherd', 2, '终止拼对')
check('已复原可顺次到已放弃', r.ok && sherd(2).status === '已放弃')
r = runAction('sherd', 2, '提交拼对')
check('已放弃不能回到任何环节', !r.ok && sherd(2).status === '已放弃')
check('已放弃行没有可执行动作', availableActions('sherd', sherd(2)).length === 0)
r = runAction('sherd', 1, '提交拼对')
check('待拼对可提交拼对', r.ok && sherd(1).status === '拼对中')
r = runAction('sherd', 1, '提交拼对')
check('拼对中重复提交按已有记录处理', r.ok && sherd(1).status === '拼对中')

// —— 场景3：同一拼对编号提交两回，不新增、不重复显示 ——
console.log('场景3：登记幂等 + 读取去重')
const before = listRows('sherd').length
let c = createEntry('sherd', { 拼对编号: 'SHER-0001', 陶系: '泥质灰陶' })
check('重复编号登记按已有记录处理', c.ok && !c.created, c.message)
check('不新增记录', listRows('sherd').length === before)
c = createEntry('sherd', { 拼对编号: 'SHER-0100', 所属单位: 'T3探方', 陶系: '泥质灰陶', 拼合片数: 6 })
check('新编号正常登记', c.ok && c.created)
check('新记录从待拼对起步', listRows('sherd').find((x) => x['拼对编号'] === 'SHER-0100')!.status === '待拼对')
c = createEntry('sherd', { 陶系: '泥质灰陶' })
check('编号为空被拒绝', !c.ok)
// 模拟历史遗留的重复数据：同一编号两条、各停一个环节
const dup = listRows('sherd')
const a = dup.find((x) => x['拼对编号'] === 'SHER-0100')!
dup.push({ ...a, id: 999, status: '待拼对' })
saveRows('sherd', dup)
const listed = listEntries('sherd').items.filter((x) => x['拼对编号'] === 'SHER-0100')
check('同一编号清单里只显示一条', listed.length === 1)
check('去重后库里也只留一条', listRows('sherd').filter((x) => x['拼对编号'] === 'SHER-0100').length === 1)

// —— 场景4：编辑落库；已复原的历史结论保留 ——
console.log('场景4：编辑落库与历史结论锁定')
let u = updateEntry('sherd', 1, { 陶系: '夹砂灰陶', 纹饰: '篮纹' })
check('待拼对/拼对中可编辑', u.ok)
check('陶系落库（换条件再查不变）', sherd(1)['陶系'] === '夹砂灰陶' && listEntries('sherd', { 陶系: '夹砂灰陶' }).items.length === 1 && listEntries('sherd', { 纹饰: '篮纹' }).items.length === 1)
u = updateEntry('sherd', 3, { 陶系: '夹砂红陶', 拼对结论: '改写历史' })
check('已复原记录拒绝改动', !u.ok, u.message)
check('历史拼对结论原样保留', sherd(3)['拼对结论'] === '复原为陶鬲一件，缺足已补配')
check('已复原的陶系也不变', sherd(3)['陶系'] === '泥质黑陶')
u = updateEntry('sherd', 1, { 拼对编号: 'SHER-0003' })
check('改编号撞车被拒绝', !u.ok)

// —— 场景5：处置结论回写出土物台账 ——
console.log('场景5：结论回写台账')
updateEntry('sherd', 1, { 拼对结论: '复原为陶罐一件' })
r = runAction('sherd', 1, '确认复原')
check('确认复原成功', r.ok && sherd(1).status === '已复原')
check('结论回写到同单位出土物', String(findRow(1)['拼对结论']) === '复原为陶罐一件', String(findRow(1)['拼对结论']))
check('sherd2 的处置结论随环节回写（已放弃）', String(findRow(2)['拼对结论']) === '已放弃', String(findRow(2)['拼对结论']))
check('不相关单位不被误写', String(findRow(3)['拼对结论']) === '', String(findRow(3)['拼对结论']))
check('历史已复原记录不被追溯改写', String(findRow(1)['拼对结论']) === '复原为陶罐一件')

// —— 场景6：页面层改动不会污染共享数据 ——
console.log('场景6：读出来的是副本')
const pageRows = listRows('sherd')
pageRows[0]['陶系'] = '页面层乱改'
check('页面层改动不落库', sherd(Number(pageRows[0].id))['陶系'] !== '页面层乱改')

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
