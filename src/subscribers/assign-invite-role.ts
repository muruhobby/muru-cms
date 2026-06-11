import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Auto-assign a role to every new invite.
 *
 * Medusa already applies an invite's linked roles to the user when the invite is
 * accepted (acceptInviteWorkflow). The admin dashboard's invite form doesn't let
 * you pick a role, though, so dashboard invites carry none — and with RBAC on, the
 * accepted user ends up role-less and locked out.
 *
 * This subscriber links a default role (env INVITE_DEFAULT_ROLE, default "Employee")
 * to any newly created invite that doesn't already have one. Invites that already
 * carry roles (e.g. `medusa user --invite`, which assigns Super Admin) are left
 * untouched.
 */
const DEFAULT_INVITE_ROLE_NAME = process.env.INVITE_DEFAULT_ROLE || "Employee"

export default async function assignInviteRole({
  event,
  container,
}: SubscriberArgs<{ id: string } | { id: string }[]>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const ff = container.resolve(ContainerRegistrationKeys.FEATURE_FLAG_ROUTER) as {
    isFeatureEnabled: (flag: string) => boolean
  }
  if (!ff.isFeatureEnabled("rbac")) {
    return
  }

  const inviteIds = (Array.isArray(event.data) ? event.data : [event.data])
    .map((d) => d?.id)
    .filter(Boolean) as string[]
  if (!inviteIds.length) {
    return
  }

  const rbac = container.resolve(Modules.RBAC)
  const [role] = await rbac.listRbacRoles({ name: DEFAULT_INVITE_ROLE_NAME })
  if (!role) {
    logger.warn(
      `[assign-invite-role] Default role "${DEFAULT_INVITE_ROLE_NAME}" not found — run "npm run seed:employee-role". Skipping.`
    )
    return
  }

  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
  const linkService = remoteLink.getLinkModule(
    Modules.USER,
    "invite_id",
    Modules.RBAC,
    "rbac_role_id"
  )
  if (!linkService) {
    logger.warn("[assign-invite-role] invite<->rbac link module unavailable — skipping.")
    return
  }

  for (const inviteId of inviteIds) {
    // Respect invites that already carry roles (e.g. CLI --invite -> Super Admin).
    const existing = await linkService.list({ invite_id: inviteId })
    if (existing.length) {
      continue
    }

    await remoteLink.create({
      [Modules.USER]: { invite_id: inviteId },
      [Modules.RBAC]: { rbac_role_id: role.id },
    })
    logger.info(
      `[assign-invite-role] Linked default role "${DEFAULT_INVITE_ROLE_NAME}" to invite ${inviteId}.`
    )
  }
}

export const config: SubscriberConfig = {
  event: "invite.created",
}
