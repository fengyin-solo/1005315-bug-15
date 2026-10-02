// 把 scripts/verify-sherd.ts 打包后在 node 里跑一遍，退出码即校验结果。
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outfile = join(tmpdir(), 'verify-sherd.mjs')

await build({
  entryPoints: [resolve(root, 'scripts/verify-sherd.ts')],
  bundle: true,
  platform: 'node',
  alias: { '@': resolve(root, 'src') },
  outfile,
})

const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit' })
process.exit(result.status ?? 1)
