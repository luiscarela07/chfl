// src/config.js
import dotenv from 'dotenv'
dotenv.config()

const dataDir  = process.env.DATA_DIR  || './data'
const dataFile = process.env.DATA_FILE || 'db.json'

export default {
  // Azure injects PORT; fallback for local
  port: parseInt(process.env.PORT || '3000', 10),

  // Secrets & branding
  sessionSecret: process.env.SESSION_SECRET || 'dev_secret_change',
  firmName:      process.env.CHLF_FIRM_NAME   || process.env.FIRM_NAME   || 'Your Law Firm',
  brandColor:    process.env.CHLF_BRAND_COLOR || process.env.BRAND_COLOR || '#7c3aed',
  logoUrl:       process.env.LOGO_URL || '',

  // Initial admin (first login/seed)
  adminEmail:    process.env.CHLF_ADMIN_EMAIL    || process.env.ADMIN_EMAIL    || 'admin@example.com',
  adminPassword: process.env.CHLF_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'ChangeMeNow!',

  // Persistent JSON DB path (defaults to /home/site/data/db.json on Azure)
  dbPath: process.env.DB_PATH || `${dataDir}/${dataFile}`,

  // Optional brand.json override
  brandJsonPath: process.env.BRAND_JSON || `${dataDir}/brand.json`,

  nodeEnv: process.env.NODE_ENV || 'development',
}
