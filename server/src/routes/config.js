const express = require('express')
const { wrap } = require('../lib/http')

function createConfigRoute(options) {
  const store = options.store
  const router = express.Router()

  router.get(
    '/config',
    wrap(async (req, res) => {
      const current = await store.get()
      res.set('Cache-Control', 'no-store')
      res.json(Object.assign({}, current.config, { serverTime: Date.now() }))
    })
  )

  return router
}

module.exports = { createConfigRoute }
