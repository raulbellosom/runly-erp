export async function register(registry) {
  if (typeof window === 'undefined') return
  const [
    { default: DispatchKiosk },
    { default: OperationDashboard },
    { default: SitesPage },
    { default: StationsPage },
    { default: MaterialsPage },
    { default: AssignmentsPage },
    { default: SeriesPage },
    { default: NewVolumeTicketPage },
    { default: NewScaleTicketPage },
    { default: TicketsListPage },
    { default: TicketDetailPage },
    { default: WeighingCapturePage },
    { default: ExitApprovalQueuePage },
  ] = await Promise.all([
    import('./kiosk/DispatchKiosk.jsx'),
    import('./pages/OperationDashboard.jsx'),
    import('./pages/SitesPage.jsx'),
    import('./pages/StationsPage.jsx'),
    import('./pages/MaterialsPage.jsx'),
    import('./pages/AssignmentsPage.jsx'),
    import('./pages/SeriesPage.jsx'),
    import('./tickets/NewVolumeTicketPage.jsx'),
    import('./tickets/NewScaleTicketPage.jsx'),
    import('./tickets/TicketsListPage.jsx'),
    import('./tickets/TicketDetailPage.jsx'),
    import('./weighing/WeighingCapturePage.jsx'),
    import('./exits/ExitApprovalQueuePage.jsx'),
  ])

  registry.register('custom.dispatch:DispatchKiosk', DispatchKiosk)
  registry.register('custom.dispatch:OperationDashboard', OperationDashboard)
  registry.register('custom.dispatch:SitesPage', SitesPage)
  registry.register('custom.dispatch:StationsPage', StationsPage)
  registry.register('custom.dispatch:MaterialsPage', MaterialsPage)
  registry.register('custom.dispatch:AssignmentsPage', AssignmentsPage)
  registry.register('custom.dispatch:SeriesPage', SeriesPage)
  registry.register('custom.dispatch:NewVolumeTicketPage', NewVolumeTicketPage)
  registry.register('custom.dispatch:NewScaleTicketPage', NewScaleTicketPage)
  registry.register('custom.dispatch:TicketsListPage', TicketsListPage)
  registry.register('custom.dispatch:TicketDetailPage', TicketDetailPage)
  registry.register('custom.dispatch:WeighingCapturePage', WeighingCapturePage)
  registry.register('custom.dispatch:ExitApprovalQueuePage', ExitApprovalQueuePage)
}
