const express = require('express')
const { wrap } = require('../lib/http')
const { validateRecords } = require('../lib/validate')
const { summarize } = require('../services/summary')
const { rateLimited, featureOff } = require('../lib/errors')

function createSummaryRoute(options) {
  const { limitIp, now, store } = options
  const router = express.Router()

  router.post(
    '/summary',
    wrap(async (req, res) => {
      if (!limitIp(req.ip || 'unknown')) throw rateLimited()

      if (store) {
        const currentConfig = await store.get()
        const features = (currentConfig.config && currentConfig.config.features) || {}
        if (features.summary === false) throw featureOff('事实回顾未开放')
      }

      const current = now()
      const parsed = validateRecords(req.body && req.body.records, { now: current })
      const result = summarize(parsed.records, current)

      res.json({
        available: result.available,
        text: result.text,
        stats: result.stats,
        dropped: parsed.dropped,
        generatedAt: current
      })
    })
  )

  return router
}

module.exports = { createSummaryRoute }
