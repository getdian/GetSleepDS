const fs = require('fs')
const path = require('path')

// 自动加载根目录或 server 目录下的 .env（如果存在）
function loadEnv() {
  const rootEnv = path.resolve(__dirname, '..', '..', '.env')
  const serverEnv = path.resolve(__dirname, '..', '.env')
  const targetEnv = fs.existsSync(rootEnv) ? rootEnv : fs.existsSync(serverEnv) ? serverEnv : null
  if (!targetEnv) return

  if (typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(targetEnv)
      return
    } catch (_) {}
  }

  try {
    const content = fs.readFileSync(targetEnv, 'utf8')
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq > 0) {
        const key = line.slice(0, eq).trim()
        let val = line.slice(eq + 1).trim()
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1)
        }
        if (!(key in process.env)) {
          process.env[key] = val
        }
      }
    }
  } catch (_) {}
}

loadEnv()

const { loadConfig } = require('./config')
const { createDb } = require('./db')
const { createApp } = require('./app')

const CLEANUP_INTERVAL = 6 * 60 * 60 * 1000

async function main() {
  const config = loadConfig(process.env)
  const db = await createDb({ mode: config.dbMode, url: config.databaseUrl })
  const app = createApp({ config, db })

  const server = app.listen(config.port, () => {
    console.log(
      '[boot] sleep-api listening on :' + config.port +
      ' (env=' + config.nodeEnv + ', db=' + db.mode + ')'
    )
    console.log('[admin] dashboard: /admin')

    if (config.admin.generated) {
      console.warn('[admin] 未设置 ADMIN_PASSWORD，本次启动临时密码：' + config.admin.password)
      console.warn('[admin] 重启会重新生成；正式环境请把 ADMIN_PASSWORD 写进 .env')
    }
  })

  const timer = setInterval(() => {
    db.cleanupExpired(Date.now()).catch((err) => {
      console.error('[cleanup]', err.message)
    })
    db.cleanupEvents(Date.now() - 180 * 24 * 60 * 60 * 1000).catch((err) => {
      console.error('[cleanup] events', err.message)
    })
    // 墓碑只对客户端 400 天同步窗口有意义，更老的清掉避免响应体越来越大
    if (db.cleanupDeletions) {
      db.cleanupDeletions(Date.now() - 400 * 24 * 60 * 60 * 1000).catch((err) => {
        console.error('[cleanup] deletions', err.message)
      })
    }
  }, CLEANUP_INTERVAL)
  if (timer.unref) timer.unref()

  let closing = false
  const shutdown = (signal) => {
    if (closing) return
    closing = true
    console.log('[shutdown]', signal)
    clearInterval(timer)
    server.close(() => {
      db.close()
        .then(() => process.exit(0))
        .catch(() => process.exit(1))
    })
    setTimeout(() => process.exit(1), 8000).unref()
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  // 兜底：Express 的 errorHandler 只覆盖请求上下文，定时器/第三方回调里的浮动异常
  // 原先会直接崩进程且没有任何日志。未捕获异常记录后退出（由容器重启拉起）。
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason && reason.stack ? reason.stack : reason)
  })
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err && err.stack ? err.stack : err)
    shutdown('uncaughtException')
  })
}

main().catch((err) => {
  console.error('[boot] failed:', err.message)
  process.exit(1)
})
