import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

const EMPLOYEE_ROLE_NAME = "Employee"

/**
 * Resources an Employee can fully manage (read/create/update/delete).
 *
 * Anything NOT in this list is DENIED for the Employee on any core admin route
 * that declares a policy — notably user & role management, API keys, store /
 * region / sales-channel / tax / currency settings. Edit this list to taste.
 */
const EMPLOYEE_ALLOWED_RESOURCES = [
  // Catalog
  "product",
  "product_variant",
  "product_option",
  "product_category",
  "product_collection",
  "product_tag",
  "product_type",
  // Inventory
  "inventory_item",
  "inventory_level",
  "reservation_item",
  // Orders & fulfillment
  "order",
  "order_change",
  "order_claim",
  "order_exchange",
  "fulfillment",
  "fulfillment_set",
  "return",
  "return_reason",
  // Order-related payments
  "payment",
  "payment_collection",
  "capture",
  "refund",
  "refund_reason",
  // Customers
  "customer",
  "customer_address",
  "customer_group",
  // Marketing & pricing
  "promotion",
  "campaign",
  "price",
  "price_list",
  // Operational
  "file",
  "notification",
]

/**
 * Seeds (idempotently) an "Employee" RBAC role with a restricted policy set,
 * and — if EMPLOYEE_EMAIL is set — assigns that role to the matching user.
 *
 * Requires RBAC to be enabled (MEDUSA_FF_RBAC=true) and migrations to have run.
 *
 * Run with:  npx medusa exec ./src/scripts/seed-employee-role.ts
 */
export default async function seedEmployeeRole({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const ff = container.resolve(ContainerRegistrationKeys.FEATURE_FLAG_ROUTER) as {
    isFeatureEnabled: (flag: string) => boolean
  }
  if (!ff.isFeatureEnabled("rbac")) {
    logger.warn(
      "[seed-employee-role] RBAC is disabled. Set MEDUSA_FF_RBAC=true and re-run migrations first."
    )
    return
  }

  const rbac = container.resolve(Modules.RBAC)

  // --- 1. Ensure the Employee role exists -----------------------------------
  let [role] = await rbac.listRbacRoles({ name: EMPLOYEE_ROLE_NAME })
  if (!role) {
    role = await rbac.createRbacRoles({
      name: EMPLOYEE_ROLE_NAME,
      description: "Day-to-day staff: manage catalog, orders, customers; no settings or user management.",
    })
    logger.info(`[seed-employee-role] Created role "${EMPLOYEE_ROLE_NAME}" (${role.id}).`)
  } else {
    logger.info(`[seed-employee-role] Role "${EMPLOYEE_ROLE_NAME}" already exists (${role.id}).`)
  }

  // --- 2. Ensure a full-access ("*") policy exists for each allowed resource -
  const desiredKeys = EMPLOYEE_ALLOWED_RESOURCES.map((r) => `${r}:*`)

  type PolicyRef = { id: string; key: string }
  const existingPolicies = (await rbac.listRbacPolicies({ key: desiredKeys })) as PolicyRef[]
  const policyByKey = new Map<string, PolicyRef>(existingPolicies.map((p) => [p.key, p]))

  const toCreate = EMPLOYEE_ALLOWED_RESOURCES.filter((r) => !policyByKey.has(`${r}:*`)).map(
    (resource) => ({
      key: `${resource}:*`,
      resource,
      operation: "*",
      name: `Manage ${resource}`,
    })
  )

  if (toCreate.length) {
    const created = (await rbac.createRbacPolicies(toCreate)) as PolicyRef[]
    for (const p of created) {
      policyByKey.set(p.key, p)
    }
    logger.info(`[seed-employee-role] Created ${created.length} policies.`)
  }

  // --- 3. Link every desired policy to the Employee role --------------------
  const existingLinks = (await rbac.listRbacRolePolicies({ role_id: role.id })) as {
    policy_id: string
  }[]
  const linkedPolicyIds = new Set(existingLinks.map((l) => l.policy_id))

  const linksToCreate = desiredKeys
    .map((key) => policyByKey.get(key))
    .filter((p): p is PolicyRef => p !== undefined && !linkedPolicyIds.has(p.id))
    .map((p) => ({ role_id: role.id, policy_id: p.id }))

  if (linksToCreate.length) {
    await rbac.createRbacRolePolicies(linksToCreate)
    logger.info(`[seed-employee-role] Attached ${linksToCreate.length} policies to the role.`)
  }

  logger.info(
    `[seed-employee-role] Employee role ready with ${desiredKeys.length} allowed resources.`
  )

  // --- 4. Optionally assign the role to a user (EMPLOYEE_EMAIL) --------------
  const employeeEmail = process.env.EMPLOYEE_EMAIL
  if (!employeeEmail) {
    logger.info(
      "[seed-employee-role] EMPLOYEE_EMAIL not set — role created but not assigned to anyone."
    )
    return
  }

  const userModule = container.resolve(Modules.USER)
  const [user] = await userModule.listUsers({ email: employeeEmail })
  if (!user) {
    logger.warn(
      `[seed-employee-role] No user found for EMPLOYEE_EMAIL="${employeeEmail}" — create them first.`
    )
    return
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "user",
    fields: ["id", "rbac_roles.id"],
    filters: { id: user.id },
  })
  const current: string[] = ((data?.[0]?.rbac_roles ?? []) as { id: string }[]).map(
    (r) => r.id
  )

  if (current.includes(role.id)) {
    logger.info(`[seed-employee-role] "${employeeEmail}" already has the Employee role.`)
    return
  }

  const link = container.resolve(ContainerRegistrationKeys.LINK)
  await link.create({
    [Modules.USER]: { user_id: user.id },
    [Modules.RBAC]: { rbac_role_id: role.id },
  })
  logger.info(`[seed-employee-role] Assigned Employee role to "${employeeEmail}".`)
}
