import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

const SUPER_ADMIN_ROLE_ID = "role_super_admin"

/**
 * Idempotent first-admin (owner) bootstrap.
 *
 * Reads ADMIN_EMAIL / ADMIN_PASSWORD from the environment and creates a single
 * admin user (with an emailpass login) only if it does not already exist.
 *
 * When RBAC is enabled (MEDUSA_FF_RBAC=true), the user is also given the
 * "Super Admin" role so the owner keeps full access — without a role, RBAC
 * locks an admin out of every gated route.
 *
 * Safe to run on every deploy.
 *
 * Run with:  npx medusa exec ./src/scripts/bootstrap-admin.ts
 */
export default async function bootstrapAdmin({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD

  if (!email || !password) {
    logger.warn(
      "[bootstrap-admin] ADMIN_EMAIL and/or ADMIN_PASSWORD not set — skipping admin bootstrap."
    )
    return
  }

  const userModule = container.resolve(Modules.USER)
  const authModule = container.resolve(Modules.AUTH)

  // --- 1. Ensure the user exists (idempotent) -------------------------------
  let [user] = await userModule.listUsers({ email })

  if (user) {
    logger.info(`[bootstrap-admin] Admin user "${email}" already exists.`)
  } else {
    // Remove any orphaned auth identity left behind by a previously deleted user,
    // otherwise register() below fails with "Identity with email already exists".
    const orphans = (await authModule.listProviderIdentities({
      entity_id: email,
      provider: "emailpass",
    })) as { auth_identity_id: string }[]
    if (orphans.length) {
      await authModule.deleteAuthIdentities(orphans.map((o) => o.auth_identity_id))
      logger.info(`[bootstrap-admin] Cleaned up ${orphans.length} orphaned login(s) for "${email}".`)
    }

    user = await userModule.createUsers({ email })

    const { success, authIdentity, error } = await authModule.register("emailpass", {
      body: { email, password },
    })

    if (!success || !authIdentity) {
      await userModule.deleteUsers([user.id])
      throw new Error(
        `[bootstrap-admin] Failed to create login for "${email}": ${error ?? "unknown error"}`
      )
    }

    await authModule.updateAuthIdentities({
      id: authIdentity.id,
      app_metadata: { user_id: user.id },
    })

    logger.info(`[bootstrap-admin] Admin user "${email}" created.`)
  }

  // --- 2. Ensure the owner has the Super Admin role (only if RBAC is on) ----
  await ensureSuperAdminRole(container, user.id, email, logger)
}

async function ensureSuperAdminRole(
  container: ExecArgs["container"],
  userId: string,
  email: string,
  logger: { info: (m: string) => void; warn: (m: string) => void }
) {
  const ff = container.resolve(ContainerRegistrationKeys.FEATURE_FLAG_ROUTER) as {
    isFeatureEnabled: (flag: string) => boolean
  }
  if (!ff.isFeatureEnabled("rbac")) {
    return
  }

  const rbac = container.resolve(Modules.RBAC)
  const [role] = await rbac.listRbacRoles({ id: SUPER_ADMIN_ROLE_ID })
  if (!role) {
    logger.warn(
      `[bootstrap-admin] RBAC is on but "${SUPER_ADMIN_ROLE_ID}" is missing — run "npx medusa db:migrate" first.`
    )
    return
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "user",
    fields: ["id", "rbac_roles.id"],
    filters: { id: userId },
  })
  const current: string[] = ((data?.[0]?.rbac_roles ?? []) as { id: string }[]).map(
    (r) => r.id
  )

  if (current.includes(role.id)) {
    logger.info(`[bootstrap-admin] "${email}" already has the Super Admin role.`)
    return
  }

  const link = container.resolve(ContainerRegistrationKeys.LINK)
  await link.create({
    [Modules.USER]: { user_id: userId },
    [Modules.RBAC]: { rbac_role_id: role.id },
  })
  logger.info(`[bootstrap-admin] Assigned Super Admin role to "${email}".`)
}
