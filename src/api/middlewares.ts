import { defineMiddlewares } from "@medusajs/framework/http"
import type {
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from "@medusajs/framework/http"

// CDN caching for the public catalog endpoints.
//
// These GET routes (products, collections, categories) are anonymous and read
// heavy, so we let Cloudflare cache them at the edge. The `Cache-Control`
// header below is what tells Cloudflare how long to serve a cached copy:
//   - s-maxage:               shared (CDN) cache lifetime, in seconds.
//   - stale-while-revalidate: keep serving the stale copy this long while a
//                             fresh one is fetched in the background.
// We deliberately set `max-age=0` so the *browser* always revalidates and only
// the CDN holds the cache — that keeps a stale page from sticking in a user's
// browser after we purge/expire the edge.
//
// On Cloudflare's Free/Pro plans there is no precise per-product purge, so we
// rely on a short s-maxage to bound staleness instead of clear-on-update. Tune
// via CATALOG_CACHE_TTL (seconds); default 60.
const TTL = Number(process.env.CATALOG_CACHE_TTL || 60)
const SWR = Number(process.env.CATALOG_CACHE_SWR || 300)

function cacheCatalog(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  // Never cache for authenticated customers: prices and visibility can be
  // customer-group specific, so a shared cached copy could leak the wrong data.
  const isAuthed =
    Boolean(req.headers["authorization"]) ||
    /(?:^|;\s*)connect\.sid=|_medusa_jwt=/.test(req.headers["cookie"] || "")

  if (!isAuthed) {
    res.setHeader(
      "Cache-Control",
      `public, max-age=0, s-maxage=${TTL}, stale-while-revalidate=${SWR}`
    )
  }

  next()
}

export default defineMiddlewares([
  {
    matcher: "/store/products",
    methods: ["GET"],
    middlewares: [cacheCatalog],
  },
  {
    matcher: "/store/collections",
    methods: ["GET"],
    middlewares: [cacheCatalog],
  },
  {
    matcher: "/store/product-categories",
    methods: ["GET"],
    middlewares: [cacheCatalog],
  },
])
