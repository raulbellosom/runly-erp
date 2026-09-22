import { formatLogTimestamp } from '@runly/core'
import { config as loadEnv } from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pkg from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { createNotificationDeliveryWorker } from '../../api/src/services/notification-delivery-worker.js'
import { createCalendarNotificationService } from '../../api/src/routes/calendar/calendar-notification-service.js'
import { createSyncLogCleanupWorker } from '../../api/src/services/sync-cleanup-worker.js'
import { resolveGoogleCalendarConfig } from '../../api/src/routes/calendar/google/google-config.js'
import { createGoogleTokenCrypto } from '../../api/src/routes/calendar/google/google-token-crypto.js'
import { createGoogleCalendarConnectionService } from '../../api/src/routes/calendar/google/google-connection-service.js'
import { createGoogleOAuthService } from '../../api/src/routes/calendar/google/google-oauth-service.js'
import { createGoogleCalendarEventsService } from '../../api/src/routes/calendar/google/google-calendar-events-service.js'
import { createGoogleCalendarEventLinkService } from '../../api/src/routes/calendar/google/google-calendar-event-link-service.js'
import { createGoogleCalendarInitialImportService } from '../../api/src/routes/calendar/google/google-calendar-initial-import-service.js'
import {
  createGoogleCalendarImportRecoveryService,
  GOOGLE_IMPORT_RECOVERY_INTERVAL_MS,
} from '../../api/src/routes/calendar/google/google-calendar-import-recovery-service.js'
import { createNotificationService } from '../../api/src/services/notification-service.js'
import { createProjectsNotificationService } from '../../api/src/routes/projects/projects-notification-service.js'
import { createRecurringTasksService } from '../../api/src/routes/projects/projects-recurring-service.js'
import { createWalletsService as createPfmWalletsService } from '../../api/src/routes/pfm/wallets-service.js'
import { createMovementsService as createPfmMovementsService } from '../../api/src/routes/pfm/movements-service.js'
import { createPfmCalendarBridge } from '../../api/src/routes/pfm/pfm-calendar-bridge.js'
import { createRecurringService as createPfmRecurringService } from '../../api/src/routes/pfm/recurring-service.js'
import { createReceiptsService as createPfmReceiptsService } from '../../api/src/routes/pfm/receipts-service.js'
import { createBudgetsService as createPfmBudgetsService } from '../../api/src/routes/pfm/budgets-service.js'
import { createInvestmentsService as createPfmInvestmentsService } from '../../api/src/routes/pfm/investments-service.js'
import { createVisionService as createPfmVisionService } from '../../api/src/services/vision-service.js'
import { createSupabaseAdminClient } from '../../api/src/services/supabase-admin.js'
import { createGrowthAggregationWorker } from '../../api/src/services/growth-aggregation-worker.js'
import { createGrowthPropertyHealthWorker } from '../../api/src/services/growth-property-health-worker.js'
import { expireStaleGuestSessions } from '../../api/src/routes/chat/session-expiry-job.js'
import { sweepOrphanChatAttachments } from '../../api/src/routes/chat/orphan-attachment-sweep-job.js'

const { PrismaClient } = pkg

const currentDir = path.dirname(fileURLToPath(import.meta.url))
loadEnv({
  path: [
    path.resolve(currentDir, '../.env.local'),
    path.resolve(currentDir, '../.env'),
    path.resolve(currentDir, '../../../.env.local'),
    path.resolve(currentDir, '../../../.env'),
  ],
})

const prismaConnectionString =
  process.env.DATABASE_URL ?? process.env.DIRECT_URL

if (!prismaConnectionString) {
  throw new Error(
    '[worker] DATABASE_URL o DIRECT_URL es requerido para iniciar Prisma',
  )
}

const pgPool = new pg.Pool({
  connectionString: prismaConnectionString,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
})
const prismaAdapter = new PrismaPg(pgPool)
const prisma = new PrismaClient({ adapter: prismaAdapter })
const workerSupabaseAdmin = createSupabaseAdminClient(process.env)
const deliveryWorker = createNotificationDeliveryWorker({ prisma, supabaseAdmin: workerSupabaseAdmin })
const calendarNotificationService = createCalendarNotificationService({ prisma })
const DELIVERY_INTERVAL_MS = Number(process.env.RUNLY_NOTIFICATION_DELIVERY_INTERVAL_MS ?? 30000)
const syncCleanupWorker = createSyncLogCleanupWorker({ prisma })
const SYNC_CLEANUP_INTERVAL_MS = syncCleanupWorker.SYNC_CLEANUP_INTERVAL_MS
const projectsNotifService = createProjectsNotificationService({
  prisma,
  notificationService: createNotificationService({ prisma }),
})
const DUE_SOON_INTERVAL_MS = 60 * 60 * 1000
const recurringTasksService = createRecurringTasksService({ prisma })
const RECURRING_INTERVAL_MS = 60 * 60 * 1000
const pfmWalletsService = createPfmWalletsService({ prisma })
const pfmRecurringService = createPfmRecurringService({
  prisma,
  wallets: pfmWalletsService,
  calendarBridge: createPfmCalendarBridge({ prisma }),
})
const PFM_RECURRING_INTERVAL_MS = 60 * 60 * 1000
const pfmReceiptsService = createPfmReceiptsService({
  prisma,
  vision: createPfmVisionService({ env: process.env }),
  supabaseAdmin: workerSupabaseAdmin,
  movements: createPfmMovementsService({ prisma, wallets: pfmWalletsService }),
  wallets: pfmWalletsService,
})
const PFM_RECEIPT_INTERVAL_MS = 30 * 1000
const pfmBudgetsService = createPfmBudgetsService({
  prisma,
  notificationService: createNotificationService({ prisma }),
})
const PFM_BUDGET_INTERVAL_MS = 60 * 60 * 1000
const pfmInvestmentsService = createPfmInvestmentsService({ prisma })
const PFM_YIELD_INTERVAL_MS = 60 * 60 * 1000
const growthAggregationWorker = createGrowthAggregationWorker({ prisma })
const GROWTH_AGGREGATION_INTERVAL_MS = Number(
  process.env.RUNLY_GROWTH_AGGREGATION_INTERVAL_MS ??
    process.env.RUNLY_GROWTH_RETENTION_INTERVAL_MS ??
    60 * 60 * 1000,
)
const growthPropertyHealthWorker = createGrowthPropertyHealthWorker({
  prisma,
  notificationService: createNotificationService({ prisma }),
})
const GROWTH_HEALTH_INTERVAL_MS = Number(
  process.env.RUNLY_GROWTH_HEALTH_INTERVAL_MS ?? 60 * 60 * 1000,
)

const googleCalendarConfig = resolveGoogleCalendarConfig(process.env)
let googleImportRecoveryService = null
if (googleCalendarConfig?.configured) {
  const googleTokenCrypto = createGoogleTokenCrypto({ key: googleCalendarConfig.encryptionKey })
  const googleConnectionService = createGoogleCalendarConnectionService({
    prisma,
    tokenCrypto: googleTokenCrypto,
  })
  const googleOAuthService = createGoogleOAuthService({ config: googleCalendarConfig })
  const googleInitialImportService = createGoogleCalendarInitialImportService({
    prisma,
    eventsService: createGoogleCalendarEventsService(),
    linkService: createGoogleCalendarEventLinkService({ prisma }),
  })
  googleImportRecoveryService = createGoogleCalendarImportRecoveryService({
    prisma,
    connectionService: googleConnectionService,
    oauthService: googleOAuthService,
    tokenCrypto: googleTokenCrypto,
    initialImportService: googleInitialImportService,
  })
}

function isConnectionError(err) {
  const msg = err?.message ?? ''
  return (
    msg.includes('Server has closed the connection') ||
    msg.includes('Connection terminated') ||
    msg.includes('Connection reset') ||
    msg.includes("Can't reach database server") ||
    err?.code === 'P1001' ||
    err?.code === 'P1017'
  )
}

async function reconnect() {
  try {
    await prisma.$disconnect()
  } catch (_) {}
  try {
    await prisma.$connect()
    console.log('[worker] prisma reconnected')
  } catch (reconnErr) {
    console.error('[worker] prisma reconnect failed:', reconnErr?.message ?? reconnErr)
  }
}

// Bare setInterval ticks can stack when a pass runs longer than its interval
// (slow SMTP, dead push endpoints) or when two worker processes overlap. A
// per-tick in-flight flag keeps a single process from processing the same rows
// twice; the delivery worker's atomic claim covers the multi-process case.
const tickRunning = { calendar: false, delivery: false, tasksDueSoon: false }

async function runCalendarReminderTick() {
  if (tickRunning.calendar) return
  tickRunning.calendar = true
  try {
    const result = await calendarNotificationService.processReminders()
    if ((result?.processed ?? 0) > 0) {
      console.log(
        `[worker] calendar reminders ${formatLogTimestamp()} processed=${result.processed} published=${result.published ?? 0}`,
      )
    }
  } catch (err) {
    console.error('[worker] calendar reminder tick failed:', err?.message ?? err)
    if (isConnectionError(err)) await reconnect()
  } finally {
    tickRunning.calendar = false
  }
}

async function runDeliveryTick() {
  if (tickRunning.delivery) return
  tickRunning.delivery = true
  try {
    const channels = ['email', 'web_push', 'fcm']
    for (const channel of channels) {
      const result = await deliveryWorker.processPendingNotificationDeliveries({
        channel,
        limit: 50,
      })
      if (result.processed > 0) {
        console.log(
          `[worker] notification delivery channel=${channel} ${formatLogTimestamp()} processed=${result.processed} sent=${result.sent} failed=${result.failed} retrying=${result.retrying}`,
        )
      }
    }
  } catch (err) {
    console.error('[worker] notification delivery tick failed:', err?.message ?? err)
    if (isConnectionError(err)) await reconnect()
  } finally {
    tickRunning.delivery = false
  }
}

async function runSyncCleanupTick() {
  try {
    const result = await syncCleanupWorker.processExpiredLogs()
    if (result.deleted > 0) {
      console.log(`[worker] sync log cleanup ${formatLogTimestamp()} deleted=${result.deleted}`)
    }
  } catch (err) {
    console.error('[worker] sync log cleanup tick failed:', err?.message ?? err)
    if (isConnectionError(err)) await reconnect()
  }
}

async function runTasksDueSoonTick() {
  if (tickRunning.tasksDueSoon) return
  tickRunning.tasksDueSoon = true
  try {
    const result = await projectsNotifService.processTasksDueSoon()
    if ((result?.published ?? 0) > 0) {
      console.log(
        `[worker] tasks due soon ${formatLogTimestamp()} processed=${result.processed} published=${result.published}`,
      )
    }
  } catch (err) {
    console.error('[worker] tasks due soon tick failed:', err?.message ?? err)
    if (isConnectionError(err)) await reconnect()
  } finally {
    tickRunning.tasksDueSoon = false
  }
}

async function runGrowthRetentionTick() {
  try {
    const result = await growthAggregationWorker.runOnce()
    const purged =
      result.purged.events +
      result.purged.sessions +
      result.purged.metrics
    if (result.aggregatedDays > 0 || purged > 0) {
      console.log(
        `[worker] growth analytics ${formatLogTimestamp()} days=${result.aggregatedDays} dimensions=${result.aggregatedDimensions} purged=${purged} watermark=${result.watermark ?? 'none'}`,
      )
    }
  } catch (err) {
  console.error('[worker] growth analytics tick failed:', err?.message ?? err)
    if (isConnectionError(err)) await reconnect()
  }
}

async function runGrowthHealthTick() {
  try {
    const result = await growthPropertyHealthWorker.runOnce()
    if (result.flaggedInactive > 0 || result.recovered > 0) {
      console.log(
        `[worker] growth property health ${formatLogTimestamp()} checked=${result.checked} flaggedInactive=${result.flaggedInactive} recovered=${result.recovered}`,
      )
    }
  } catch (err) {
    console.error('[worker] growth property health tick failed:', err?.message ?? err)
    if (isConnectionError(err)) await reconnect()
  }
}

async function runGoogleImportRecoveryTick() {
  if (!googleImportRecoveryService) return

  try {
    const result = await googleImportRecoveryService.recoverStaleImports()
    if ((result?.recovered ?? 0) > 0 || (result?.failed ?? 0) > 0) {
      console.log(
        `[worker] google calendar import recovery ${formatLogTimestamp()} recovered=${result.recovered} failed=${result.failed}`,
      )
    }
  } catch (err) {
    console.error('[worker] google calendar import recovery tick failed:', err?.message ?? err)
    if (isConnectionError(err)) await reconnect()
  }
}

console.log('Runly Worker started')
runCalendarReminderTick()
runDeliveryTick()
setInterval(() => {
  runCalendarReminderTick()
}, DELIVERY_INTERVAL_MS)
setInterval(() => {
  runDeliveryTick()
}, DELIVERY_INTERVAL_MS)
setInterval(() => {
  console.log(`[worker] heartbeat ${formatLogTimestamp()}`)
}, 30000)
runSyncCleanupTick()
setInterval(() => {
  runSyncCleanupTick()
}, SYNC_CLEANUP_INTERVAL_MS)
runTasksDueSoonTick()
setInterval(() => {
  runTasksDueSoonTick()
}, DUE_SOON_INTERVAL_MS)
runGrowthRetentionTick()
setInterval(() => {
  runGrowthRetentionTick()
}, GROWTH_AGGREGATION_INTERVAL_MS)
runGrowthHealthTick()
setInterval(() => {
  runGrowthHealthTick()
}, GROWTH_HEALTH_INTERVAL_MS)
runGoogleImportRecoveryTick()
setInterval(() => {
  runGoogleImportRecoveryTick()
}, GOOGLE_IMPORT_RECOVERY_INTERVAL_MS)

async function runRecurringTasksTick() {
  try {
    const result = await recurringTasksService.processRecurringTasks()
    if ((result?.created ?? 0) > 0) {
      console.log(
        `[worker] recurring tasks ${formatLogTimestamp()} processed=${result.processed} created=${result.created}`,
      )
    }
  } catch (err) {
    console.error('[worker] recurring tasks tick failed:', err?.message ?? err)
    if (isConnectionError(err)) await reconnect()
  }
}

runRecurringTasksTick()
setInterval(() => {
  runRecurringTasksTick()
}, RECURRING_INTERVAL_MS)

async function runPfmRecurringTick() {
  try {
    const result = await pfmRecurringService.materializeDueRules({ now: new Date(), horizonDays: 45 })
    if ((result?.created ?? 0) > 0) {
      console.log(
        `[worker] pfm recurring ${formatLogTimestamp()} processed=${result.processed} created=${result.created}`,
      )
    }
  } catch (err) {
    console.error('[worker] pfm recurring tick failed:', err?.message ?? err)
    if (isConnectionError(err)) await reconnect()
  }
}

runPfmRecurringTick()
setInterval(() => {
  runPfmRecurringTick()
}, PFM_RECURRING_INTERVAL_MS)

async function runPfmReceiptTick() {
  if (!process.env.GROQ_API_KEY || !workerSupabaseAdmin) return
  try {
    const result = await pfmReceiptsService.processPendingBatch({ limit: 5 })
    if ((result?.processed ?? 0) > 0) {
      console.log(`[worker] pfm receipts ${formatLogTimestamp()} processed=${result.processed}`)
    }
  } catch (err) {
    console.error('[worker] pfm receipt tick failed:', err?.message ?? err)
    if (isConnectionError(err)) await reconnect()
  }
}

runPfmReceiptTick()
setInterval(() => {
  runPfmReceiptTick()
}, PFM_RECEIPT_INTERVAL_MS)

async function runPfmBudgetTick() {
  try {
    const r = await pfmBudgetsService.evaluateBudgets({ now: new Date() })
    if ((r?.alerted ?? 0) > 0) {
      console.log(
        `[worker] pfm budgets ${formatLogTimestamp()} evaluated=${r.evaluated} alerted=${r.alerted}`,
      )
    }
  } catch (err) {
    console.error('[worker] pfm budget tick failed:', err?.message ?? err)
    if (isConnectionError(err)) await reconnect()
  }
}

runPfmBudgetTick()
setInterval(() => {
  runPfmBudgetTick()
}, PFM_BUDGET_INTERVAL_MS)

async function runPfmYieldTick() {
  try {
    const result = await pfmInvestmentsService.accrueYieldDue({ now: new Date() })
    if ((result?.created ?? 0) > 0) {
      console.log(
        `[worker] pfm yield ${formatLogTimestamp()} processed=${result.processed} created=${result.created}`,
      )
    }
  } catch (err) {
    console.error('[worker] pfm yield tick failed:', err?.message ?? err)
    if (isConnectionError(err)) await reconnect()
  }
}

runPfmYieldTick()
setInterval(() => {
  runPfmYieldTick()
}, PFM_YIELD_INTERVAL_MS)

const CHAT_EXPIRY_INTERVAL_MS = 15 * 60 * 1000
async function runChatSessionExpiryTick() {
  try {
    const result = await expireStaleGuestSessions(prisma, { supabaseAdmin: workerSupabaseAdmin })
    if ((result.closedConversations ?? 0) > 0 || (result.closedSessions ?? 0) > 0) {
      console.log(
        `[worker] chat session expiry ${formatLogTimestamp()} conversations=${result.closedConversations} sessions=${result.closedSessions}`,
      )
    }
  } catch (err) {
    console.error('[worker] chat session expiry tick failed:', err?.message ?? err)
    if (isConnectionError(err)) await reconnect()
  }
}

runChatSessionExpiryTick()
setInterval(() => {
  runChatSessionExpiryTick()
}, CHAT_EXPIRY_INTERVAL_MS)

const CHAT_ORPHAN_SWEEP_INTERVAL_MS = 30 * 60 * 1000
async function runChatOrphanAttachmentSweepTick() {
  try {
    const result = await sweepOrphanChatAttachments({ prisma, supabaseAdmin: workerSupabaseAdmin })
    if ((result.swept ?? 0) > 0) {
      console.log(
        `[worker] chat orphan attachment sweep ${formatLogTimestamp()} swept=${result.swept}`,
      )
    }
  } catch (err) {
    console.error('[worker] chat orphan attachment sweep tick failed:', err?.message ?? err)
    if (isConnectionError(err)) await reconnect()
  }
}

runChatOrphanAttachmentSweepTick()
setInterval(() => {
  runChatOrphanAttachmentSweepTick()
}, CHAT_ORPHAN_SWEEP_INTERVAL_MS)

process.on('SIGTERM', async () => {
  await prisma.$disconnect().catch(() => {})
  process.exit(0)
})

process.on('SIGINT', async () => {
  await prisma.$disconnect().catch(() => {})
  process.exit(0)
})
