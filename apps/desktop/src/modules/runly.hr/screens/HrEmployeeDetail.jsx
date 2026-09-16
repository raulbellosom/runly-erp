import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RunlyDetail, LoadingState, ErrorState, ConfirmDialog, DetailActionBar } from '@runly/ui'
import { ArrowLeft, ShieldBan } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { runly } from '../../../lib/runly'
import { HR_EMPLOYEE_DETAIL } from '../blueprints/hr-employee-detail.blueprint.js'
import { componentRegistry } from '../../../lib/moduleComponentRegistry.js'

const API_BASE = getApiUrl()

// Mounted by HrScreen.jsx, which owns the actual /hr/* route parsing and
// passes the resolved employeeId down as a prop (this screen is never
// route-matched directly — see HrScreen.jsx's detailEmployeeId branch).
export default function HrEmployeeDetail({ employeeId }) {
  const { session, userProfile } = useAuth()
  const token = session?.access_token
  const navigate = useNavigate()
  const { activeCompanyId } = useActiveCompany()
  const queryClient = useQueryClient()
  const [enabledConfirm, setEnabledConfirm] = useState(false)

  const permissions = userProfile?.permissions ?? []
  const hasPermission = (k) => Boolean(userProfile?.isAdmin || permissions.includes(k))
  const canUpdate = hasPermission('hr.employee.update')
  const canDelete = hasPermission('hr.employee.delete')

  const employeeQuery = useQuery({
    queryKey: ['hr-employee', employeeId],
    queryFn: () => runly.hr.getEmployee(employeeId, token),
    enabled: Boolean(token && employeeId),
  })
  const employee = employeeQuery.data?.data ?? null

  const toggleEnabledMutation = useMutation({
    mutationFn: (enabled) => runly.hr.setEmployeeEnabled(employeeId, enabled, token),
    onMutate: (enabled) =>
      toast.loading(enabled ? 'Habilitando colaborador...' : 'Deshabilitando colaborador...'),
    onSuccess: (_, enabled, toastId) => {
      toast.success(enabled ? 'Colaborador habilitado' : 'Colaborador deshabilitado', { id: toastId })
      queryClient.invalidateQueries({ queryKey: ['hr-employees'] })
      queryClient.invalidateQueries({ queryKey: ['hr-employee', employeeId] })
      setEnabledConfirm(false)
    },
    onError: (_, enabled, toastId) =>
      toast.error(
        enabled ? 'No se pudo habilitar el colaborador' : 'No se pudo deshabilitar el colaborador',
        { id: toastId },
      ),
  })

  if (employeeQuery.isLoading) {
    return (
      <div className="p-4 md:p-6">
        <LoadingState title="Cargando colaborador" />
      </div>
    )
  }

  if (!employee) {
    return (
      <div className="p-4 md:p-6">
        <ErrorState title="Colaborador no encontrado" />
      </div>
    )
  }

  const fullName = `${employee.firstName} ${employee.lastName}`.trim()

  return (
    <div className="p-4 md:p-6 space-y-6 min-h-dvh">
      <RunlyDetail
        blueprint={HR_EMPLOYEE_DETAIL}
        data={employee}
        token={token}
        companyId={activeCompanyId}
        apiBaseUrl={API_BASE}
        componentRegistry={componentRegistry}
        onAttachmentsChange={() => queryClient.invalidateQueries({ queryKey: ['hr-employee', employeeId] })}
        heroActions={
          <DetailActionBar
            primary={
              canUpdate
                ? { label: 'Editar', onClick: () => navigate(`/app/m/runly.hr/hr/employees/${employeeId}/edit`) }
                : null
            }
            secondary={[
              {
                label: 'Volver',
                icon: <ArrowLeft className="h-4 w-4" />,
                onClick: () => navigate('/app/m/runly.hr/hr/employees'),
              },
              canDelete
                ? {
                    label: employee.enabled === false ? 'Habilitar' : 'Deshabilitar',
                    icon: <ShieldBan className="h-4 w-4" />,
                    onClick: () => setEnabledConfirm(true),
                    destructive: employee.enabled !== false,
                    loading: toggleEnabledMutation.isPending,
                  }
                : null,
            ]}
          />
        }
      />

      <ConfirmDialog
        open={enabledConfirm}
        onOpenChange={setEnabledConfirm}
        title={employee.enabled === false ? 'Habilitar colaborador' : 'Deshabilitar colaborador'}
        description={
          employee.enabled === false
            ? `¿Deseas habilitar nuevamente a ${fullName}?`
            : `¿Deseas deshabilitar a ${fullName}? No podrá acceder al sistema mientras esté deshabilitado.`
        }
        confirmLabel={employee.enabled === false ? 'Habilitar' : 'Deshabilitar'}
        onConfirm={() => toggleEnabledMutation.mutate(employee.enabled === false)}
        loading={toggleEnabledMutation.isPending}
      />
    </div>
  )
}
