// src/brand.js
import fs from 'fs'
import config from './config.js'

export function brandMiddleware(_req, res, next) {
  let brand = {
    firmName: config.firmName,
    brandColor: config.brandColor,
    logoUrl: config.logoUrl,
  }
  try {
    const p = config.brandJsonPath
    if (p && fs.existsSync(p)) {
      const json = JSON.parse(fs.readFileSync(p, 'utf8'))
      brand = { ...brand, ...json }
    }
  } catch {
    // keep defaults
  }
  res.locals.brand = brand
  next()
}
