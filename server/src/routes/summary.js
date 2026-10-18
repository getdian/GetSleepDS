const express = require('express')
const { wrap } = require('../lib/http')
const { validateRecords } = require('../lib/validate')
const { summarize } = require('../services/summary')
const { rateLimited } = require('../lib/errors')

function createSummaryRoute(options) {
  const { limitIp, now } = options
  const router = express.Router()

  router.post(
    '/summary',
    wrap(async (req, res) => {
      if (!limitIp(req.ip || 'unknown')) throw rateLimited()

      const records = validateRecords(req.body && req.body.records)
      const current = now()
      const result = summarize(records, current)

      res.json({
        available: result.available,
        text: result.text,
        stats: result.stats,
        generatedAt: current
      })
    })
  )

  return router
}

module.exports = { createSummaryRoute }
