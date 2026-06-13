import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    }
  },
  // Admin dashboard config. Set explicitly so Medusa reliably serves the built
  // admin in production. Without an explicit admin block the server can fail to
  // resolve the build output ("Could not find index.html in the admin build
  // directory").
  admin: {
    // Keep the dashboard served by this backend (not a separate host).
    disable: false,
    // Path the dashboard is served at.
    path: "/app",
    // Absolute URL the admin bundle uses to reach this backend. Required in
    // production, where the admin is not running against localhost.
    backendUrl: process.env.MEDUSA_BACKEND_URL,
  },
  // Role-based access control. The env var MEDUSA_FF_RBAC takes precedence over
  // this and is what we rely on at deploy time (see .env); this line documents
  // the intent and keeps RBAC on even if the env var is omitted.
  featureFlags: {
    rbac: true,
  },
  // The RBAC module is normally auto-included only when the feature flag is
  // known at config-evaluation time, which the flag router isn't yet. Register
  // it explicitly so its tables/loaders are guaranteed to load.
  modules: [
    {
      resolve: "@medusajs/medusa/rbac",
    },
    // File storage — Cloudflare R2 (S3-compatible). All uploads go here.
    {
      resolve: "@medusajs/medusa/file",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/file-s3",
            id: "r2",
            options: {
              bucket: process.env.R2_BUCKET,
              endpoint: process.env.R2_ENDPOINT,
              access_key_id: process.env.R2_ACCESS_KEY_ID,
              secret_access_key: process.env.R2_SECRET_ACCESS_KEY,
              // Public base URL for serving files (r2.dev or your custom domain).
              file_url: process.env.R2_PUBLIC_URL,
              // R2 is region-agnostic; the S3 API expects "auto".
              region: "auto",
            },
          },
        ],
      },
    },
    // Fulfillment — the default "manual" provider stays auto-registered; we add
    // Biteship for live Indonesian courier rates (JNE, J&T) at checkout.
    {
      resolve: "@medusajs/medusa/fulfillment",
      options: {
        providers: [
          {
            resolve: "./src/modules/biteship",
            id: "biteship",
            options: {
              apiKey: process.env.BITESHIP_API_KEY,
              originPostalCode: process.env.BITESHIP_ORIGIN_POSTAL_CODE,
              couriers: process.env.BITESHIP_COURIERS || "jne,jnt",
              defaultWeight: Number(process.env.BITESHIP_DEFAULT_WEIGHT || 1000),
              originContactName: process.env.BITESHIP_ORIGIN_CONTACT_NAME,
              originContactPhone: process.env.BITESHIP_ORIGIN_CONTACT_PHONE,
              originAddress: process.env.BITESHIP_ORIGIN_ADDRESS,
            },
          },
        ],
      },
    },
  ],
})
